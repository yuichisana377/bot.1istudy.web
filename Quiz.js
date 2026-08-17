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
let roomListHandle = null; // 参加ルーム一覧のポーリング（screen-join を表示中だけ動かす）
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
  } else if (codeParam) {
    // ★ 共有リンク等、コード付きURLで直接開かれた場合はそのまま参加を試みる
    //   （参加者は普段コードを意識しなくてよいが、リンク共有自体は引き続き使える）。
    showScreenQ('home');
    joinRoomByCode(codeParam);
  } else if (mode === 'join') {
    showScreenQ('home');
    goJoinScreen();
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
//  参加する（プレイヤー）：コード入力の代わりに、参加できるルームを一覧から選ぶ
// ============================================================
function goJoinScreen() {
  showScreenQ('join');
  loadRoomList();
  startRoomListPolling();
}

function backFromJoinScreen() {
  stopRoomListPolling();
  showScreenQ('home');
}

async function loadRoomList() {
  const listEl = document.getElementById('join-room-list');
  const data = await apiGet('quiz_list_rooms', withAuth());
  if (!data.ok) {
    listEl.innerHTML = `<p class="qz-label">読み込みに失敗しました（${quizErrorText(data.error)}）</p>`;
    return;
  }
  const rooms = data.rooms || [];
  if (!rooms.length) {
    listEl.innerHTML = `<p class="qz-label">現在参加できるクイズはありません。ホストが作成すると、ここに表示されます。</p>`;
    return;
  }
  // ★ 開始後（question/reveal）のルームも「プレイ中」として出しっぱなしにする
  //   （終了(ended)するまで一覧に残る）。ホストが途中参加を許可していれば
  //   そこから参加できる（joinable=true）。許可していない場合は、状況が
  //   分かるように表示だけはするが、タップしても参加できないようにする。
  listEl.innerHTML = rooms.map(r => {
    const inProgress = r.state !== 'lobby';
    const joinable = r.state === 'lobby' || r.allow_late_join;
    const statusText = !inProgress
      ? '参加受付中'
      : (joinable ? `🔴 プレイ中（第${r.current_q + 1}問）` : '🔒 プレイ中・途中参加不可');
    const tag = joinable ? 'button' : 'div';
    const typeAttr = joinable ? ' type="button"' : '';
    const clickAttr = joinable ? ` onclick="joinRoomByCode('${r.code}')"` : '';
    const disabledClass = joinable ? '' : ' qz-room-row-disabled';
    return `
    <${tag} class="qz-room-row${disabledClass}"${typeAttr}${clickAttr}>
      <div class="qz-room-row-main">
        <div class="qz-room-row-title">${escapeHtml(r.title)}</div>
        <div class="qz-room-row-sub">${escapeHtml(r.host_nickname)} さん・${r.question_count}問・${statusText}</div>
      </div>
      <div class="qz-room-row-count">👥 ${r.player_count}</div>
    </${tag}>`;
  }).join('');
}

// ★ 参加できるルームは一覧表示中に増えたり（新規作成）消えたり（開始・終了）するため、
//   一覧画面を見ている間だけ定期的に取り直す（他の画面に移ったら止める）。
function startRoomListPolling() {
  stopRoomListPolling();
  roomListHandle = setInterval(loadRoomList, 3000);
}
function stopRoomListPolling() {
  if (roomListHandle) clearInterval(roomListHandle);
  roomListHandle = null;
}

async function joinRoomByCode(code) {
  code = (code || '').trim().toUpperCase();
  if (!code) return;
  stopRoomListPolling();
  const data = await apiPost('quiz_join', withAuth({ code }));
  if (!data.ok) {
    await showConfirm({
      title: '参加できませんでした', desc: quizErrorText(data.error),
      okLabel: 'OK', cancelLabel: '閉じる',
    });
    // ★ 開始されてしまった等で失敗した場合は、一覧画面に戻って表示し直す
    //   （その部屋はもう一覧から消えているはず）。共有リンクからの直接参加で
    //   失敗した場合の受け皿にもなる。
    showScreenQ('join');
    loadRoomList();
    startRoomListPolling();
    return;
  }
  roomCode = code;
  isHost = !!data.is_host;
  renderedQIndex = -1; renderedState = null;
  history.replaceState(null, '', `${location.pathname}?code=${code}`);
  renderRoom(data.room);
  startPolling();
}

function quizErrorText(code) {
  return {
    room_not_found: 'そのコードのクイズは見つかりませんでした',
    quiz_already_started: 'このクイズはもう始まっています',
    not_logged_in: 'ログインが切れています。ログインし直してください',
    network: '通信に失敗しました。もう一度お試しください',
  }[code] || (code ? `エラー: ${code}` : '不明なエラーが発生しました');
}

// ============================================================
//  クイズを作る（ホスト：セットアップ）
// ============================================================
let hsAllowLateJoin = false; // 途中参加を許可するか（作成のたびにデフォルト＝不許可へ戻す）
function setLateJoinOption(v) {
  hsAllowLateJoin = v;
  document.querySelectorAll('#hs-late-join-toggle .qz-toggle-opt').forEach((b, i) => {
    b.classList.toggle('active', (i === 1) === v);
  });
}

async function goHostSetupScreen() {
  showScreenQ('host-setup');
  document.getElementById('hs-error').textContent = '';
  setLateJoinOption(false);

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
  return wrap;
}

// ============================================================
//  ★ CSVから一括読み込み（手動で問題を作る）
//  ─────────────────────────────────────────────
//  1行目が見出し（問題,選択肢A〜D,正解 または question,choiceA〜D,correct）
//  なら自動認識してスキップする。見出しが無ければ「問題,選択肢A,選択肢B,
//  選択肢C,選択肢D,正解」の順の列とみなす。「正解」列はA〜D／1〜4／選択肢
//  そのものの文言のいずれでも指定できる（判定できない場合はAを正解にする）。
//  読み込んだ内容は addManualQuestion() と同じ入力欄に反映されるので、
//  取り込み後に見直し・修正してから作成できる。
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
      // 何もしない（続く \n で改行確定）
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => (c || '').trim() !== ''));
}

const QUIZ_CSV_HEADER_ALIASES = {
  question: ['question', '問題', '問題文', 'q'],
  choiceA:  ['choicea', '選択肢a', 'a'],
  choiceB:  ['choiceb', '選択肢b', 'b'],
  choiceC:  ['choicec', '選択肢c', 'c'],
  choiceD:  ['choiced', '選択肢d', 'd'],
  correct:  ['correct', 'answer', '正解', '正答'],
};
function detectQuizCsvColumns(headerRow) {
  const norm = headerRow.map(h => (h || '').trim().toLowerCase());
  const idx = { question: -1, choiceA: -1, choiceB: -1, choiceC: -1, choiceD: -1, correct: -1 };
  norm.forEach((h, i) => {
    for (const key of Object.keys(QUIZ_CSV_HEADER_ALIASES)) {
      if (idx[key] === -1 && QUIZ_CSV_HEADER_ALIASES[key].includes(h)) idx[key] = i;
    }
  });
  const isHeader = [idx.question, idx.choiceA, idx.choiceB, idx.choiceC, idx.choiceD].every(v => v !== -1);
  return { isHeader, idx };
}

// 「正解」列の値（A/B/C/D、1〜4、または選択肢そのものの文言）から choices の index を求める。
// 判定できない場合はA（0）を正解として扱う（取り込み後に一覧で見直せるため）。
function resolveCorrectIndex(correctRaw, choices) {
  const s = (correctRaw || '').trim();
  if (!s) return 0;
  const letterIdx = { a: 0, b: 1, c: 2, d: 3 }[s.toLowerCase()];
  if (letterIdx !== undefined) return letterIdx;
  const num = Number(s);
  if (Number.isInteger(num) && num >= 1 && num <= 4) return num - 1;
  const matchIdx = choices.findIndex(c => c.trim() === s);
  return matchIdx !== -1 ? matchIdx : 0;
}

async function handleQuizCsvImport(event) {
  const file = event.target.files[0];
  event.target.value = ''; // 同じファイルを連続選択してもonchangeが発火するようにリセット
  if (!file) return;

  let text;
  try {
    text = await file.text();
  } catch (e) {
    await showConfirm({ title: '読み込みに失敗しました', desc: 'CSVファイルを読み込めませんでした。', okLabel: 'OK', cancelLabel: '閉じる' });
    return;
  }

  const rows = parseCSV(text);
  if (!rows.length) {
    await showConfirm({ title: '読み込めるデータがありません', desc: 'CSVファイルの中身が空のようです。', okLabel: 'OK', cancelLabel: '閉じる' });
    return;
  }

  let { isHeader, idx } = detectQuizCsvColumns(rows[0]);
  const dataRows = isHeader ? rows.slice(1) : rows;
  if (!isHeader) idx = { question: 0, choiceA: 1, choiceB: 2, choiceC: 3, choiceD: 4, correct: 5 };

  let added = 0, skipped = 0;
  for (const r of dataRows) {
    const question = (r[idx.question] || '').trim();
    const choices = [idx.choiceA, idx.choiceB, idx.choiceC, idx.choiceD].map(i => (r[i] || '').trim());
    if (!question || choices.some(c => !c)) { skipped++; continue; }
    const correctRaw = idx.correct !== -1 ? (r[idx.correct] || '') : '';
    const correctIndex = resolveCorrectIndex(correctRaw, choices);

    const wrap = addManualQuestion();
    // ★ .value への代入はmaxlength属性による制限を受けないため、入力欄と
    //   同じ上限（問題文200字・選択肢80字）に合わせて明示的に切り詰める。
    wrap.querySelector('.mq-question').value = question.slice(0, 200);
    [...wrap.querySelectorAll('.mq-choice')].forEach((inp, i) => { inp.value = choices[i].slice(0, 80); });
    [...wrap.querySelectorAll('input[type=radio]')].forEach((rad, i) => { rad.checked = (i === correctIndex); });
    added++;
  }

  const parts = [`${added}問を追加しました`];
  if (skipped) parts.push(`問題文または選択肢が空の${skipped}行をスキップしました`);
  await showConfirm({ title: 'CSVの読み込みが完了しました', desc: parts.join('\n'), okLabel: 'OK', cancelLabel: '閉じる' });
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
  // ★ 制限時間は1問20秒固定（サーバー側でも固定されている）。

  const body = withAuth({ title, allow_late_join: hsAllowLateJoin });

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

// ★ ホストも1人の参加者として一緒に回答する。出題画面はホスト用／
//   プレイヤー用でほぼ同じ処理になるため、共通ロジックをここにまとめる。
//   （進行はすべてサーバー側の自動判定に任せる：全員回答 or 時間切れで
//   自動的に正解発表(reveal)へ、発表からしばらくすると自動的に次の問題へ
//   進むので、ここでは「今の room の状態をそのまま描画する」だけでよい）
function renderPlayScreen(room, opts) {
  const { progressId, scoreId, questionId, choicesId, feedbackId, waitingNoteId, nextNoteId, timerbarId, answeredCountId } = opts;
  const qChanged = room.current_q !== renderedQIndex;
  const stateChanged = room.state !== renderedState;
  if (qChanged) hasAnsweredThisQ = false;
  renderedQIndex = room.current_q; renderedState = room.state;

  document.getElementById(progressId).textContent = `Q ${room.current_q + 1} / ${room.total_questions}`;
  const myScore = room.players.find(p => p.id === STUDENT.id)?.score ?? 0;
  document.getElementById(scoreId).textContent = `${myScore}点`;
  document.getElementById(questionId).textContent = room.question.question;
  if (answeredCountId) {
    document.getElementById(answeredCountId).textContent = `${room.answered_count} / ${room.total_players} 人が回答`;
  }

  const revealed = room.state === 'reveal';
  const yourAnswer = room.your_answer;
  const answered = (yourAnswer !== undefined) || hasAnsweredThisQ;

  const choicesEl = document.getElementById(choicesId);
  if (qChanged || stateChanged || !choicesEl.dataset.built || Number(choicesEl.dataset.built) !== room.current_q) {
    choicesEl.innerHTML = room.question.choices.map((c, i) => `
      <button class="qz-choice-btn ${CHOICE_CLASSES[i]}" onclick="submitAnswer(${i}, '${choicesId}', '${waitingNoteId}')">${escapeHtml(c)}</button>`).join('');
    choicesEl.dataset.built = room.current_q;
  }

  [...choicesEl.children].forEach((btn, i) => {
    const picked = yourAnswer === i;
    btn.disabled = answered || revealed;
    btn.classList.toggle('qz-picked', picked);
    if (revealed) {
      const isCorrect = i === room.question.correct_index;
      btn.classList.toggle('qz-correct-flash', isCorrect);
      // ★ 自分が選んだ選択肢が不正解だった場合は、赤く光らせて
      //   「これがあなたの選んだ（間違っていた）答え」だとひと目で分かるようにする。
      btn.classList.toggle('qz-wrong-flash', picked && !isCorrect);
      btn.classList.toggle('qz-dim', !isCorrect && !picked);
    } else {
      btn.classList.remove('qz-correct-flash', 'qz-wrong-flash');
      // ★ 回答直後（発表前）も、選んでいない残りの選択肢を薄くして、
      //   「自分が押したのはこれ」を最後まではっきり見せ続ける。
      btn.classList.toggle('qz-dim', answered && !picked);
    }
  });

  const feedbackEl = document.getElementById(feedbackId);
  const waitingNote = document.getElementById(waitingNoteId);
  const nextNote = nextNoteId ? document.getElementById(nextNoteId) : null;
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
  if (nextNote) nextNote.style.display = revealed ? '' : 'none';

  updateTimerBarFor(room, timerbarId);
}

function renderHostPlay(room) {
  showScreenQ('host-play');
  renderPlayScreen(room, {
    progressId: 'hp-progress', scoreId: 'hp-score', questionId: 'hp-question',
    choicesId: 'hp-choices', feedbackId: 'hp-feedback', waitingNoteId: 'hp-waiting-note',
    timerbarId: 'hp-timerbar', answeredCountId: 'hp-answered',
  });

  const revealPanel = document.getElementById('hp-reveal');
  if (room.state === 'reveal') {
    revealPanel.style.display = '';
    document.getElementById('hp-first-badge').textContent = room.first_correct_nickname
      ? `⚡ 一番早く正解：${room.first_correct_nickname} さん（+2点ボーナス）`
      : '⚡ 正解者はいませんでした';
    document.getElementById('hp-leaderboard').innerHTML = miniLeaderboardHtml(room.players);
  } else {
    revealPanel.style.display = 'none';
  }
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
  renderPlayScreen(room, {
    progressId: 'pp-progress', scoreId: 'pp-score', questionId: 'pp-question',
    choicesId: 'pp-choices', feedbackId: 'pp-feedback', waitingNoteId: 'pp-waiting-note',
    nextNoteId: 'pp-next-note', timerbarId: 'pp-timerbar',
  });
}

// タイマーバー：出題中はサーバーの question_started_at + time_limit_sec を、
// 正解発表中は reveal_started_at + reveal_duration_sec（次の問題へ自動で
// 進むまでの残り時間）を基準に、クライアント側では200msごとに残り時間を
// 計算してスムーズに減らしていく。
function updateTimerBarFor(room, elId) {
  const el = document.getElementById(elId);
  if (room.state === 'reveal') {
    el.dataset.startedAt = room.reveal_started_at || '';
    el.dataset.limit = room.reveal_duration_sec || '';
  } else {
    el.dataset.startedAt = room.question_started_at || '';
    el.dataset.limit = room.time_limit_sec || '';
  }
}
function tickTimerBars() {
  ['hp-timerbar', 'pp-timerbar'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || !el.dataset.startedAt || !el.dataset.limit) return;
    const started = Number(el.dataset.startedAt) * 1000;
    const limit = Number(el.dataset.limit) * 1000;
    const remain = Math.max(0, limit - (Date.now() - started));
    el.style.transform = `scaleX(${remain / limit})`;
  });
}

async function submitAnswer(choiceIndex, choicesId = 'pp-choices', waitingNoteId = 'pp-waiting-note') {
  if (hasAnsweredThisQ) return;
  hasAnsweredThisQ = true;
  const choicesEl = document.getElementById(choicesId);
  [...choicesEl.children].forEach((btn, i) => {
    const picked = i === choiceIndex;
    btn.disabled = true;
    btn.classList.toggle('qz-picked', picked);
    btn.classList.toggle('qz-dim', !picked);
  });
  const waitingNote = document.getElementById(waitingNoteId);
  if (waitingNote) waitingNote.style.display = '';
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
