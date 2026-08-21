// ============================================================
//  Cardmaker-quizplay.js — CardMaker「一人用選択式クイズ」機能（遅延読み込みチャンク）
//  ─────────────────────────────────────────────
//  ★ Cardmaker.js から分離。一覧画面の初期表示には不要な機能なので、
//    Cardmaker.js側の loadChunksInBackground() が、一覧の初期表示が
//    終わった後にバックグラウンドで読み込む（このファイル単体では動かず、
//    Cardmaker.jsが先に読み込まれている前提。decks/showScreen/esc/
//    setMathText/CHOICE_LETTERS/CHOICE_MIN/waitForPendingSync/
//    ensureDeckCardsLoaded/showCmConfirm/showCmAlert/getLoginSession/
//    API_BASE/GUILD_ID/cardKey/getUnsureSet/saveUnsureSet/markCardSeen
//    などCardmaker.js側のグローバル関数・変数をそのまま使う）。
//
//  ★ 追加（2026/08/21）：以前は通常のフラッシュカード学習（自動採点・
//    「わからない」マーク・「わかる率」への学習済み記録）と挙動が
//    揃っておらず、選択式クイズだけ間違えても何も記録が残らなかった。
//    通常の学習と同じ感覚で使えるよう、markCardSeen（学習済み記録）と
//    「間違えたら自動でわからないマーク／手動トグルも可能」を追加した。
//
//  みんなでクイズ（Quiz.js）でホストが作ったオリジナル4択クイズは、
//  bot.py側で自動的に「クイズ過去問」フォルダへデッキとしてアーカイブされる
//  （各カードに choices/correct_indices が入る単一正解デッキとして）。
//  ユーザーがCardMakerで自作する多肢選択デッキ（2〜5択・単一/複数正解）も
//  同じ画面・同じデータ形式（choices/correct_indices）でここから遊べる。
//  ライブルームには接続せず、この画面の中だけで完結する一人用モード。
//  プレイ後はサーバーにスコアを送り、そのデッキの過去の挑戦者全員の中での
//  順位（ランキング）を取得して表示する。
// ============================================================
let soloQuizDeckId  = null;
let soloQuizCards   = [];
let soloQuizIdx     = 0;
let soloQuizScore   = 0;
let soloQuizAnswered = false;
let soloQuizSelected = new Set();  // ★ 追加：複数正解モードで、まだ回答確定前に選んでいる選択肢

async function startSoloQuiz(deckId) {
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return;

  await waitForPendingSync(deckId);
  let result = await ensureDeckCardsLoaded(deckId, true);
  while (!result.ok) {
    const retry = await showCmConfirm({
      title: '読み込みに失敗しました',
      desc: '通信環境を確認してもう一度お試しください。',
      okLabel: 'もう一度試す', cancelLabel: 'やめる',
    });
    if (!retry) return;
    result = await ensureDeckCardsLoaded(deckId, true);
  }

  const freshDeck = decks.find(d => d.id === deckId);
  // ★ 修正：4択固定だったのを2〜5択に一般化。旧形式（correct_index単数）の
  //   カードも correct_indices（配列）へ正規化してから使う（元の配列は書き換えない）。
  const playable = freshDeck.cards
    .filter(c => Array.isArray(c.choices) && c.choices.length >= CHOICE_MIN)
    .map(c => ({
      ...c,
      correct_indices: Array.isArray(c.correct_indices) ? c.correct_indices
        : (typeof c.correct_index === 'number' ? [c.correct_index] : []),
    }))
    .filter(c => c.correct_indices.length >= 1);
  if (!playable.length) {
    await showCmAlert({ title: '選択式の問題がありません', desc: 'このデッキには選択式の問題がまだありません。' });
    return;
  }

  soloQuizDeckId = deckId;
  soloQuizCards  = [...playable];
  // 出題順をシャッフル（Fisher-Yates。shuffleStudy()と同じやり方）
  for (let i = soloQuizCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [soloQuizCards[i], soloQuizCards[j]] = [soloQuizCards[j], soloQuizCards[i]];
  }
  soloQuizIdx = 0;
  soloQuizScore = 0;

  document.getElementById('qp-title').textContent = freshDeck.name;
  document.getElementById('qp-result-content').style.display = 'none';
  document.getElementById('qp-play-content').style.display = '';
  showScreen('quiz-play');
  renderQuizPlayQuestion();
}

function renderQuizPlayQuestion() {
  const card = soloQuizCards[soloQuizIdx];
  soloQuizAnswered = false;
  soloQuizSelected = new Set();
  // ★ 追加：通常のフラッシュカード学習（renderStudyCard→markCardSeen）と同じく、
  //   問題を表示した時点で「学習済み」として記録する（みんなの「わかる率」の対象にするため）。
  markCardSeen(soloQuizDeckId, card);
  document.getElementById('qp-score-label').textContent = `${soloQuizScore}点`;
  const pct = soloQuizCards.length > 1 ? (soloQuizIdx / soloQuizCards.length) * 100 : 0;
  document.getElementById('qp-prog-fill').style.width = pct + '%';
  document.getElementById('qp-prog-label').textContent = `${soloQuizIdx + 1} / ${soloQuizCards.length}`;
  setMathText(document.getElementById('qp-q-text'), card.question);
  // ★ Cardmaker.js側の共通ヘルパー（XSS対策：src属性をDOMプロパティで設定。
  //   save_cardsはimgs_qの中身を検証していないため、共有デッキ経由で他人が
  //   仕込んだ文字列が入りうる。テンプレート文字列でsrc属性を組み立てない）
  renderImgList(document.getElementById('qp-q-imgs'), card.imgs_q);

  // ★ 修正：4択固定だったのを、カードの選択肢数（2〜5）に合わせて描画する。
  //   単一/複数正解はデッキ単位ではなく、この問題の正解が何個あるか（correct_indices.length）
  //   で問題ごとに自動的に決まる。
  const isMulti = card.correct_indices.length > 1;
  const choicesEl = document.getElementById('qp-choices');
  choicesEl.innerHTML = card.choices.map((c, i) => `
    <button type="button" class="qp-choice-btn" onclick="${isMulti ? `toggleQuizPlayMultiChoice(${i})` : `answerQuizPlay(${i})`}">
      <b>${CHOICE_LETTERS[i]}.</b> <span id="qp-choice-text-${i}"></span>
    </button>`).join('');
  card.choices.forEach((c, i) => setMathText(document.getElementById(`qp-choice-text-${i}`), c));

  document.getElementById('qp-next-wrap').style.display = 'none';
  // ★ 追加：複数正解モードは選び終えてから送信ボタンで確定する
  document.getElementById('qp-submit-wrap').style.display = isMulti ? '' : 'none';
}

// ★ 追加：複数正解モードで、選択肢のON/OFFを切り替える（まだ回答は確定しない）
function toggleQuizPlayMultiChoice(idx) {
  if (soloQuizAnswered) return;
  const btn = document.querySelectorAll('#qp-choices .qp-choice-btn')[idx];
  if (soloQuizSelected.has(idx)) {
    soloQuizSelected.delete(idx);
    btn.classList.remove('qp-selected');
  } else {
    soloQuizSelected.add(idx);
    btn.classList.add('qp-selected');
  }
}

// ★ 追加：間違えた問題を自動で「わからない」にマークする（通常のフラッシュカード
//   学習の自動採点＝gradeCurrentAnswer と同じルール）。
//   ×だった場合のみ、まだマークされていなければ追加する。○の場合は既存のマークを
//   勝手に外したりはしない（gradeCurrentAnswerと同じ方針）。
function autoMarkUnsureIfWrong(card, isCorrect) {
  if (isCorrect) return;
  const key = cardKey(card);
  const unsure = getUnsureSet(soloQuizDeckId);
  if (!unsure.has(key)) {
    unsure.add(key);
    saveUnsureSet(soloQuizDeckId, unsure);
  }
}

// ★ 追加：通常のフラッシュカード学習の「わからない」トグルボタンと同じ役割。
//   選択式クイズは回答すると次の問題へ自動的に進むため、「答えを見た後」の
//   study-nav と同じタイミング（qp-next-wrapが表示されている間）だけ操作できる。
function updateQuizPlayUnsureBtn() {
  const card = soloQuizCards[soloQuizIdx];
  const btn = document.getElementById('qp-unsure-btn');
  if (!card || !btn) return;
  const unsure = getUnsureSet(soloQuizDeckId);
  btn.textContent = 'わからない';
  btn.classList.toggle('marked', unsure.has(cardKey(card)));
}
function toggleQuizPlayUnsure() {
  const card = soloQuizCards[soloQuizIdx];
  if (!card) return;
  const key = cardKey(card);
  const unsure = getUnsureSet(soloQuizDeckId);
  if (unsure.has(key)) unsure.delete(key); else unsure.add(key);
  saveUnsureSet(soloQuizDeckId, unsure);
  updateQuizPlayUnsureBtn();
}

// ★ 追加：複数正解モードの回答を確定する（qp-submit-btnから呼ばれる）
function submitQuizPlayMulti() {
  if (soloQuizAnswered || soloQuizSelected.size === 0) return;
  soloQuizAnswered = true;
  const card = soloQuizCards[soloQuizIdx];
  const correctSet = new Set(card.correct_indices);
  // ★ 選んだ選択肢の集合が正解の集合と完全に一致していれば正解とする
  const isCorrect = correctSet.size === soloQuizSelected.size && [...correctSet].every(i => soloQuizSelected.has(i));
  if (isCorrect) {
    soloQuizScore++;
    document.getElementById('qp-score-label').textContent = `${soloQuizScore}点`;
  }
  autoMarkUnsureIfWrong(card, isCorrect);

  [...document.querySelectorAll('#qp-choices .qp-choice-btn')].forEach((btn, i) => {
    btn.disabled = true;
    btn.classList.remove('qp-selected');
    if (correctSet.has(i)) btn.classList.add('qp-correct');
    else if (soloQuizSelected.has(i)) btn.classList.add('qp-wrong');
    else btn.classList.add('qp-dim');
  });

  document.getElementById('qp-submit-wrap').style.display = 'none';
  document.getElementById('qp-next-wrap').style.display = '';
  document.getElementById('qp-next-btn').textContent =
    soloQuizIdx === soloQuizCards.length - 1 ? '結果を見る →' : '次へ →';
  updateQuizPlayUnsureBtn();
}

function answerQuizPlay(idx) {
  if (soloQuizAnswered) return;
  soloQuizAnswered = true;
  const card = soloQuizCards[soloQuizIdx];
  const isCorrect = card.correct_indices.includes(idx);
  if (isCorrect) {
    soloQuizScore++;
    document.getElementById('qp-score-label').textContent = `${soloQuizScore}点`;
  }
  autoMarkUnsureIfWrong(card, isCorrect);

  [...document.querySelectorAll('#qp-choices .qp-choice-btn')].forEach((btn, i) => {
    btn.disabled = true;
    if (card.correct_indices.includes(i)) btn.classList.add('qp-correct');
    else if (i === idx) btn.classList.add('qp-wrong');
    else btn.classList.add('qp-dim');
  });

  document.getElementById('qp-next-wrap').style.display = '';
  document.getElementById('qp-next-btn').textContent =
    soloQuizIdx === soloQuizCards.length - 1 ? '結果を見る →' : '次へ →';
  updateQuizPlayUnsureBtn();
}

function quizPlayNext() {
  soloQuizIdx++;
  if (soloQuizIdx >= soloQuizCards.length) {
    finishSoloQuiz();
  } else {
    renderQuizPlayQuestion();
  }
}

async function finishSoloQuiz() {
  document.getElementById('qp-play-content').style.display = 'none';
  document.getElementById('qp-result-content').style.display = '';

  const total = soloQuizCards.length;
  document.getElementById('qp-result-score').textContent = `${soloQuizScore} / ${total} 問正解！`;
  document.getElementById('qp-result-rank').textContent = '結果を送信しています…';
  document.getElementById('qp-leaderboard').innerHTML = '';

  const session = getLoginSession();
  const deck = decks.find(d => d.id === soloQuizDeckId);
  if (!session || !deck || !deck.filename) {
    document.getElementById('qp-result-rank').textContent = '';
    return;
  }

  try {
    await fetch(`${API_BASE}quiz_archive_submit_score`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guild_id: GUILD_ID, session_token: session.session_token,
        filename: deck.filename, score: soloQuizScore, total,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) { /* スコア送信に失敗してもランキング表示は試みる */ }

  try {
    const res = await fetch(`${API_BASE}quiz_archive_leaderboard?filename=${encodeURIComponent(deck.filename)}`, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (data.ok) {
      renderQuizLeaderboard(data.leaderboard, session.student_id);
    } else {
      document.getElementById('qp-result-rank').textContent = '';
    }
  } catch (e) {
    document.getElementById('qp-result-rank').textContent = '';
  }
}

function renderQuizLeaderboard(rows, myStudentId) {
  const myRank = rows.findIndex(r => r.student_id === myStudentId) + 1;
  document.getElementById('qp-result-rank').textContent =
    myRank > 0 ? `あなたの順位：${myRank} 位 / ${rows.length} 人中` : '';
  document.getElementById('qp-leaderboard').innerHTML = rows.map((r, i) => `
    <div class="qp-lb-row${r.student_id === myStudentId ? ' me' : ''}">
      <span class="qp-lb-rank">${i + 1}</span>
      <span class="qp-lb-name">${esc(r.nickname)}</span>
      <span class="qp-lb-score">${r.score} / ${r.total}</span>
    </div>`).join('');
}
