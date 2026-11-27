/*@ver*/(window.__jsVer=window.__jsVer||{})["Cardmaker-csvimport.js"]="f757dee963";/*@end*/// ============================================================
//  Cardmaker-csvimport.js — CardMaker「CSV一括読み込み」機能（遅延読み込みチャンク）
//  ─────────────────────────────────────────────
//  ★ Cardmaker.js から分離。デッキ一覧・編集画面の初期表示には不要な
//    機能なので、Cardmaker.js側の loadChunksInBackground() が、
//    初期表示が終わった後にバックグラウンドで読み込む（このファイル
//    単体では動かず、Cardmaker.jsが先に読み込まれている前提。decks/
//    currentDeckId/findDuplicateCardIndex/findBugChars/genId/
//    queueSyncDeckToServer/renderCreatedList/showCmAlert/CHOICE_MIN/
//    CHOICE_MAXなどCardmaker.js側のグローバル関数・変数をそのまま使う）。
//
//  ■ 通常デッキ用（handleCsvImport）
//  1行目が見出し（問題/解答/解説 または question/answer/explanation）なら
//  自動認識してその行はスキップする。見出しが無ければ「問題,解答,解説」の
//  順の列とみなす。画像は含められない（imgs_q/imgs_a/imgs_e は空のまま、
//  必要ならCSV取り込み後に個別に画像を追加できる）。
//  ・重複（既存カード、またはCSV内での重複）は自動でスキップする。
//    1行ずつ確認ダイアログを出すのは一括読み込みでは非現実的なため。
//  ・使用できない文字（制御文字・不可視文字など）が含まれていた場合は、
//    行ごと弾くのではなく自動的に取り除いてから取り込む。
//
//  ■ 多肢選択デッキ用（handleChoiceCsvImport）
//  列は「問題, 選択肢1, 選択肢2, 選択肢3, 選択肢4, 選択肢5, 正解」の並び。
//  ・選択肢は2〜5個。使わない列は空欄でよく、空欄の列は詰めて（無いものとして）扱う。
//  ・正解列には選択肢の番号（1始まり）を入れる。複数正解の場合は「1,3」のように
//    カンマ（または読点・スペース）区切りで並べる。1個だけなら択一問題、
//    2個以上なら複数回答問題として扱われる（他の作成経路と同じ自動判定）。
//
//  ■ 統一書式（importUnifiedCsvRows）★ 追加
//  見出しに「種別」列があれば、どちらの読み込みボタンから選んでも統一書式として読み込む
//  （通常・選択式・並び替えの混在したデッキ用。詳細は下の importUnifiedCsvRows の説明）。
// ============================================================
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM除去
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // 何もしない（続く \n で改行確定。単独 \r のみの古い形式は考慮しない）
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => (c || '').trim() !== '')); // 完全な空行は除外
}

const CSV_HEADER_ALIASES = {
  question:    ['question', '問題', '問題文', 'q'],
  answer:      ['answer', '解答', '答え', 'a'],
  explanation: ['explanation', '解説', 'e'],
};
function detectCsvColumns(headerRow) {
  const norm = headerRow.map(h => (h || '').trim().toLowerCase());
  const idx = { question: -1, answer: -1, explanation: -1 };
  norm.forEach((h, i) => {
    for (const key of Object.keys(CSV_HEADER_ALIASES)) {
      if (idx[key] === -1 && CSV_HEADER_ALIASES[key].includes(h)) idx[key] = i;
    }
  });
  // 問題・解答の列がどちらも見出しとして認識できた場合だけ「見出し行」とみなす
  const isHeader = idx.question !== -1 && idx.answer !== -1;
  return { isHeader, idx };
}

function stripBugChars(str) {
  if (!str) return str;
  const bad = findBugChars(str);
  if (!bad.length) return str;
  return [...str].filter(ch => !bad.includes(ch)).join('');
}

async function handleCsvImport(event) {
  const file = event.target.files[0];
  event.target.value = ''; // 同じファイルを連続選択してもonchangeが発火するようにリセット
  if (!file) return;

  const deck = decks.find(d => d.id === currentDeckId);
  if (!deck) return;

  let text;
  try {
    text = await file.text();
  } catch (e) {
    await showCmAlert({ title: '読み込みに失敗しました', desc: 'CSVファイルを読み込めませんでした。' });
    return;
  }

  const rows = parseCSV(text);
  if (!rows.length) {
    await showCmAlert({ title: '読み込めるデータがありません', desc: 'CSVファイルの中身が空のようです。' });
    return;
  }


  // ★ 追加：見出しに「種別」列があれば統一書式として読み込む
  const unifiedCols = detectUnifiedCsvColumns(rows[0]);
  if (unifiedCols) { await importUnifiedCsvRows(deck, unifiedCols, rows.slice(1)); return; }

  let { isHeader, idx } = detectCsvColumns(rows[0]);
  const dataRows = isHeader ? rows.slice(1) : rows;
  if (!isHeader) idx = { question: 0, answer: 1, explanation: 2 };

  let added = 0, skippedEmpty = 0, skippedDup = 0, sanitized = 0;
  for (const r of dataRows) {
    let q = (r[idx.question] || '').trim();
    let a = (r[idx.answer] || '').trim();
    let e = idx.explanation !== -1 ? (r[idx.explanation] || '').trim() : '';
    if (!q || !a) { skippedEmpty++; continue; }

    const before = q + a + e;
    q = stripBugChars(q); a = stripBugChars(a); e = stripBugChars(e);
    if ((q + a + e) !== before) sanitized++;
    if (!q || !a) { skippedEmpty++; continue; }

    if (findDuplicateCardIndex(deck, q, a) !== -1) { skippedDup++; continue; }

    deck.cards.push({ id: genId(), type: 'normal', question: q, answer: a, explanation: e, imgs_q: [], imgs_a: [], imgs_e: [] });
    added++;
  }

  if (added > 0) {
    saveDecks(decks);
    document.getElementById('edit-counter').textContent = deck.cards.length + '枚';
    renderCreatedList();
    // ★ saveCard() と同様、サーバー登録済みのデッキは追加のたびに反映しておく
    //   （そうしないと次に強制リロードしたときにこの分が消えてしまう）。
    if (deck.filename) {
      // ★ 反映に失敗した場合は黙って終わらせず知らせる（大量取り込みは10秒の制限に掛かりうる）
      queueSyncDeckToServer(deck).then(ok => {
        if (!ok) showBanner('サーバーへの反映に失敗しました（この端末には保存済み）。通信状況を確認し、もう一度「公開して保存」を押してください', '#fffbeb', '#92400e', Icons.html('warning', {size:15}));
      });
    }
  }

  const parts = [`${added}枚を追加しました`];
  if (skippedDup)   parts.push(`重複のため${skippedDup}件をスキップしました`);
  if (skippedEmpty) parts.push(`問題文または解答が空のため${skippedEmpty}件をスキップしました`);
  if (sanitized)    parts.push(`${sanitized}件で使用できない文字を自動的に取り除きました`);
  await showCmAlert({ title: 'CSVの読み込みが完了しました', desc: parts.join('\n') });
}

const CHOICE_CSV_HEADER_ALIASES = {
  question: ['question', '問題', '問題文', 'q'],
  correct:  ['correct', '正解', 'answer', '答え'],
};
// 見出し行から「問題」「正解」列と、「選択肢1」〜「選択肢5」（choice1〜5 / a〜e も可）の列を検出する
function detectChoiceCsvColumns(headerRow) {
  const norm = headerRow.map(h => (h || '').trim().toLowerCase());
  let qIdx = -1, correctIdx = -1;
  const choiceCols = []; // [{ col, num }]
  norm.forEach((h, i) => {
    if (qIdx === -1 && CHOICE_CSV_HEADER_ALIASES.question.includes(h)) { qIdx = i; return; }
    if (correctIdx === -1 && CHOICE_CSV_HEADER_ALIASES.correct.includes(h)) { correctIdx = i; return; }
    const m = h.match(/^(?:選択肢|choice)\s*([1-5])$/) || h.match(/^([a-e])$/);
    if (m) {
      const num = /^[a-e]$/.test(m[1]) ? 'abcde'.indexOf(m[1]) + 1 : Number(m[1]);
      choiceCols.push({ col: i, num });
    }
  });
  choiceCols.sort((a, b) => a.num - b.num);
  const isHeader = qIdx !== -1 && correctIdx !== -1 && choiceCols.length >= CHOICE_MIN;
  return { isHeader, qIdx, correctIdx, choiceCols };
}

async function handleChoiceCsvImport(event) {
  const file = event.target.files[0];
  event.target.value = ''; // 同じファイルを連続選択してもonchangeが発火するようにリセット
  if (!file) return;

  const deck = decks.find(d => d.id === currentDeckId);
  if (!deck) return;

  let text;
  try {
    text = await file.text();
  } catch (e) {
    await showCmAlert({ title: '読み込みに失敗しました', desc: 'CSVファイルを読み込めませんでした。' });
    return;
  }

  const rows = parseCSV(text);
  if (!rows.length) {
    await showCmAlert({ title: '読み込めるデータがありません', desc: 'CSVファイルの中身が空のようです。' });
    return;
  }


  // ★ 追加：見出しに「種別」列があれば統一書式として読み込む
  const unifiedCols = detectUnifiedCsvColumns(rows[0]);
  if (unifiedCols) { await importUnifiedCsvRows(deck, unifiedCols, rows.slice(1)); return; }

  let { isHeader, qIdx, correctIdx, choiceCols } = detectChoiceCsvColumns(rows[0]);
  const dataRows = isHeader ? rows.slice(1) : rows;
  if (!isHeader) {
    // ★ 見出しが無い場合は「問題, 選択肢1〜5, 正解」の固定7列とみなす
    qIdx = 0; correctIdx = 6;
    choiceCols = [1, 2, 3, 4, 5].map((col, i) => ({ col, num: i + 1 }));
  }

  let added = 0, skippedEmpty = 0, skippedChoiceCount = 0, skippedCorrect = 0, skippedDup = 0, sanitized = 0;
  for (const r of dataRows) {
    let q = (r[qIdx] || '').trim();
    let rawChoices = choiceCols.map(({ col }) => (r[col] || '').trim());
    let correctRaw = (r[correctIdx] || '').trim();
    if (!q || !correctRaw) { skippedEmpty++; continue; }

    const before = q + rawChoices.join('') + correctRaw;
    q = stripBugChars(q);
    rawChoices = rawChoices.map(stripBugChars);
    correctRaw = stripBugChars(correctRaw);
    if ((q + rawChoices.join('') + correctRaw) !== before) sanitized++;
    if (!q || !correctRaw) { skippedEmpty++; continue; }

    // ★ 空欄の選択肢列は詰めて（無いものとして）扱う
    const choices = rawChoices.filter(c => c);
    if (choices.length < CHOICE_MIN || choices.length > CHOICE_MAX) { skippedChoiceCount++; continue; }

    // ★ 正解列：選択肢の番号（1始まり）をカンマ/読点/スペース区切りで並べたもの
    const rawNums = correctRaw.split(/[,、\s]+/).map(s => s.trim()).filter(Boolean).map(Number);
    const allValid = rawNums.length > 0 && rawNums.every(n => Number.isInteger(n) && n >= 1 && n <= choices.length);
    if (!allValid) { skippedCorrect++; continue; }
    const correct = [...new Set(rawNums.map(n => n - 1))].sort((a, b) => a - b);

    const answerText = correct.map(i => choices[i]).join(' / ');
    if (findDuplicateCardIndex(deck, q, answerText) !== -1) { skippedDup++; continue; }

    deck.cards.push({
      id: genId(), type: 'choice', question: q, answer: answerText, explanation: '',
      choices, correct_indices: correct,
      imgs_q: [], imgs_a: [], imgs_e: [],
    });
    added++;
  }

  if (added > 0) {
    saveDecks(decks);
    document.getElementById('edit-counter').textContent = deck.cards.length + '枚';
    renderCreatedList();
    // ★ handleCsvImport() と同様、サーバー登録済みのデッキは追加のたびに反映しておく
    if (deck.filename) {
      // ★ 反映に失敗した場合は黙って終わらせず知らせる（大量取り込みは10秒の制限に掛かりうる）
      queueSyncDeckToServer(deck).then(ok => {
        if (!ok) showBanner('サーバーへの反映に失敗しました（この端末には保存済み）。通信状況を確認し、もう一度「公開して保存」を押してください', '#fffbeb', '#92400e', Icons.html('warning', {size:15}));
      });
    }
  }

  const parts = [`${added}枚を追加しました`];
  if (skippedDup)         parts.push(`重複のため${skippedDup}件をスキップしました`);
  if (skippedEmpty)       parts.push(`問題文または正解が空のため${skippedEmpty}件をスキップしました`);
  if (skippedChoiceCount) parts.push(`選択肢が2〜5個の範囲外だったため${skippedChoiceCount}件をスキップしました`);
  if (skippedCorrect)     parts.push(`正解の指定が不正だったため${skippedCorrect}件をスキップしました`);
  if (sanitized)          parts.push(`${sanitized}件で使用できない文字を自動的に取り除きました`);
  await showCmAlert({ title: 'CSVの読み込みが完了しました', desc: parts.join('\n') });
}

// ============================================================
//  ★ 追加：統一書式（種別の混在するデッキ用）の読み込み
//  ─────────────────────────────────────────────
//  見出しに「種別」（または type）列がある CSV は、通常・多肢選択どちらの読み込みボタンから
//  選んでもこの書式として扱う（CSVダウンロードの統一書式＝bot.py _deck_to_csv_unified と同じ）。
//  列：種別, 問題, 解答, 解説, 選択肢1〜5, 正解, 並び順, ダミー（見出しの名前で列を探すので順不同でよい）
//  ・種別は「通常／選択式／並び替え」（normal/choice/order も可）。空欄なら「通常」。
//  ・並び順・ダミーは項目を「|」で区切る。項目内の「|」は「\|」、「\」は「\\」と書く。
//  ・CSVに「形式」列（リスト／語句）があればそれに従う。無い古いCSVはダミー語句の有無で推定するので、ダミーがあれば「語句」、無ければ「一覧」とみなす。
//  ・並び替えの項目数などが条件を満たさない行は取り込まずにスキップする（件数を最後に知らせる）。
// ============================================================
const UNIFIED_CSV_TYPE_ALIASES = {
  normal: ['通常', 'normal', ''],
  choice: ['選択式', 'choice', '多肢選択'],
  order:  ['並び替え', 'order', '並べ替え'],
};
function detectUnifiedCsvColumns(headerRow) {
  const norm = headerRow.map(h => (h || '').trim().toLowerCase());
  const find = names => norm.findIndex(h => names.includes(h));
  const typeIdx = find(['種別', 'type']);
  if (typeIdx === -1) return null;
  const choiceCols = [];
  norm.forEach((h, i) => {
    const m = h.match(/^(?:選択肢|choice)\s*([1-5])$/);
    if (m) choiceCols.push({ col: i, num: Number(m[1]) });
  });
  choiceCols.sort((a, b) => a.num - b.num);
  return {
    typeIdx,
    qIdx:       find(CSV_HEADER_ALIASES.question),
    aIdx:       find(['answer', '解答', '答え']),
    eIdx:       find(CSV_HEADER_ALIASES.explanation),
    correctIdx: find(['correct', '正解']),
    orderIdx:   find(['並び順', 'order_items', '順番']),
    dummyIdx:   find(['ダミー', 'order_distractors', 'distractors']),
    styleIdx:   find(['形式', 'order_style', 'style']),
    choiceCols,
  };
}

// 「|」区切りのセルを項目の配列に戻す（「\x」は x そのもの。エスケープ規則は csvPipeJoin の逆）。
//   セル自体が空なら空配列。各項目は前後の空白を取り除く。
function csvPipeSplit(cell) {
  const s = cell || '';
  if (!s.trim()) return [];
  const out = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) { cur += s[++i]; continue; }
    if (ch === '|') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim());
}

function unifiedCsvRowType(raw) {
  const v = (raw || '').trim().toLowerCase();
  for (const t of Object.keys(UNIFIED_CSV_TYPE_ALIASES)) {
    if (UNIFIED_CSV_TYPE_ALIASES[t].includes(v)) return t;
  }
  return null;
}

async function importUnifiedCsvRows(deck, cols, dataRows) {
  const cell = (r, i) => (i === -1 ? '' : (r[i] || '').trim());
  let added = 0, skippedEmpty = 0, skippedDup = 0, sanitized = 0, skippedType = 0, skippedInvalid = 0;
  const invalidReasons = [];
  for (const r of dataRows) {
    const type = unifiedCsvRowType(cell(r, cols.typeIdx));
    if (!type) { skippedType++; continue; }
    const rawQ = cell(r, cols.qIdx), rawA = cell(r, cols.aIdx), rawE = cell(r, cols.eIdx);
    let q = stripBugChars(rawQ), a = stripBugChars(rawA), e = stripBugChars(rawE);
    let rowSanitized = (q + a + e) !== (rawQ + rawA + rawE);
    if (!q) { skippedEmpty++; continue; }

    const card = { id: genId(), question: q, answer: '', explanation: e, imgs_q: [], imgs_a: [], imgs_e: [] };
    if (type === 'normal') {
      if (!a) { skippedEmpty++; continue; }
      applyCardTypeFields(card, 'normal', { answer: a });
    } else if (type === 'choice') {
      const rawChoices = cols.choiceCols.map(({ col }) => cell(r, col));
      const cleanedChoices = rawChoices.map(stripBugChars);
      if (cleanedChoices.join('') !== rawChoices.join('')) rowSanitized = true;
      const choices = cleanedChoices.filter(c => c);
      const correctRaw = cell(r, cols.correctIdx);
      if (!correctRaw) { skippedEmpty++; continue; }
      if (choices.length < CHOICE_MIN || choices.length > CHOICE_MAX) {
        skippedInvalid++; invalidReasons.push('選択肢が2〜5個の範囲外'); continue;
      }
      const nums = correctRaw.split(/[,、\s]+/).map(s => s.trim()).filter(Boolean).map(Number);
      if (!nums.length || !nums.every(n => Number.isInteger(n) && n >= 1 && n <= choices.length)) {
        skippedInvalid++; invalidReasons.push('正解の指定が不正'); continue;
      }
      applyCardTypeFields(card, 'choice', { choices, correct: [...new Set(nums.map(n => n - 1))] });
    } else {
      const rawItems = csvPipeSplit(cell(r, cols.orderIdx));
      const rawDummies = csvPipeSplit(cell(r, cols.dummyIdx));
      let items = rawItems.map(stripBugChars), dummies = rawDummies.map(stripBugChars);
      if (items.join('') !== rawItems.join('') || dummies.join('') !== rawDummies.join('')) rowSanitized = true;
      // 空欄の項目・ダミーは取り除く（サーバー側の保存処理と同じ扱い）
      items = items.filter(x => x);
      dummies = dummies.filter(x => x);
      // 形式列があればそれを優先（語句=chips / リスト=list）。無い旧CSVはダミーの有無で推定
      const styleCell = cell(r, cols.styleIdx);
      const sc = styleCell.toLowerCase();
      const style = ['語句', 'chips'].includes(sc) ? 'chips' : (['リスト', '一覧', 'list'].includes(sc) ? 'list' : (dummies.length ? 'chips' : 'list'));
      const err = orderFieldsError(items, dummies, style);
      if (err) { skippedInvalid++; invalidReasons.push(err); continue; }
      applyCardTypeFields(card, 'order', { items, distractors: dummies, style });
    }
    if (findDuplicateCardIndex(deck, card.question, card.answer) !== -1) { skippedDup++; continue; }
    if (rowSanitized) sanitized++;
    deck.cards.push(card);
    added++;
  }

  if (added > 0) {
    saveDecks(decks);
    document.getElementById('edit-counter').textContent = deck.cards.length + '枚';
    renderCreatedList();
    if (deck.filename) {
      queueSyncDeckToServer(deck).then(ok => {
        if (!ok) showBanner('サーバーへの反映に失敗しました（この端末には保存済み）。通信状況を確認し、もう一度「公開して保存」を押してください', '#fffbeb', '#92400e', Icons.html('warning', {size:15}));
      });
    }
  }

  const parts = [`${added}枚を追加しました`];
  if (skippedDup)     parts.push(`重複のため${skippedDup}件をスキップしました`);
  if (skippedEmpty)   parts.push(`問題文・解答・正解のいずれかが空のため${skippedEmpty}件をスキップしました`);
  if (skippedType)    parts.push(`種別が「通常／選択式／並び替え」のどれでもないため${skippedType}件をスキップしました`);
  if (skippedInvalid) parts.push(`内容が条件を満たさないため${skippedInvalid}件をスキップしました（${[...new Set(invalidReasons)].join('、')}）`);
  if (sanitized)      parts.push(`${sanitized}件で使用できない文字を自動的に取り除きました`);
  await showCmAlert({ title: 'CSVの読み込みが完了しました', desc: parts.join('\n') });
}
