/*@ver*/(window.__jsVer=window.__jsVer||{})["DeckShare.js"]="687244c0ec";/*@end*/// ============================================================
//  DeckShare.js — 共有リンク専用の閲覧ビューア（DeckShare.html）用スクリプト
//  ─────────────────────────────
//  CardMakerのデッキ作成者が発行した「共有リンク」（?token=...）を開いた、
//  ログインしていない人向けの閲覧専用ページ。
//  ★ ログイン不要。このデッキ以外の情報（予定・他のデッキ・フォルダ等）は
//    一切表示・取得しない（サーバー側 /deck_share_info も、このtokenに
//    紐づく1デッキの閲覧専用フィールドしか返さない設計）。
//  ★ 編集・保存・削除・「わからない」マーク・成績のサーバー送信など、
//    変更を伴う機能は一切持たない（見る・自己採点だけ、すべて画面内で完結）。
//  ★ 数式描画・画像表示のロジックはCardmaker.jsの該当部分（setMathText/
//    simpleMathToLatex/renderImgList等）をそのまま流用している（Cardmaker.js
//    自体はログイン前提の巨大なファイルなので、このページでは読み込まず
//    必要な部分だけをここに複製した）。
//  ★ セキュリティ：問題・解答・選択肢・画像は、共有デッキ経由で他人が
//    仕込んだ文字列である可能性があるため、Cardmaker.jsと同じ理由で
//    textContent / DOM APIのsrcプロパティ経由でのみ描画する
//    （innerHTML+テンプレート文字列での組み立ては禁止）。
//  ★ 画面の流れ：読み込み → 案内画面（デッキ名・反転トグル・はじめる／
//    一覧で見る）→ 暗記カード or 選択式クイズ or 種別混在（カード単位）／一覧。開いていきなり
//    カードが始まらないよう、必ずこの案内画面を経由する。
// ============================================================

const API_BASE = "/api/";
const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E'];
const CHOICE_MIN = 2;
// ★ 追加：カード単位の種別（Cardmaker.js の CARD_TYPES / cardType と同じ基準）
const CARD_TYPES = ['normal', 'choice', 'order'];
const ORDER_MIN = 2;

function qs(id) { return document.getElementById(id); }

function getToken() {
  return new URLSearchParams(location.search).get('token') || '';
}

// ── 画面の切り替え ──────────────────────────
// 'loading' | 'error' | 'intro' | 'study' | 'list' の5つを排他的に切り替える。
// トップバーの見出し・戻るボタン・右側ボタン（シャッフル／一覧の反転）も
// ここでまとめて更新する（デッキ名を複数箇所に重複して出さないため、
// 案内画面ではトップバーは汎用の「共有デッキ」のまま、学習・一覧画面に
// 進んだときだけデッキ名をトップバーに出す）。
function showDsStep(step) {
  ['loading', 'error', 'intro'].forEach(s => {
    const el = qs(`ds-step-${s}`);
    if (el) el.style.display = (s === step) ? '' : 'none';
  });
  qs('ds-body').style.display = (step === 'study') ? 'flex' : 'none';
  qs('ds-step-list').style.display = (step === 'list') ? '' : 'none';

  const backBtn = qs('ds-back-btn');
  const shuffleBtn = qs('ds-shuffle-btn');
  const listReverseBtn = qs('ds-list-reverse-btn');
  const title = qs('ds-title');
  if (step === 'study' || step === 'list') {
    title.textContent = (deckShare && deckShare.name) || '共有デッキ';
    backBtn.style.display = '';
  } else {
    title.textContent = '共有デッキ';
    backBtn.style.display = 'none';
  }
  shuffleBtn.style.display = (step === 'study') ? '' : 'none';
  listReverseBtn.style.display = (step === 'list') ? '' : 'none';
}

function dsGoIntro() {
  showDsStep('intro');
}

// ── 画像（renderImgList相当）：save_cardsはimgs_q/imgs_a/imgs_eの中身を
//   検証していないため、`<img src="${s}">`のようなテンプレート文字列で
//   HTMLを組み立てるとXSSになる。必ずDOMのsrcプロパティへ代入する。
function renderImgList(container, imgs) {
  container.innerHTML = '';
  (imgs || []).forEach(s => {
    const img = document.createElement('img');
    img.src = s;
    img.alt = '';
    container.appendChild(img);
  });
}

// ── 数式描画（Cardmaker.jsのsetMathText/simpleMathToLatex系をそのまま複製） ──
function findMatchingParen(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}
// 下付き記法「_(b)」（中身は英数字・+・-のみ）
function matchSubscriptAt(s, i) {
  if (s[i] !== '_' || s[i+1] !== '(') return null;
  const close = s.indexOf(')', i + 2);
  if (close === -1) return null;
  const inner = s.slice(i + 2, close);
  if (!/^[A-Za-z0-9+\-]+$/.test(inner)) return null;
  return { inner, end: close + 1 };
}
// ベクトル記法「→(a)」「→(AB)」（中身は英数字・'・下付き記法 _(1) のみ）
function matchVectorAt(s, i) {
  if (s[i] !== '→' || s[i+1] !== '(') return null;
  const close = findMatchingParen(s, i + 1);
  if (close === -1) return null;
  const inner = s.slice(i + 2, close);
  if (!/^(?:[A-Za-z0-9']|_\([A-Za-z0-9+\-]+\))+$/.test(inner)) return null;
  return { inner, end: close + 1 };
}
// Unicodeの上付き・下付き文字（² ³ ⁴ ₁ など）は、フォントによって字ごとに高さがバラバラに
// なる（¹²³は別フォントから描画されるため）。描画時はKaTeXの上付き/下付きに揃えて高さを統一する。
const UNI_SUPSUB = {};
(function () {
  const sup = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿ⁽⁾', supA = '0123456789+-n()';
  const sub = '₀₁₂₃₄₅₆₇₈₉₊₋₍₎', subA = '0123456789+-()';
  for (let k = 0; k < sup.length; k++) UNI_SUPSUB[sup[k]] = ['^', supA[k]];
  for (let k = 0; k < sub.length; k++) UNI_SUPSUB[sub[k]] = ['_', subA[k]];
})();
// 位置 i から同じ種類（上付き/下付き）のUnicode文字が続く範囲を { latex, end } で返す。
function matchUniSupSubAt(s, i) {
  const f = UNI_SUPSUB[s[i]];
  if (!f) return null;
  let j = i, body = '';
  while (j < s.length && UNI_SUPSUB[s[j]] && UNI_SUPSUB[s[j]][0] === f[0]) { body += UNI_SUPSUB[s[j]][1]; j++; }
  return { latex: `{}${f[0]}{${body}}`, end: j };
}

function simpleMathToLatexRaw(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if ((s[i] === '√' || s[i] === '∛') && s[i+1] === '(') {
      const isCube = s[i] === '∛';
      const closeIdx = findMatchingParen(s, i+1);
      if (closeIdx !== -1) {
        const inner = simpleMathToLatexRaw(s.slice(i+2, closeIdx));
        out += isCube ? `\\sqrt[3]{${inner}}` : `\\sqrt{${inner}}`;
        i = closeIdx + 1;
        continue;
      }
    }
    if (s[i] === '(') {
      const closeIdx = findMatchingParen(s, i);
      if (closeIdx !== -1 && s[closeIdx+1] === '/' && s[closeIdx+2] === '(') {
        const closeIdx2 = findMatchingParen(s, closeIdx+2);
        if (closeIdx2 !== -1) {
          const num = simpleMathToLatexRaw(s.slice(i+1, closeIdx));
          const den = simpleMathToLatexRaw(s.slice(closeIdx+3, closeIdx2));
          out += `\\frac{${num}}{${den}}`;
          i = closeIdx2 + 1;
          continue;
        }
      }
    }
    // ベクトル →(a)
    const vecM = matchVectorAt(s, i);
    if (vecM) { out += `\\overrightarrow{${simpleMathToLatexRaw(vecM.inner)}}`; i = vecM.end; continue; }
    // 下付き _(b)
    const subM = matchSubscriptAt(s, i);
    if (subM) { out += `_{${subM.inner}}`; i = subM.end; continue; }
    const uniM = matchUniSupSubAt(s, i);
    if (uniM) { out += uniM.latex; i = uniM.end; continue; }
    out += s[i];
    i++;
  }
  return out;
}

// 簡易記法（√(...) ・ ∛(...) ・ (分子)/(分母)）を、KaTeXが描画できるLaTeX記法へ変換する。
// 内側にネストした数式（√の中に分数がある等）も再帰的に変換する。
// 該当するパターンが無い部分（旧形式の生LaTeXや、普通の文章）はそのまま素通しする。
function simpleMathToLatex(raw) {
  if (raw == null) return '';
  const s = String(raw);
  let out = '';
  let i = 0;
  while (i < s.length) {
    // 旧形式の生LaTeX \( ... \) は中身を一切変換せずそのまま通す（入れ子の \( でKaTeXが壊れるのを防ぐ）
    if (s[i] === '\\' && s[i+1] === '(') {
      const endIdx = s.indexOf('\\)', i + 2);
      if (endIdx !== -1) { out += s.slice(i, endIdx + 2); i = endIdx + 2; continue; }
    }
    // √(...) ・ ∛(...)
    if ((s[i] === '√' || s[i] === '∛') && s[i+1] === '(') {
      const isCube = s[i] === '∛';
      const closeIdx = findMatchingParen(s, i+1);
      if (closeIdx !== -1) {
        const inner = simpleMathToLatexRaw(s.slice(i+2, closeIdx));
        out += isCube ? `\\(\\sqrt[3]{${inner}}\\)` : `\\(\\sqrt{${inner}}\\)`;
        i = closeIdx + 1;
        continue;
      }
    }
    // (分子)/(分母)
    if (s[i] === '(') {
      const closeIdx = findMatchingParen(s, i);
      if (closeIdx !== -1 && s[closeIdx+1] === '/' && s[closeIdx+2] === '(') {
        const closeIdx2 = findMatchingParen(s, closeIdx+2);
        if (closeIdx2 !== -1) {
          const num = simpleMathToLatexRaw(s.slice(i+1, closeIdx));
          const den = simpleMathToLatexRaw(s.slice(closeIdx+3, closeIdx2));
          out += `\\(\\frac{${num}}{${den}}\\)`;
          i = closeIdx2 + 1;
          continue;
        }
      }

    }
    // ベクトル →(a)
    const vecM = matchVectorAt(s, i);
    if (vecM) { out += `\\(\\overrightarrow{${simpleMathToLatexRaw(vecM.inner)}}\\)`; i = vecM.end; continue; }
    // 下付き _(b)
    const subM = matchSubscriptAt(s, i);
    if (subM) { out += `\\(_{${subM.inner}}\\)`; i = subM.end; continue; }
    const uniM = matchUniSupSubAt(s, i);
    if (uniM) { out += `\\(${uniM.latex}\\)`; i = uniM.end; continue; }
    out += s[i];
    i++;
  }
  return out;
}

// 生のテキスト（√(4)のような簡易記法、または旧形式の\(\frac{}{}\)なども含む）を、
// 指定要素に「普通の数式の見た目」で描画する。
// KaTeXが読み込めていない場合（オフライン等）は記法そのままの文章として表示する。
function setMathText(el, raw) {
  if (!el) return;
  // KaTeXが読み込めない場合は、変換後の生LaTeXではなく元の文字列をそのまま表示する
  el.textContent = window.renderMathInElement ? simpleMathToLatex(raw || '') : (raw || '');
  if (window.renderMathInElement) {
    try {
      renderMathInElement(el, {
        delimiters: [{ left: '\\(', right: '\\)', display: false }],
        throwOnError: false,
      });
    } catch (e) { /* 描画に失敗しても元のプレーンテキストのまま表示される */ }
  }
}

// ============================================================
//  読み込み
// ============================================================
let deckShare = null;   // /deck_share_info のレスポンス
// 'flash' | 'quiz' | 'mixed'
//   flash：全カードが通常（従来の暗記カード）
//   quiz ：従来の選択式デッキ（choice_mode=true で、どのカードにも type が無い）→ 挙動は従来のまま
//   mixed：カード単位の種別（type）で振り分ける。通常=暗記カード、choice=選択式、order=並び替え
let dsMode = 'flash';
let dsResults = new Map(); // mixed 用：出題順の位置 → 正誤（戻って答え直しても上書きなので二重加点しない）
let dsCards = [];        // 暗記カードモードで使う順番（シャッフル可）
let dsIdx = 0;
let dsReverse = false;   // 暗記カードの問題/解答を逆にするか（案内画面のチェックボックスから）
let dsListReverse = false; // 一覧で見るモードの反転（暗記カードとは独立にトグル可能）

async function init() {
  const token = getToken();
  if (!token) {
    showDsStep('error');
    qs('ds-error-msg').textContent = 'リンクが正しくありません。共有してくれた人にもう一度リンクを確認してください。';
    return;
  }
  try {
    const res = await fetch(`${API_BASE}deck_share_info?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok) {
      showDsStep('error');
      qs('ds-error-msg').textContent = data.error || 'このリンクは無効です。';
      return;
    }
    deckShare = data;
    document.title = `${deckShare.name || '共有デッキ'} — 共有デッキ`;
    const allCards = data.cards || [];
    const hasTyped = allCards.some(c => c && CARD_TYPES.includes(c.type));
    const playable = getPlayableChoiceCards();
    if (!hasTyped && data.choice_mode && playable.length) {
      dsMode = 'quiz'; // ★ 従来の選択式デッキ（type無し）は今まで通りの選択式クイズ
    } else if (allCards.some(c => dsCardType(c) !== 'normal')) {
      dsMode = 'mixed';
    } else {
      dsMode = 'flash';
    }
    // 「問題と解答を逆にする」は通常カードにしか効かないので、通常カードがある時だけ出す
    const hasNormal = allCards.some(c => dsCardType(c) === 'normal');
    qs('ds-reverse-row').style.display = (dsMode === 'quiz' || (dsMode === 'mixed' && !hasNormal)) ? 'none' : '';
    renderIntroMeta();
    showDsStep('intro');
  } catch (e) {
    showDsStep('error');
    qs('ds-error-msg').textContent = 'サーバーに接続できませんでした。通信環境をご確認のうえ、再読み込みしてください。';
  }
}

function getPlayableChoiceCards() {
  const cards = (deckShare && deckShare.cards) || [];
  return cards
    .filter(c => Array.isArray(c.choices) && c.choices.length >= CHOICE_MIN)
    .map(c => normalizeChoiceCard(c))
    .filter(c => c.correct_indices.length >= 1);
}

// 選択式カードの correct_indices を配列に揃える（旧形式の correct_index 単数にも対応）
function normalizeChoiceCard(c) {
  return {
    ...c,
    correct_indices: Array.isArray(c.correct_indices) ? c.correct_indices
      : (typeof c.correct_index === 'number' ? [c.correct_index] : []),
  };
}

// ★ 追加：カード1枚の種別（DeckShare での出題方法）を決める。
//   type が無ければ choices が CHOICE_MIN 個以上で choice、それ以外は normal（Cardmaker.js の cardType と同じ）。
//   ただし出題に必要な情報が欠けているカード（正解の無い選択式・項目が足りない並び替え）は、
//   遊べないので通常カード（問題と解答を見るだけ）として扱う。
function dsCardType(c) {
  if (!c) return 'normal';
  const t = CARD_TYPES.includes(c.type) ? c.type
    : ((Array.isArray(c.choices) && c.choices.length >= CHOICE_MIN) ? 'choice' : 'normal');
  if (t === 'choice') {
    const ok = Array.isArray(c.choices) && c.choices.length >= CHOICE_MIN
      && normalizeChoiceCard(c).correct_indices.length >= 1;
    return ok ? 'choice' : 'normal';
  }
  if (t === 'order') {
    const items = Array.isArray(c.order_items) ? c.order_items : [];
    return items.length >= ORDER_MIN ? 'order' : 'normal';
  }
  return 'normal';
}

function renderIntroMeta() {
  const meta = qs('ds-deck-meta');
  meta.innerHTML = '';

  const nameEl = document.createElement('div');
  nameEl.className = 'ds-deck-meta-name';
  nameEl.textContent = deckShare.name || '（名称未設定）';
  meta.appendChild(nameEl);

  const sub = document.createElement('div');
  sub.className = 'ds-deck-meta-sub';
  const cardCount = (deckShare.cards || []).length;
  const badges = [];
  if (deckShare.subject) badges.push(deckShare.subject);
  badges.push(`${cardCount}問`);
  if (dsMode === 'quiz') badges.push('選択式クイズ');
  if (dsMode === 'mixed') {
    const cards = deckShare.cards || [];
    const nChoice = cards.filter(c => dsCardType(c) === 'choice').length;
    const nOrder = cards.filter(c => dsCardType(c) === 'order').length;
    if (nChoice) badges.push(`選択式 ${nChoice}問`);
    if (nOrder) badges.push(`並び替え ${nOrder}問`);
  }
  if (deckShare.incomplete) badges.push('作成中のデッキ');
  if (deckShare.shared_by) badges.push(`${deckShare.shared_by}さんが共有`);
  badges.forEach(t => {
    const b = document.createElement('span');
    b.className = 'ds-badge';
    b.textContent = t;
    sub.appendChild(b);
  });
  meta.appendChild(sub);

  // ★ 追加：デッキに説明が設定されていれば表示する（textContentなのでescは不要）
  if (deckShare.description) {
    const desc = document.createElement('div');
    desc.className = 'ds-deck-meta-desc';
    desc.textContent = deckShare.description;
    meta.appendChild(desc);
  }
}

// ── 案内画面からの開始 ──────────────────────────
function dsStart() {
  dsReverse = qs('ds-reverse-checkbox').checked;
  if (dsMode === 'quiz') {
    startQuizMode(getPlayableChoiceCards());
  } else if (dsMode === 'mixed') {
    startMixedMode((deckShare.cards || []).slice());
  } else {
    startFlashMode((deckShare.cards || []).slice());
  }
  showDsStep('study');
}

function shuffleDeckShare() {
  if (dsMode === 'quiz') {
    qs('ds-quiz-done').style.display = 'none';
    qs('ds-quiz-play').style.display = '';
    startQuizMode(getPlayableChoiceCards());
  } else if (dsMode === 'mixed') {
    for (let i = dsCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dsCards[i], dsCards[j]] = [dsCards[j], dsCards[i]];
    }
    startMixedMode(dsCards);
  } else {
    qs('ds-done').style.display = 'none';
    qs('ds-flash-content').style.display = 'flex';
    for (let i = dsCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dsCards[i], dsCards[j]] = [dsCards[j], dsCards[i]];
    }
    dsIdx = 0;
    renderFlashCard();
  }
}

// ============================================================
//  暗記カード（フリップ学習）モード
// ============================================================
function startFlashMode(cards) {
  qs('ds-flash').style.display = 'flex';
  qs('ds-done').style.display = 'none';
  qs('ds-flash-content').style.display = 'flex';
  dsCards = cards;
  dsIdx = 0;
  renderFlashCard();
}

function renderFlashCard() {
  if (dsIdx >= dsCards.length) {
    qs('ds-flash-content').style.display = 'none';
    qs('ds-done').style.display = 'flex';
    qs('ds-prog-fill').style.width = '100%';
    qs('ds-prog-label').textContent = `${dsCards.length} / ${dsCards.length}`;
    qs('ds-done-sub').textContent = `全${dsCards.length}問を確認しました`;
    return;
  }
  const c = dsCards[dsIdx];
  const qText = dsReverse ? c.answer : c.question;
  const qImgs = dsReverse ? c.imgs_a : c.imgs_q;
  const aText = dsReverse ? c.question : c.answer;
  const aImgs = dsReverse ? c.imgs_q : c.imgs_a;

  setMathText(qs('ds-q-text'), qText);
  renderImgList(qs('ds-q-imgs'), qImgs);
  qs('ds-answer-panel').classList.remove('show');
  qs('ds-reveal-bar').style.display = 'flex';
  qs('ds-nav').style.display = 'none';

  setMathText(qs('ds-a-text'), aText);
  renderImgList(qs('ds-a-imgs'), aImgs);
  const explWrap = qs('ds-expl-wrap');
  if (c.explanation) { setMathText(qs('ds-e-text'), c.explanation); explWrap.style.display = ''; }
  else { explWrap.style.display = 'none'; }

  const pct = dsCards.length > 1 ? (dsIdx / (dsCards.length - 1)) * 100 : 100;
  qs('ds-prog-fill').style.width = pct + '%';
  qs('ds-prog-label').textContent = `${dsIdx + 1} / ${dsCards.length}`;
  qs('ds-prev').disabled = dsIdx === 0;
  qs('ds-prev-pre').disabled = dsIdx === 0;
  qs('ds-next').textContent = dsIdx === dsCards.length - 1 ? '完了' : '次へ →';
}

function dsReveal() {
  qs('ds-answer-panel').classList.add('show');
  qs('ds-reveal-bar').style.display = 'none';
  qs('ds-nav').style.display = '';
}

function dsMove(dir) {
  dsIdx += dir;
  if (dsIdx < 0) dsIdx = 0;
  if (dsMode === 'mixed') renderMixedCard();
  else renderFlashCard();
}

// ============================================================
//  ★ 追加：種別混在モード（カード単位の type で振り分け）
//  ─────────────────────────────
//  出題順（dsCards / dsIdx）は1本で、カードごとに表示する画面を切り替える。
//   ・normal → 暗記カード画面（#ds-flash、renderFlashCard をそのまま使う）
//   ・choice → 選択式画面（#ds-quiz、従来の選択式UIと同じボタン）
//   ・order  → 選択式画面の中の並び替え欄（#ds-qp-order）
//  採点結果は dsResults（出題順の位置 → 正誤）に上書き保存し、完了画面で集計する。
// ============================================================
function startMixedMode(cards) {
  dsCards = cards;
  dsIdx = 0;
  dsResults = new Map();
  qs('ds-done').style.display = 'none';
  qs('ds-flash-content').style.display = 'flex';
  qs('ds-quiz-done').style.display = 'none';
  qs('ds-quiz-play').style.display = '';
  renderMixedCard();
}

function renderMixedCard() {
  const flash = qs('ds-flash');
  const quiz = qs('ds-quiz');
  if (dsIdx >= dsCards.length) {
    // 完了：選択式・並び替えの正解数を出す
    flash.style.display = 'none';
    quiz.style.display = 'flex';
    qs('ds-quiz-play').style.display = 'none';
    qs('ds-quiz-done').style.display = '';
    const graded = dsCards.reduce((n, c) => n + (dsCardType(c) !== 'normal' ? 1 : 0), 0);
    let correct = 0;
    dsResults.forEach((v, k) => { if (v && k < dsCards.length) correct++; });
    qs('ds-quiz-score').textContent = `${correct} / ${graded} 問正解`;
    const sub = qs('ds-quiz-done-sub');
    sub.textContent = `全${dsCards.length}問を確認しました（正解数は選択式・並び替えの問題のみ）`;
    sub.style.display = '';
    return;
  }
  const card = dsCards[dsIdx];
  const type = dsCardType(card);
  if (type === 'normal') {
    quiz.style.display = 'none';
    flash.style.display = 'flex';
    qs('ds-done').style.display = 'none';
    qs('ds-flash-content').style.display = 'flex';
    renderFlashCard();
    return;
  }
  flash.style.display = 'none';
  quiz.style.display = 'flex';
  qs('ds-quiz-done').style.display = 'none';
  qs('ds-quiz-play').style.display = '';
  quiz.scrollTop = 0;
  renderQuizCardCommon(card, dsIdx, dsCards.length);
  // mixed では回答前でも「← 前へ」を押せるよう、ナビ行は常に出す（次へは回答後に有効化）
  qs('ds-qp-next-wrap').style.display = '';
  qs('ds-qp-prev-btn').style.display = '';
  qs('ds-qp-prev-btn').disabled = dsIdx === 0;
  const nextBtn = qs('ds-qp-next-btn');
  nextBtn.disabled = true;
  nextBtn.textContent = dsIdx === dsCards.length - 1 ? '結果を見る →' : '次へ →';
  if (type === 'choice') {
    const nc = normalizeChoiceCard(card);
    buildChoiceButtons(nc, idx => {
      if (dsQuizAnswered) return;
      dsQuizAnswered = true;
      const isCorrect = markChoiceResult(nc, idx);
      dsResults.set(dsIdx, isCorrect);
      dsShowQuizExplanation(card);
      nextBtn.disabled = false;
    });
  } else {
    dsRenderOrder(card);
  }
}

function dsShowQuizExplanation(card) {
  if (dsMode !== 'mixed' || !card.explanation) return;
  setMathText(qs('ds-qp-e-text'), card.explanation);
  qs('ds-qp-expl-wrap').style.display = '';
}

// ============================================================
//  ★ 追加：並び替えカード（タップのみ。ドラッグは無し）
//  ─────────────────────────────
//  ・下の置き場（シャッフル済み）のチップをタップ → 解答欄の末尾に入る
//  ・解答欄のチップをタップ → 置き場へ戻る
//  ・chips 形式は order_distractors（ダミー語句）も置き場に混ざる
//  ・採点は「並べた語句の文字列の並び」が order_items と完全一致したときだけ正解
//    （添字ではなく文字列で比較するので、同じ文字列の語句が複数あっても正しく判定できる）
//  ・位置ごとに正誤を色分けし、不正解なら正しい順を表示する
//  ・語句は利用者の入力なので innerHTML には入れず setMathText / textContent で描画する
//  ・見た目は Cardmaker.css の .study-order-* を流用（DeckShare.html で読み込み済み）
// ============================================================
let dsOrderState = null; // { idx, items, style, pieces:[{id,text}], placed:[id], answered }

function dsShuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function dsRenderOrder(card) {
  const style = card.order_style === 'chips' ? 'chips' : 'list';
  const items = (Array.isArray(card.order_items) ? card.order_items : []).map(x => String(x));
  const distractors = (style === 'chips' && Array.isArray(card.order_distractors))
    ? card.order_distractors.map(x => String(x)) : [];
  const pieces = [...items, ...distractors].map((text, i) => ({ id: i, text }));
  // シャッフル（偶然正しい並びのままになった場合は並べ直す）
  for (let tries = 0; tries < 5; tries++) {
    dsShuffleInPlace(pieces);
    const asIs = pieces.slice(0, items.length).map(p => p.text);
    if (distractors.length || items.length < 2 || asIs.some((t, i) => t !== items[i])) break;
  }
  dsOrderState = { idx: dsIdx, items, style, pieces, placed: [], answered: false };
  qs('ds-qp-order').style.display = '';
  dsDrawOrder();
}

function dsOrderPiece(id) {
  return dsOrderState.pieces.find(p => p.id === id);
}

function dsDrawOrder(perPos) {
  const st = dsOrderState;
  const wrap = qs('ds-qp-order');
  if (!st || !wrap) return;
  wrap.replaceChildren();
  wrap.classList.toggle('is-list', st.style === 'list');
  wrap.classList.toggle('is-chips', st.style === 'chips');

  if (!st.answered) {
    const hint = document.createElement('div');
    hint.className = 'study-order-hint';
    hint.textContent = st.style === 'list'
      ? '下の項目をタップして、正しい順に並べてください'
      : (st.pieces.length > st.items.length
        ? '語句を正しい順にタップしてください（使わない語句も混ざっています）'
        : '語句を正しい順にタップしてください');
    wrap.appendChild(hint);
  }

  // ── 解答欄 ──
  const answer = document.createElement('div');
  answer.className = 'study-order-answer';
  if (!st.placed.length) {
    const ph = document.createElement('div');
    ph.className = 'study-order-placeholder';
    ph.textContent = st.style === 'list' ? 'ここに順番に並びます' : 'ここに語句が並びます';
    answer.appendChild(ph);
  }
  st.placed.forEach((id, pos) => {
    const btn = dsMakeOrderChip(dsOrderPiece(id), 'answer', pos);
    if (perPos) btn.classList.add(perPos[pos] ? 'is-correct' : 'is-wrong');
    answer.appendChild(btn);
  });
  wrap.appendChild(answer);

  if (st.answered) return;

  // ── 置き場（まだ使っていない語句） ──
  const bank = document.createElement('div');
  bank.className = 'study-order-bank';
  st.pieces.filter(p => !st.placed.includes(p.id)).forEach(p => bank.appendChild(dsMakeOrderChip(p, 'bank')));
  wrap.appendChild(bank);

  const actions = document.createElement('div');
  actions.className = 'study-order-actions';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'btn btn-ghost';
  resetBtn.textContent = 'やり直す';
  resetBtn.disabled = !st.placed.length;
  resetBtn.addEventListener('click', () => { if (!st.answered) { st.placed = []; dsDrawOrder(); } });
  const giveUpBtn = document.createElement('button');
  giveUpBtn.type = 'button';
  giveUpBtn.className = 'btn btn-ghost';
  giveUpBtn.textContent = '答えを見る';
  giveUpBtn.addEventListener('click', () => dsGradeOrder(true));
  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'btn btn-blue study-order-submit';
  submitBtn.textContent = `採点する（${st.placed.length} / ${st.items.length}）`;
  submitBtn.disabled = st.placed.length !== st.items.length;
  submitBtn.addEventListener('click', () => dsGradeOrder(false));
  actions.append(resetBtn, giveUpBtn, submitBtn);
  wrap.appendChild(actions);
}

// 語句チップ1個を作る（where: 'answer' | 'bank'）
function dsMakeOrderChip(piece, where, pos) {
  const st = dsOrderState;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'study-order-chip' + (where === 'answer' ? ' in-answer' : '');
  if (where === 'answer' && st.style === 'list') {
    const num = document.createElement('span');
    num.className = 'study-order-chip-num';
    num.textContent = String(pos + 1);
    btn.appendChild(num);
  }
  const label = document.createElement('span');
  label.className = 'study-order-chip-text';
  setMathText(label, piece.text);
  btn.appendChild(label);
  if (st.answered) { btn.disabled = true; return btn; }
  btn.addEventListener('click', () => {
    if (dsOrderState !== st || st.answered) return;
    if (where === 'bank') {
      if (st.placed.length >= st.items.length) return; // 正しい項目数より多くは置けない
      st.placed.push(piece.id);
    } else {
      st.placed = st.placed.filter(id => id !== piece.id);
    }
    dsDrawOrder();
  });
  return btn;
}

// 採点する（giveUp=true は「答えを見る」＝並べた途中のまま不正解として扱う）
function dsGradeOrder(giveUp) {
  const st = dsOrderState;
  if (!st || st.answered || st.idx !== dsIdx) return;
  if (!giveUp && st.placed.length !== st.items.length) return;
  const texts = st.placed.map(id => dsOrderPiece(id).text);
  const perPos = texts.map((t, i) => t === st.items[i]);
  const isCorrect = !giveUp && texts.length === st.items.length && perPos.every(Boolean);
  st.answered = true;
  dsDrawOrder(perPos);

  const result = qs('ds-qp-result');
  result.className = 'study-grade-result ' + (isCorrect ? 'correct' : 'incorrect');
  result.style.display = 'flex';
  // Icons.html はこのファイル内で固定のSVG文字列を返すだけ（利用者の入力を含まない）
  qs('ds-qp-result-mark').innerHTML = isCorrect ? '○ 正解'
    : ((window.Icons ? Icons.html('close', { size: 14 }) + ' ' : '✕ ') + '不正解');

  const correctBox = qs('ds-qp-order-correct');
  correctBox.replaceChildren();
  if (!isCorrect) {
    const label = document.createElement('div');
    label.className = 'ds-order-correct-label';
    label.textContent = '正しい順';
    correctBox.appendChild(label);
    if (st.style === 'list') {
      const ol = document.createElement('ol');
      ol.className = 'list-view-order-list';
      st.items.forEach(t => {
        const li = document.createElement('li');
        setMathText(li, t);
        ol.appendChild(li);
      });
      correctBox.appendChild(ol);
    } else {
      const line = document.createElement('div');
      line.className = 'ds-order-correct-chips';
      setMathText(line, st.items.join(' '));
      correctBox.appendChild(line);
    }
    correctBox.style.display = '';
  } else {
    correctBox.style.display = 'none';
  }

  dsResults.set(dsIdx, isCorrect);
  dsShowQuizExplanation(dsCards[dsIdx]);
  qs('ds-qp-next-btn').disabled = false;
}

// ============================================================
//  選択式クイズモード（choice_modeデッキ用）
// ============================================================
let dsQuizCards = [];
let dsQuizIdx = 0;
let dsQuizScore = 0;
let dsQuizAnswered = false;

function startQuizMode(playable) {
  qs('ds-quiz').style.display = 'flex';
  qs('ds-quiz-done').style.display = 'none';
  qs('ds-quiz-play').style.display = '';
  dsQuizCards = playable;
  // 出題順をシャッフル（Fisher-Yates）
  for (let i = dsQuizCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [dsQuizCards[i], dsQuizCards[j]] = [dsQuizCards[j], dsQuizCards[i]];
  }
  dsQuizIdx = 0;
  dsQuizScore = 0;
  renderQuizQuestion();
}

// 選択式画面の共通部分（進捗・問題文・画像）を描き、選択肢／並び替え／結果欄を空に戻す。
//   従来の選択式クイズ（quiz）と種別混在（mixed）の両方から使う。
function renderQuizCardCommon(card, idx, total) {
  dsQuizAnswered = false;
  const pct = total > 1 ? (idx / total) * 100 : 0;
  qs('ds-qp-prog-fill').style.width = pct + '%';
  qs('ds-qp-prog-label').textContent = `${idx + 1} / ${total}`;
  setMathText(qs('ds-qp-q-text'), card.question);
  renderImgList(qs('ds-qp-q-imgs'), card.imgs_q);
  qs('ds-qp-choices').replaceChildren();
  dsOrderState = null;
  const orderWrap = qs('ds-qp-order');
  orderWrap.replaceChildren();
  orderWrap.style.display = 'none';
  qs('ds-qp-result').style.display = 'none';
  qs('ds-qp-order-correct').style.display = 'none';
  qs('ds-qp-expl-wrap').style.display = 'none';
  qs('ds-qp-next-btn').disabled = false;
}

function renderQuizQuestion() {
  const card = dsQuizCards[dsQuizIdx];
  renderQuizCardCommon(card, dsQuizIdx, dsQuizCards.length);
  buildChoiceButtons(card, i => dsAnswerQuiz(i));
  qs('ds-qp-prev-btn').style.display = 'none';
  qs('ds-qp-next-wrap').style.display = 'none';
}

// 選択肢ボタンを並べる（onPick(i) は押された選択肢の番号を受け取る）
function buildChoiceButtons(card, onPick) {
  const choicesEl = qs('ds-qp-choices');
  choicesEl.innerHTML = '';
  card.choices.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qp-choice-btn';
    const b = document.createElement('b');
    b.textContent = `${CHOICE_LETTERS[i]}.`;
    btn.appendChild(b);
    btn.appendChild(document.createTextNode(' '));
    const span = document.createElement('span');
    btn.appendChild(span);
    setMathText(span, c);
    btn.addEventListener('click', () => onPick(i));
    choicesEl.appendChild(btn);
  });
}

// 押された選択肢の正誤を色分けして、正解だったかを返す
function markChoiceResult(card, idx) {
  const isCorrect = card.correct_indices.includes(idx);
  [...document.querySelectorAll('#ds-qp-choices .qp-choice-btn')].forEach((btn, i) => {
    btn.disabled = true;
    if (card.correct_indices.includes(i)) btn.classList.add('qp-correct');
    else if (i === idx) btn.classList.add('qp-wrong');
    else btn.classList.add('qp-dim');
  });
  return isCorrect;
}

function dsAnswerQuiz(idx) {
  if (dsQuizAnswered) return;
  dsQuizAnswered = true;
  const card = dsQuizCards[dsQuizIdx];
  const isCorrect = markChoiceResult(card, idx);
  if (isCorrect) dsQuizScore++;

  qs('ds-qp-next-wrap').style.display = '';
  qs('ds-qp-next-btn').textContent = dsQuizIdx === dsQuizCards.length - 1 ? '結果を見る →' : '次へ →';
}

function dsQuizNext() {
  if (dsMode === 'mixed') { dsMove(1); return; }
  dsQuizIdx++;
  if (dsQuizIdx >= dsQuizCards.length) {
    qs('ds-quiz-play').style.display = 'none';
    qs('ds-quiz-done').style.display = '';
    qs('ds-quiz-score').textContent = `${dsQuizScore} / ${dsQuizCards.length} 問正解`;
    qs('ds-quiz-done-sub').style.display = 'none';
  } else {
    renderQuizQuestion();
  }
}

// ============================================================
//  一覧で見る：問題と答えをまとめて表示（Cardmaker-listview.jsの簡易版）
// ============================================================
function dsOpenList() {
  dsListReverse = qs('ds-reverse-checkbox').checked;
  renderDsListView();
  showDsStep('list');
}

function dsToggleListReverse() {
  dsListReverse = !dsListReverse;
  renderDsListView();
}

function renderDsListView() {
  const cards = (deckShare && deckShare.cards) || [];
  const wrap = qs('ds-list-items');
  wrap.innerHTML = '';
  if (!cards.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-msg';
    empty.textContent = 'カードがありません';
    wrap.appendChild(empty);
    return;
  }
  cards.forEach((c, i) => {
    // ★ 反転は通常カードにだけ効かせる（選択式・並び替えは問題→解答の向きのまま）
    const isOrder = dsCardType(c) === 'order';
    const rev = dsListReverse && dsCardType(c) === 'normal';
    const qText = rev ? c.answer : c.question;
    const qImgs = rev ? c.imgs_a : c.imgs_q;
    const aText = rev ? c.question : c.answer;
    const aImgs = rev ? c.imgs_q : c.imgs_a;

    const item = document.createElement('div');
    item.className = 'list-view-item';

    const head = document.createElement('div');
    head.className = 'list-view-item-head';
    const num = document.createElement('div');
    num.className = 'list-view-item-num';
    num.textContent = i + 1;
    head.appendChild(num);
    item.appendChild(head);

    const qTag = document.createElement('div');
    qTag.className = 'list-view-q-tag';
    qTag.textContent = '問題';
    item.appendChild(qTag);
    const qEl = document.createElement('div');
    qEl.className = 'list-view-q-text';
    item.appendChild(qEl);
    setMathText(qEl, qText);
    if (qImgs && qImgs.length) {
      const qImgWrap = document.createElement('div');
      qImgWrap.className = 'list-view-imgs';
      renderImgList(qImgWrap, qImgs);
      item.appendChild(qImgWrap);
    }

    const aTag = document.createElement('div');
    aTag.className = 'list-view-a-tag';
    aTag.textContent = '解答';
    item.appendChild(aTag);
    if (isOrder && c.order_style !== 'chips') {
      // 並び替え（list形式）は正しい順を番号付きリストで見せる
      const ol = document.createElement('ol');
      ol.className = 'list-view-order-list';
      c.order_items.forEach(t => {
        const li = document.createElement('li');
        setMathText(li, String(t));
        ol.appendChild(li);
      });
      item.appendChild(ol);
    } else {
      const aEl = document.createElement('div');
      aEl.className = 'list-view-a-text';
      item.appendChild(aEl);
      setMathText(aEl, isOrder ? c.order_items.map(x => String(x)).join(' ') : aText);
    }
    if (aImgs && aImgs.length) {
      const aImgWrap = document.createElement('div');
      aImgWrap.className = 'list-view-imgs';
      renderImgList(aImgWrap, aImgs);
      item.appendChild(aImgWrap);
    }

    if (c.explanation) {
      const eTag = document.createElement('div');
      eTag.className = 'list-view-e-tag';
      eTag.textContent = '解説';
      item.appendChild(eTag);
      const eEl = document.createElement('div');
      eEl.className = 'list-view-e-text';
      item.appendChild(eEl);
      setMathText(eEl, c.explanation);
    }

    wrap.appendChild(item);
  });
}

init();
hideLoadingFallback();
