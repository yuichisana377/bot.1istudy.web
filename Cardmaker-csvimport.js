// ============================================================
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

    deck.cards.push({ id: genId(), question: q, answer: a, explanation: e, imgs_q: [], imgs_a: [], imgs_e: [] });
    added++;
  }

  if (added > 0) {
    saveDecks(decks);
    document.getElementById('edit-counter').textContent = deck.cards.length + '枚';
    renderCreatedList();
    // ★ saveCard() と同様、サーバー登録済みのデッキは追加のたびに反映しておく
    //   （そうしないと次に強制リロードしたときにこの分が消えてしまう）。
    if (deck.filename) queueSyncDeckToServer(deck);
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
      id: genId(), question: q, answer: answerText, explanation: '',
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
    if (deck.filename) queueSyncDeckToServer(deck);
  }

  const parts = [`${added}枚を追加しました`];
  if (skippedDup)         parts.push(`重複のため${skippedDup}件をスキップしました`);
  if (skippedEmpty)       parts.push(`問題文または正解が空のため${skippedEmpty}件をスキップしました`);
  if (skippedChoiceCount) parts.push(`選択肢が2〜5個の範囲外だったため${skippedChoiceCount}件をスキップしました`);
  if (skippedCorrect)     parts.push(`正解の指定が不正だったため${skippedCorrect}件をスキップしました`);
  if (sanitized)          parts.push(`${sanitized}件で使用できない文字を自動的に取り除きました`);
  await showCmAlert({ title: 'CSVの読み込みが完了しました', desc: parts.join('\n') });
}
