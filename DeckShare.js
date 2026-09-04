// ============================================================
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
//    一覧で見る）→ 暗記カード or 選択式クイズ／一覧。開いていきなり
//    カードが始まらないよう、必ずこの案内画面を経由する。
// ============================================================

const API_BASE = "/api/";
const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E'];
const CHOICE_MIN = 2;

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
    out += s[i];
    i++;
  }
  return out;
}
function simpleMathToLatex(raw) {
  if (raw == null) return '';
  const s = String(raw);
  let out = '';
  let i = 0;
  while (i < s.length) {
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
    out += s[i];
    i++;
  }
  return out;
}
function setMathText(el, raw) {
  if (!el) return;
  el.textContent = simpleMathToLatex(raw || '');
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
let dsMode = 'flash';    // 'flash' | 'quiz'（choice_modeかつ選択式で遊べる問題があるか）
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
    const playable = getPlayableChoiceCards();
    dsMode = (data.choice_mode && playable.length) ? 'quiz' : 'flash';
    qs('ds-reverse-row').style.display = (dsMode === 'quiz') ? 'none' : '';
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
    .map(c => ({
      ...c,
      correct_indices: Array.isArray(c.correct_indices) ? c.correct_indices
        : (typeof c.correct_index === 'number' ? [c.correct_index] : []),
    }))
    .filter(c => c.correct_indices.length >= 1);
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
  renderFlashCard();
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

function renderQuizQuestion() {
  const card = dsQuizCards[dsQuizIdx];
  dsQuizAnswered = false;
  const pct = dsQuizCards.length > 1 ? (dsQuizIdx / dsQuizCards.length) * 100 : 0;
  qs('ds-qp-prog-fill').style.width = pct + '%';
  qs('ds-qp-prog-label').textContent = `${dsQuizIdx + 1} / ${dsQuizCards.length}`;
  setMathText(qs('ds-qp-q-text'), card.question);
  renderImgList(qs('ds-qp-q-imgs'), card.imgs_q);

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
    btn.addEventListener('click', () => dsAnswerQuiz(i));
    choicesEl.appendChild(btn);
  });

  qs('ds-qp-next-wrap').style.display = 'none';
}

function dsAnswerQuiz(idx) {
  if (dsQuizAnswered) return;
  dsQuizAnswered = true;
  const card = dsQuizCards[dsQuizIdx];
  const isCorrect = card.correct_indices.includes(idx);
  if (isCorrect) dsQuizScore++;

  [...document.querySelectorAll('#ds-qp-choices .qp-choice-btn')].forEach((btn, i) => {
    btn.disabled = true;
    if (card.correct_indices.includes(i)) btn.classList.add('qp-correct');
    else if (i === idx) btn.classList.add('qp-wrong');
    else btn.classList.add('qp-dim');
  });

  qs('ds-qp-next-wrap').style.display = '';
  qs('ds-qp-next-btn').textContent = dsQuizIdx === dsQuizCards.length - 1 ? '結果を見る →' : '次へ →';
}

function dsQuizNext() {
  dsQuizIdx++;
  if (dsQuizIdx >= dsQuizCards.length) {
    qs('ds-quiz-play').style.display = 'none';
    qs('ds-quiz-done').style.display = '';
    qs('ds-quiz-score').textContent = `${dsQuizScore} / ${dsQuizCards.length} 問正解`;
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
    const qText = dsListReverse ? c.answer : c.question;
    const qImgs = dsListReverse ? c.imgs_a : c.imgs_q;
    const aText = dsListReverse ? c.question : c.answer;
    const aImgs = dsListReverse ? c.imgs_q : c.imgs_a;

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
    const aEl = document.createElement('div');
    aEl.className = 'list-view-a-text';
    item.appendChild(aEl);
    setMathText(aEl, aText);
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
