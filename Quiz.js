// ============================================================
//  Quiz.js — みんなでクイズ（オンライン早押し4択）
//  Quiz.html から読み込む。Cardmaker.js / Login.js と同じ
//  ログインセッション（localStorage の sl_session）をそのまま使う。
// ============================================================

const API_BASE = "https://chiro-ubuntuserver.tail1130ba.ts.net/";
const GUILD_ID = "1509880344806162544";
const LOGIN_PATH = '/Login.html';
const SESSION_KEY = 'sl_session';

function getLoginSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

// ── 未ログインならログイン画面へ（Cardmaker.js と同じ考え方） ──
(function () {
  const s = getLoginSession();
  if (!s || !s.session_token) {
    sessionStorage.setItem('post_login_redirect', location.href);
    location.replace(LOGIN_PATH);
  }
})();

const STUDENT = (function () {
  const s = getLoginSession() || {};
  return { id: s.student_id, nickname: s.nickname, sessionToken: s.session_token };
})();

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

// ── 通信ヘルパー ──────────────────────────
async function apiGet(path, params = {}, timeoutMs = 8000) {
  const qs = new URLSearchParams(params).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}?${qs}`, { signal: controller.signal, cache: 'no-store' });
    return await res.json();
  } catch (e) {
    return { ok: false, error: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
async function apiPost(path, body = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
function withAuth(extra = {}) {
  return { guild_id: GUILD_ID, session_token: STUDENT.sessionToken, ...extra };
}

// ── 画面切り替え ──────────────────────────
function showScreenQ(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  window.scrollTo(0, 0);
}

// ── 確認モーダル（Cardmaker.js の showCmConfirm と同じ考え方の簡易版） ──
function showConfirm({ title, desc = '', okLabel = 'OK', cancelLabel = 'キャンセル' }) {
  return new Promise(resolve => {
    const overlay = document.getElementById('qz-confirm-overlay');
    document.getElementById('qz-confirm-title').textContent = title;
    document.getElementById('qz-confirm-desc').textContent = desc;
    const okBtn = document.getElementById('qz-confirm-ok');
    const cancelBtn = document.getElementById('qz-confirm-cancel');
    okBtn.textContent = okLabel;
    cancelBtn.textContent = cancelLabel;
    overlay.classList.add('active');
    function finish(v) {
      overlay.classList.remove('active');
      okBtn.onclick = null; cancelBtn.onclick = null;
      resolve(v);
    }
    okBtn.onclick = () => finish(true);
    cancelBtn.onclick = () => finish(false);
  });
}

// ── グローバル状態 ──────────────────────────
let roomCode = null;
let isHost = false;
let pollHandle = null;
let tickHandle = null;
let lastRoomSnapshot = null;
let renderedQIndex = -1;   // 直近に描画した問題番号（変わったら回答UIをリセットする）
let renderedState = null;  // 直近に描画した room.state
let hasAnsweredThisQ = false;
let quitting = false;      // 退出処理中の二重実行防止
let launchDeckInfo = null; // ?mode=host&deck=... で渡されたデッキ情報

// ============================================================
//  起動
// ============================================================
async function initQuizApp() {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode');
  const codeParam = (params.get('code') || '').toUpperCase();

  document.getElementById('home-account').textContent = STUDENT.nickname ? `${STUDENT.nickname} さん` : '';

  if (mode === 'host') {
    launchDeckInfo = {
      filename: params.get('deck'),
      name: params.get('name') ? decodeURIComponent(params.get('name')) : '',
    };
    showScreenQ('home');
    goHostSetupScreen();
  } else if (mode === 'join' || codeParam) {
    showScreenQ('home');
    goJoinScreen();
    if (codeParam) document.getElementById('join-code-input').value = codeParam;
  } else {
    showScreenQ('home');
  }
}

function backToHomeFromResult() {
  stopPolling();
  roomCode = null; isHost = false; renderedQIndex = -1; renderedState = null;
  history.replaceState(null, '', location.pathname);
  showScreenQ('home');
}

// ============================================================
//  参加する（プレイヤー）
// ============================================================
function goJoinScreen() {
  document.getElementById('join-error').textContent = '';
  showScreenQ('join');
  setTimeout(() => document.getElementById('join-code-input').focus(), 50);
}

async function submitJoin() {
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  const errEl = document.getElementById('join-error');
  errEl.textContent = '';
  if (code.length < 4) { errEl.textContent = 'コードを入力してください'; return; }
  const btn = document.getElementById('join-submit-btn');
  btn.disabled = true; btn.textContent = '参加中…';
  const data = await apiPost('quiz_join', withAuth({ code }));
  btn.disabled = false; btn.textContent = '参加する';
  if (!data.ok) {
    errEl.textContent = quizErrorText(data.error);
    return;
  }
  roomCode = code;
  isHost = !!data.is_host;
  renderedQIndex = -1; renderedState = null;
  history.replaceState(null, '', `${location.pathname}?code=${code}`);
  if (isHost) {
    // 自分が作ったルームに自分のコードでもう一度入った場合など
    renderRoom(data.room);
  } else {
    renderRoom(data.room);
  }
  startPolling();
}

function quizErrorText(code) {
  return {
    room_not_found: 'そのコードのクイズは見つかりませんでした',
    not_logged_in: 'ログインが切れています。ログインし直してください',
    network: '通信に失敗しました。もう一度お試しください',
  }[code] || (code ? `エラー: ${code}` : '不明なエラーが発生しました');
}

// ============================================================
//  クイズを作る（ホスト：セットアップ）
// ============================================================
async function goHostSetupScreen() {
  showScreenQ('host-setup');
  document.getElementById('hs-error').textContent = '';

  if (launchDeckInfo && launchDeckInfo.filename) {
    // デッキのメニューから直接来た場合：デッキ選択を固定表示にする
    document.getElementById('hs-title').value = launchDeckInfo.name || '';
    setHostSource('deck');
    const sel = document.getElementById('hs-deck-select');
    sel.innerHTML = `<option value="${escapeHtml(launchDeckInfo.filename)}">${escapeHtml(launchDeckInfo.name || launchDeckInfo.filename)}</option>`;
    sel.disabled = true;
    document.querySelectorAll('#hs-source-toggle .qz-toggle-opt').forEach(b => b.disabled = true);
  } else {
    document.querySelectorAll('#hs-source-toggle .qz-toggle-opt').forEach(b => b.disabled = false);
    const sel = document.getElementById('hs-deck-select');
    sel.disabled = false;
    sel.innerHTML = `<option>読み込み中…</option>`;
    const data = await apiGet('list_cards');
    if (data.ok && data.sets) {
      const sets = data.sets.filter(s => !s.incomplete);
      if (!sets.length) {
        sel.innerHTML = `<option value="">公開されているデッキがありません</option>`;
      } else {
        sel.innerHTML = sets.map(s =>
          `<option value="${escapeHtml(s.filename)}">${escapeHtml(s.name)}${s.subject ? '（' + escapeHtml(s.subject) + '）' : ''}</option>`
        ).join('');
      }
    } else {
      sel.innerHTML = `<option value="">読み込みに失敗しました</option>`;
    }
  }

  if (!document.getElementById('hs-manual-list').children.length) {
    addManualQuestion(); // 最低1問は入力欄を出しておく
  }
}

function setHostSource(src) {
  document.querySelectorAll('#hs-source-toggle .qz-toggle-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.src === src);
  });
  document.getElementById('hs-deck-panel').style.display = src === 'deck' ? '' : 'none';
  document.getElementById('hs-manual-panel').style.display = src === 'manual' ? '' : 'none';
}

let manualQCounter = 0;
function addManualQuestion() {
  manualQCounter++;
  const idx = manualQCounter;
  const wrap = document.createElement('div');
  wrap.className = 'qz-manual-card';
  wrap.dataset.qid = idx;
  const letters = ['A', 'B', 'C', 'D'];
  wrap.innerHTML = `
    <div class="qz-manual-card-head">
      <b>問題 #${document.getElementById('hs-manual-list').children.length + 1}</b>
      <button type="button" class="qz-manual-remove" onclick="removeManualQuestion(${idx})">削除</button>
    </div>
    <input class="qz-input mq-question" placeholder="問題文" maxlength="200">
    ${letters.map((l, i) => `
      <div class="qz-manual-choice-row">
        <input type="radio" name="mq-correct-${idx}" value="${i}" ${i === 0 ? 'checked' : ''}>
        <input class="qz-input mq-choice" placeholder="選択肢 ${l}" maxlength="80">
      </div>`).join('')}
  `;
  document.getElementById('hs-manual-list').appendChild(wrap);
}
function removeManualQuestion(idx) {
  const el = document.querySelector(`.qz-manual-card[data-qid="${idx}"]`);
  if (el) el.remove();
  document.querySelectorAll('#hs-manual-list .qz-manual-card').forEach((el2, i) => {
    el2.querySelector('.qz-manual-card-head b').textContent = `問題 #${i + 1}`;
  });
}
function collectManualQuestions() {
  const cards = [...document.querySelectorAll('#hs-manual-list .qz-manual-card')];
  const out = [];
  for (const card of cards) {
    const question = card.querySelector('.mq-question').value.trim();
    const choiceInputs = [...card.querySelectorAll('.mq-choice')];
    const choices = choiceInputs.map(i => i.value.trim());
    const radios = [...card.querySelectorAll('input[type=radio]')];
    const checked = radios.find(r => r.checked);
    const correct_index = checked ? Number(checked.value) : 0;
    out.push({ question, choices, correct_index });
  }
  return out;
}

async function submitCreateRoom() {
  const errEl = document.getElementById('hs-error');
  errEl.textContent = '';
  const title = document.getElementById('hs-title').value.trim();
  const isDeckSrc = document.querySelector('#hs-source-toggle .qz-toggle-opt[data-src="deck"]').classList.contains('active');
  const time_limit_sec = Number(document.getElementById('hs-time-limit').value);

  const body = withAuth({ title, time_limit_sec });

  if (isDeckSrc) {
    const filename = document.getElementById('hs-deck-select').value;
    if (!filename) { errEl.textContent = 'デッキを選んでください'; return; }
    body.source = 'deck';
    body.deck_filename = filename;
    const numQ = document.getElementById('hs-num-questions').value;
    if (numQ) body.num_questions = Number(numQ);
  } else {
    const questions = collectManualQuestions();
    if (!questions.length) { errEl.textContent = '問題を1つ以上入力してください'; return; }
    for (const q of questions) {
      if (!q.question || q.choices.some(c => !c)) {
        errEl.textContent = '問題文と4つの選択肢をすべて入力してください';
        return;
      }
    }
    body.source = 'manual';
    body.questions = questions;
  }

  const btn = document.getElementById('hs-create-btn');
  btn.disabled = true; btn.textContent = '作成中…';
  const data = await apiPost('quiz_create', body, 12000);
  btn.disabled = false; btn.textContent = 'クイズを作成する';
  if (!data.ok) { errEl.textContent = quizErrorText(data.error); return; }

  roomCode = data.code;
  isHost = true;
  renderedQIndex = -1; renderedState = null;
  history.replaceState(null, '', `${location.pathname}?code=${data.code}`);
  document.getElementById('hl-code').textContent = data.code;
  document.getElementById('hl-title').textContent = title || 'みんなでクイズ';
  showScreenQ('host-lobby');
  startPolling();
}

// ============================================================
//  ポーリング（1秒ごとに状態を取得して描画）
// ============================================================
function startPolling() {
  stopPolling();
  pollOnce();
  pollHandle = setInterval(pollOnce, 1000);
  tickHandle = setInterval(tickTimerBars, 200);
}
function stopPolling() {
  if (pollHandle) clearInterval(pollHandle);
  if (tickHandle) clearInterval(tickHandle);
  pollHandle = null; tickHandle = null;
}
async function pollOnce() {
  if (!roomCode) return;
  const data = await apiGet('quiz_state', withAuth({ code: roomCode }));
  if (!data.ok) {
    if (data.error === 'room_not_found') {
      stopPolling();
      await showConfirm({ title: 'このクイズは終了しました', desc: 'ホストが退出したか、時間が経ちすぎたため終了しました。', okLabel: 'ホームに戻る', cancelLabel: '閉じる' });
      backToHomeFromResult();
    }
    return;
  }
  isHost = !!data.is_host;
  renderRoom(data.room);
}

// ============================================================
//  描画：状態(state)に応じて出し分ける
// ============================================================
function renderRoom(room) {
  lastRoomSnapshot = room;

  if (room.state === 'lobby') {
    renderLobby(room);
  } else if (room.state === 'question' || room.state === 'reveal') {
    if (isHost) renderHostPlay(room); else renderPlayerPlay(room);
  } else if (room.state === 'ended') {
    renderResult(room);
  }
}

function renderLobby(room) {
  const screenId = isHost ? 'host-lobby' : 'player-lobby';
  showScreenQ(screenId);
  const titleEl = document.getElementById(isHost ? 'hl-title' : 'pl-title');
  titleEl.textContent = room.title;

  if (isHost) {
    document.getElementById('hl-code').textContent = room.code;
    document.getElementById('hl-count').textContent = `参加者 ${room.players.length}人`;
    document.getElementById('hl-players').innerHTML = playerChipsHtml(room.players);
    document.getElementById('hl-start-btn').disabled = room.players.length === 0;
  } else {
    document.getElementById('pl-status').textContent = `${room.host_nickname} さんが開始するのを待っています…（参加者 ${room.players.length}人）`;
    document.getElementById('pl-players').innerHTML = playerChipsHtml(room.players);
  }
}

function playerChipsHtml(players) {
  if (!players.length) return `<p style="color:var(--text-dim);font-size:13px;">まだ誰も参加していません</p>`;
  return players.map(p => `
    <div class="qz-player-chip">
      <span class="qz-avatar" style="background:${escapeHtml(p.color)};color:${escapeHtml(p.text_color)}">${escapeHtml((p.nickname || '').slice(0, 2).toUpperCase())}</span>
      ${escapeHtml(p.nickname)}
    </div>`).join('');
}

const CHOICE_CLASSES = ['qz-choice-a', 'qz-choice-b', 'qz-choice-c', 'qz-choice-d'];

function renderHostPlay(room) {
  showScreenQ('host-play');
  const qChanged = room.current_q !== renderedQIndex || room.state !== renderedState;
  renderedQIndex = room.current_q; renderedState = room.state;

  document.getElementById('hp-progress').textContent = `Q ${room.current_q + 1} / ${room.total_questions}`;
  document.getElementById('hp-title').textContent = room.title;
  document.getElementById('hp-question').textContent = room.question.question;
  document.getElementById('hp-answered').textContent = `${room.answered_count} / ${room.total_players} 人が回答`;

  const choicesEl = document.getElementById('hp-choices');
  const revealed = room.state === 'reveal';
  choicesEl.innerHTML = room.question.choices.map((c, i) => `
    <button class="qz-choice-btn ${CHOICE_CLASSES[i]} ${revealed && i !== room.question.correct_index ? 'qz-dim' : ''} ${revealed && i === room.question.correct_index ? 'qz-correct-flash' : ''}" disabled>
      ${escapeHtml(c)}
    </button>`).join('');

  const revealPanel = document.getElementById('hp-reveal');
  const nextBtn = document.getElementById('hp-next-btn');
  if (revealed) {
    revealPanel.style.display = '';
    document.getElementById('hp-first-badge').textContent = room.first_correct_nickname
      ? `⚡ 一番早く正解：${room.first_correct_nickname} さん（+2点ボーナス）`
      : '⚡ 正解者はいませんでした';
    document.getElementById('hp-leaderboard').innerHTML = miniLeaderboardHtml(room.players);
    const isLast = room.current_q + 1 >= room.total_questions;
    nextBtn.textContent = isLast ? '結果を見る' : '次の問題へ';
  } else {
    revealPanel.style.display = 'none';
    nextBtn.textContent = '正解を発表する';
  }

  updateTimerBarFor(room, 'hp-timerbar');
}

function miniLeaderboardHtml(players) {
  return players.slice(0, 5).map((p, i) => `
    <div class="qz-lb-row">
      <span class="qz-lb-rank">${i + 1}</span>
      <span class="qz-avatar" style="background:${escapeHtml(p.color)};color:${escapeHtml(p.text_color)}">${escapeHtml((p.nickname || '').slice(0, 2).toUpperCase())}</span>
      <span class="qz-lb-name">${escapeHtml(p.nickname)}</span>
      <span class="qz-lb-score">${p.score}点</span>
    </div>`).join('');
}

function renderPlayerPlay(room) {
  showScreenQ('player-play');
  const qChanged = room.current_q !== renderedQIndex;
  const stateChanged = room.state !== renderedState;
  if (qChanged) hasAnsweredThisQ = false;
  renderedQIndex = room.current_q; renderedState = room.state;

  document.getElementById('pp-progress').textContent = `Q ${room.current_q + 1} / ${room.total_questions}`;
  const myScore = room.players.find(p => p.id === STUDENT.id)?.score ?? 0;
  document.getElementById('pp-score').textContent = `${myScore}点`;
  document.getElementById('pp-question').textContent = room.question.question;

  const revealed = room.state === 'reveal';
  const yourAnswer = room.your_answer;
  const answered = (yourAnswer !== undefined) || hasAnsweredThisQ;

  const choicesEl = document.getElementById('pp-choices');
  if (qChanged || stateChanged || !choicesEl.dataset.built || Number(choicesEl.dataset.built) !== room.current_q) {
    choicesEl.innerHTML = room.question.choices.map((c, i) => `
      <button class="qz-choice-btn ${CHOICE_CLASSES[i]}" onclick="submitAnswer(${i})">${escapeHtml(c)}</button>`).join('');
    choicesEl.dataset.built = room.current_q;
  }

  [...choicesEl.children].forEach((btn, i) => {
    btn.disabled = answered || revealed;
    btn.classList.toggle('qz-picked', yourAnswer === i);
    if (revealed) {
      btn.classList.toggle('qz-correct-flash', i === room.question.correct_index);
      btn.classList.toggle('qz-dim', i !== room.question.correct_index && yourAnswer !== i);
    } else {
      btn.classList.remove('qz-correct-flash', 'qz-dim');
    }
  });

  const feedbackEl = document.getElementById('pp-feedback');
  const waitingNote = document.getElementById('pp-waiting-note');
  if (revealed && yourAnswer !== undefined) {
    feedbackEl.style.display = '';
    if (room.your_correct) {
      const bonus = room.first_correct_nickname === STUDENT.nickname;
      feedbackEl.className = 'qz-answer-feedback ok';
      feedbackEl.textContent = bonus ? '🎉 正解！一番乗りボーナスで +12点！' : '✅ 正解！ +10点';
    } else {
      feedbackEl.className = 'qz-answer-feedback ng';
      feedbackEl.textContent = '❌ 不正解…';
    }
    waitingNote.style.display = 'none';
  } else if (revealed && yourAnswer === undefined) {
    feedbackEl.style.display = '';
    feedbackEl.className = 'qz-answer-feedback ng';
    feedbackEl.textContent = '⏰ 時間切れで未回答でした';
    waitingNote.style.display = 'none';
  } else if (answered) {
    feedbackEl.style.display = 'none';
    waitingNote.style.display = '';
  } else {
    feedbackEl.style.display = 'none';
    waitingNote.style.display = 'none';
  }

  updateTimerBarFor(room, 'pp-timerbar');
}

// タイマーバー：サーバーの question_started_at + time_limit_sec を基準に、
// クライアント側では200msごとに残り時間を計算してスムーズに減らしていく。
function updateTimerBarFor(room, elId) {
  const el = document.getElementById(elId);
  el.dataset.startedAt = room.question_started_at || '';
  el.dataset.limit = room.time_limit_sec;
  el.dataset.frozen = room.state === 'reveal' ? '1' : '0';
}
function tickTimerBars() {
  ['hp-timerbar', 'pp-timerbar'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || !el.dataset.startedAt) return;
    if (el.dataset.frozen === '1') { el.style.transform = 'scaleX(0)'; return; }
    const started = Number(el.dataset.startedAt) * 1000;
    const limit = Number(el.dataset.limit) * 1000;
    const remain = Math.max(0, limit - (Date.now() - started));
    el.style.transform = `scaleX(${remain / limit})`;
  });
}

async function submitAnswer(choiceIndex) {
  if (hasAnsweredThisQ) return;
  hasAnsweredThisQ = true;
  const choicesEl = document.getElementById('pp-choices');
  [...choicesEl.children].forEach((btn, i) => {
    btn.disabled = true;
    btn.classList.toggle('qz-picked', i === choiceIndex);
  });
  document.getElementById('pp-waiting-note').style.display = '';
  await apiPost('quiz_answer', withAuth({ code: roomCode, choice_index: choiceIndex }));
  pollOnce();
}

// ============================================================
//  ホスト操作
// ============================================================
async function hostStart() {
  const btn = document.getElementById('hl-start-btn');
  btn.disabled = true;
  const data = await apiPost('quiz_start', withAuth({ code: roomCode }));
  if (!data.ok) { btn.disabled = false; alert(quizErrorText(data.error)); return; }
  renderRoom(data.room);
}
async function hostNext() {
  const btn = document.getElementById('hp-next-btn');
  btn.disabled = true;
  const data = await apiPost('quiz_next', withAuth({ code: roomCode }));
  btn.disabled = false;
  if (!data.ok) { alert(quizErrorText(data.error)); return; }
  renderRoom(data.room);
}
async function confirmQuitHost() {
  if (quitting) return;
  const ok = await showConfirm({
    title: 'クイズを終了しますか？',
    desc: '進行中のクイズを終了し、ホームに戻ります。参加者にはそこまでの結果が表示されます。',
    okLabel: '終了する',
  });
  if (!ok) return;
  quitting = true;
  await apiPost('quiz_end', withAuth({ code: roomCode }));
  quitting = false;
  stopPolling();
  backToHomeFromResult();
}
async function confirmQuitPlayer() {
  if (quitting) return;
  const ok = await showConfirm({
    title: 'クイズから退出しますか？',
    desc: 'これまでの得点は保存されません。',
    okLabel: '退出する',
  });
  if (!ok) return;
  quitting = true;
  await apiPost('quiz_leave', withAuth({ code: roomCode }));
  quitting = false;
  stopPolling();
  backToHomeFromResult();
}

// ============================================================
//  結果発表
// ============================================================
function renderResult(room) {
  stopPolling();
  showScreenQ('result');
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  const podiumOrder = [sorted[1], sorted[0], sorted[2]]; // 2位・1位・3位の順で表示（真ん中が1位）
  const medalMap = ['🥈', '🥇', '🥉'];
  const podiumClass = ['qz-podium-2', 'qz-podium-1', 'qz-podium-3'];
  document.getElementById('result-podium').innerHTML = podiumOrder.map((p, i) => {
    if (!p) return `<div class="qz-podium-col ${podiumClass[i]}"></div>`;
    return `
      <div class="qz-podium-col ${podiumClass[i]}">
        <div class="qz-podium-name">${escapeHtml(p.nickname)}</div>
        <div class="qz-podium-score">${p.score}点</div>
        <div class="qz-podium-bar"><span class="qz-podium-medal">${medalMap[i]}</span></div>
      </div>`;
  }).join('');
  document.getElementById('result-list').innerHTML = sorted.map((p, i) => `
    <div class="qz-lb-row">
      <span class="qz-lb-rank">${i + 1}</span>
      <span class="qz-avatar" style="background:${escapeHtml(p.color)};color:${escapeHtml(p.text_color)}">${escapeHtml((p.nickname || '').slice(0, 2).toUpperCase())}</span>
      <span class="qz-lb-name">${escapeHtml(p.nickname)}</span>
      <span class="qz-lb-score">${p.score}点</span>
    </div>`).join('');
}

initQuizApp();
