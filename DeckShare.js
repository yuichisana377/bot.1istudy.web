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
// ============================================================

const API_BASE = "/api/";
const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E'];
const CHOICE_MIN = 2;

function qs(id) { return document.getElementById(id); }

function getToken() {
  return new URLSearchParams(location.search).get('token') || '';
}

function showStep(name) {
  ['loading', 'error'].forEach(s => {
    const el = qs(`ds-step-${s}`);
    if (el) el.style.display = (s === name) ? '' : 'none';
  });
  qs('ds-body').style.display = (name === 'body') ? 'flex' : 'none';
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
let dsCards = [];        // 暗記カードモードで使う順番（シャッフル可）
let dsIdx = 0;

async function init() {
  const token = getToken();
  if (!token) {
    showStep('error');
    qs('ds-error-msg').textContent = 'リンクが正しくありません。共有してくれた人にもう一度リンクを確認してください。';
    return;
  }
  try {
    const res = await fetch(`${API_BASE}deck_share_info?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok) {
      showStep('error');
      qs('ds-error-msg').textContent = data.error || 'このリンクは無効です。';
      return;
    }
    deckShare = data;
    renderDeckMeta();
    const playable = getPlayableChoiceCards();
    if (data.choice_mode && playable.length) {
      startQuizMode(playable);
    } else {
      startFlashMode((data.cards || []).slice());
    }
    showStep('body');
  } catch (e) {
    showStep('error');
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

function renderDeckMeta() {
  document.title = `${deckShare.name || '共有デッキ'} — 共有デッキ`;
  qs('ds-title').textContent = deckShare.name || '共有デッキ';
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
  if (deckShare.incomplete) badges.push('作成中のデッキ');
  if (deckShare.shared_by) badges.push(`${deckShare.shared_by}さんが共有`);
  badges.forEach(t => {
    const b = document.createElement('span');
    b.className = 'ds-badge';
    b.textContent = t;
    sub.appendChild(b);
  });
  meta.appendChild(sub);
}

// ============================================================
//  暗記カード（フリップ学習）モード
// ============================================================
function startFlashMode(cards) {
  qs('ds-flash').style.display = 'flex';
  qs('ds-shuffle-btn').style.display = '';
  dsCards = cards;
  dsIdx = 0;
  renderFlashCard();
}

function shuffleDeckShare() {
  for (let i = dsCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [dsCards[i], dsCards[j]] = [dsCards[j], dsCards[i]];
  }
  dsIdx = 0;
  qs('ds-done').style.display = 'none';
  qs('ds-flash-content').style.display = 'flex';
  qs('ds-quiz-done').style.display = 'none';
  qs('ds-quiz-play').style.display = '';
  if (deckShare.choice_mode && getPlayableChoiceCards().length) {
    dsQuizCards = getPlayableChoiceCards();
    for (let i = dsQuizCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dsQuizCards[i], dsQuizCards[j]] = [dsQuizCards[j], dsQuizCards[i]];
    }
    dsQuizIdx = 0;
    dsQuizScore = 0;
    renderQuizQuestion();
  } else {
    renderFlashCard();
  }
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
  setMathText(qs('ds-q-text'), c.question);
  renderImgList(qs('ds-q-imgs'), c.imgs_q);
  qs('ds-answer-panel').classList.remove('show');
  qs('ds-reveal-bar').style.display = 'flex';
  qs('ds-nav').style.display = 'none';

  setMathText(qs('ds-a-text'), c.answer);
  renderImgList(qs('ds-a-imgs'), c.imgs_a);
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
  qs('ds-shuffle-btn').style.display = '';
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

init();
hideLoadingFallback();
