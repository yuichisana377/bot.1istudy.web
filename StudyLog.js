// ============================================================
//  StudyLog.js — 勉強ログ専用スクリプト
//  ポイントは GitHub (points_{guild_id}.json) でサーバー管理
//  → 全員のポイントがランキングに反映される
// ============================================================

const API_BASE    = "https://python-bot-1istudy.onrender.com/";
const GUILD_ID    = "1509880344806162544";
const SESSION_KEY = "sl_session";

// ── セッション取得・チェック ────────────────────────────
function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch(e) { return null; }
}
(function() {
  if (!getSession()) { location.replace("/Login.html"); }
})();

const _s = getSession() || {};
const STUDENT = {
  id:        _s.student_id || "1I001",
  nickname:  _s.nickname   || "Guest",
  color:     _s.color      || "#dbeafe",
  textColor: _s.text_color || "#1e40af",
};

// ── 課題 JSON ──────────────────────────────────────────
let TASKS_JSON = [];  // 動的に読み込む

async function loadTasks() {
  try {
    const data = await api("/list_schedule?guild_id=" + GUILD_ID);
    if (!data.ok) { TASKS_JSON = []; renderTasks(); return; }

    const today = new Date(); today.setHours(0, 0, 0, 0);

    TASKS_JSON = (data.plans || [])
      .filter(p => {
        // カテゴリが【提出】か【宿題】のもの
        const isTarget = p.content.includes("【提出】") || p.content.includes("【宿題】");
        // 締切が今日以降のもの（過去は除外）
        const due = new Date(p.date); due.setHours(0, 0, 0, 0);
        return isTarget && due >= today;
      })
      .map(p => ({
        // list_schedule のフォーマットから課題形式に変換
        id:      `${p.date}_${p.subject}_${p.content}`,  // ユニークID
        subject: p.subject,
        title:   p.content.replace(/【.*?】/, "").trim(), // 【宿題】などを除去
        due:     p.date,
        points:  5,
      }));

    renderTasks();
  } catch(e) {
    TASKS_JSON = [];
    renderTasks();
  }
}

// ── LocalStorage キー（タイマー復元・達成済み課題のみ） ──
// ポイントはサーバー管理なので localStorage には保存しない
// LS_TASKS は削除（課題達成はサーバー管理）
const LS_TIMER = "sl_timer_" + STUDENT.id;

// ── グローバル状態 ──────────────────────────────────────
let logs           = [];   // 全ユーザーのログ
let allPoints      = {};   // { "1I001": 12, "1I002": 7, ... } サーバーから取得
let myPoints       = 0;    // 自分のポイント（表示用）
let completedTasks = [];   // 達成済み課題ID（localStorage）

let timerInterval   = null;
let timerSec        = 0;
let timerRunning    = false;
let timerIsPaused   = false;
let timerStartEpoch = null;
let elapsedAtPause  = 0;
let lastAwardedMin  = 0;

// ============================================================
//  起動
// ============================================================
window.addEventListener("load", () => {
  applySession();
  loadLocalState();
  loadLogs();
  loadTasks();    // ← renderTasks() の直接呼び出しを置き換え
  setTodayLabel();
  restoreTimer();
});

// ── ヘッダーにセッション情報を反映 ─────────────────────
function applySession() {
  var avatarEl   = document.getElementById("header-avatar");
  var nicknameEl = document.getElementById("header-nickname");
  var idEl       = document.getElementById("header-id");
  if (avatarEl) {
    avatarEl.textContent      = STUDENT.nickname.slice(0, 2).toUpperCase();
    avatarEl.style.background = STUDENT.color;
    avatarEl.style.color      = STUDENT.textColor;
  }
  if (nicknameEl) nicknameEl.textContent = STUDENT.nickname;
  if (idEl)       idEl.textContent       = STUDENT.id;
}

// ── ログアウト ──────────────────────────────────────────
function doLogout() {
  if (!confirm("ログアウトしますか？")) return;
  localStorage.removeItem(SESSION_KEY);
  location.replace("/Login.html");
}

// ── 達成済み課題（GitHub 管理） ────────────────────────
async function loadCompletedTasks() {
  try {
    var data = await api(
      "/get_completed_tasks?guild_id=" + GUILD_ID + "&student_id=" + STUDENT.id
    );
    completedTasks = data.ok ? (data.done || []) : [];
  } catch(e) { completedTasks = []; }
}

// ============================================================
//  API ヘルパー
// ============================================================
async function api(path, opts) {
  opts = opts || {};
  var res = await fetch(API_BASE + path, Object.assign(
    { headers: { "Content-Type": "application/json" } }, opts
  ));
  return res.json();
}

// ── ログ取得 ───────────────────────────────────────────
async function loadLogs() {
  try {
    var data = await api("/list_study_logs?guild_id=" + GUILD_ID);
    logs = data.ok ? (data.logs || []) : [];
  } catch(e) { logs = []; }
}

// ── ポイント取得（全員分） ─────────────────────────────
async function loadPoints() {
  try {
    var data = await api("/get_points?guild_id=" + GUILD_ID);
    if (data.ok) {
      allPoints = data.points || {};
      myPoints  = allPoints[STUDENT.id] || 0;
      updatePointDisplay();
    }
  } catch(e) { allPoints = {}; myPoints = 0; }
}

// ── ログ投稿（サーバーがポイントも自動加算） ──────────
async function postLog(entry) {
  var earned = Math.floor(entry.minutes / 5);
  try {
    await api("/add_study_log", {
      method: "POST",
      body: JSON.stringify(Object.assign({ guild_id: GUILD_ID }, entry)),
    });
    // サーバー側で加算済みなのでローカルにも反映
    if (earned > 0) {
      allPoints[STUDENT.id] = (allPoints[STUDENT.id] || 0) + earned;
      myPoints = allPoints[STUDENT.id];
      floatPoints("+" + earned + "pt");
      updatePointDisplay();
    }
  } catch(e) {
    // API 未到達時はローカルのみ反映
    if (earned > 0) {
      myPoints += earned;
      floatPoints("+" + earned + "pt");
      updatePointDisplay();
    }
  }
  logs.push(entry);
  renderAll();
}

// ── 課題達成ポイントをサーバーに送る ──────────────────
async function postTaskPoint(taskId, pts) {
  try {
    var data = await api("/complete_task", {
      method: "POST",
      body: JSON.stringify({
        guild_id: GUILD_ID, student_id: STUDENT.id,
        task_id: taskId, points: pts,
      }),
    });
    if (data.ok) {
      allPoints[STUDENT.id] = data.total;
      myPoints = data.total;
      updatePointDisplay();
    }
  } catch(e) {
    // API 未到達時はローカルのみ
    allPoints[STUDENT.id] = (allPoints[STUDENT.id] || 0) + pts;
    myPoints = allPoints[STUDENT.id];
    updatePointDisplay();
  }
  floatPoints("+" + pts + "pt");
}

// ============================================================
//  日付ユーティリティ
// ============================================================
function todayStr() { return new Date().toISOString().slice(0, 10); }

function getWeekRange() {
  var now = new Date(), day = now.getDay();
  var diff = day === 0 ? -6 : 1 - day;
  var mon = new Date(now); mon.setDate(now.getDate() + diff); mon.setHours(0,0,0,0);
  var sun = new Date(mon); sun.setDate(mon.getDate() + 6);   sun.setHours(23,59,59,999);
  return { mon: mon, sun: sun };
}
function getThisWeekLogs() {
  var r = getWeekRange();
  return logs.filter(function(l) { var d = new Date(l.date); return d >= r.mon && d <= r.sun; });
}
function setTodayLabel() {
  var d = new Date(), wdays = ["日","月","火","水","木","金","土"];
  var el = document.getElementById("today-date");
  if (el) el.textContent =
    d.getFullYear() + "/" + (d.getMonth()+1) + "/" + d.getDate() +
    "（" + wdays[d.getDay()] + "）";
}

// ============================================================
//  ポイント表示・アニメーション
// ============================================================
function updatePointDisplay() {
  var el = document.getElementById("point-display");
  if (el) el.textContent = myPoints;
}
function floatPoints(txt) {
  var wrap = document.getElementById("point-wrap");
  if (!wrap) return;
  var old = wrap.querySelector(".sl-pts-pop");
  if (old) old.remove();
  var el = document.createElement("span");
  el.className   = "sl-pts-pop fly";
  el.textContent = txt;
  wrap.appendChild(el);
  el.addEventListener("animationend", function() { el.remove(); });
}

// ============================================================
//  ランキング集計
//  勉強時間: ログの minutes 合計（全員分ある）
//  ポイント:  allPoints から取得（GitHub 管理・全員分ある）
// ============================================================
function buildRankData(wl) {
  // 勉強時間マップ（週内ログから集計）
  var timeMap = {};
  wl.forEach(function(l) {
    if (!timeMap[l.student_id])
      timeMap[l.student_id] = { nickname: l.nickname, min: 0 };
    timeMap[l.student_id].min += l.minutes;
  });

  // ポイントマップ（サーバーの allPoints をそのまま使う）
  // ニックネームはログから補完、ログがない人はポイントランキングのみ表示
  var ptsMap = {};
  Object.keys(allPoints).forEach(function(sid) {
    var fromLog = timeMap[sid];
    ptsMap[sid] = {
      nickname: fromLog ? fromLog.nickname : sid,
      pts: allPoints[sid] || 0,
    };
  });
  // 今週ログがあるがポイント0の人も表示
  Object.keys(timeMap).forEach(function(sid) {
    if (!ptsMap[sid]) ptsMap[sid] = { nickname: timeMap[sid].nickname, pts: 0 };
  });

  return {
    byTime: Object.values(timeMap).sort(function(a,b){ return b.min - a.min; }).slice(0,3),
    byPts:  Object.values(ptsMap).sort(function(a,b){ return b.pts - a.pts; }).slice(0,3),
  };
}

// ============================================================
//  描画
// ============================================================
function renderAll() {
  var wl  = getThisWeekLogs();
  var tot = wl.reduce(function(s,l){ return s+l.minutes; }, 0);
  var my  = wl.filter(function(l){ return l.student_id === STUDENT.id; })
              .reduce(function(s,l){ return s+l.minutes; }, 0);
  document.getElementById("total-week").textContent  = tot + "分";
  document.getElementById("my-week").textContent     = my  + "分";
  document.getElementById("total-count").textContent = logs.length + "件";
  renderRankings(wl);
  renderLogs();
}

// ── ランキング（勉強時間 / ポイント 完全2列分離） ─────
function renderRankings(wl) {
  var rd = buildRankData(wl);
  document.getElementById("ranking-time").innerHTML =
    rankHTML(rd.byTime, function(u){ return u.min + "分"; }, "sl-rank-val-time", "nickname");
  document.getElementById("ranking-pts").innerHTML  =
    rankHTML(rd.byPts,  function(u){ return u.pts + "pt"; }, "sl-rank-val-pts",  "nickname");
}

function rankHTML(sorted, valFn, valClass, nameKey) {
  if (!sorted.length)
    return '<div class="sl-rank-empty">データなし</div>';
  var medals = ["sl-r1","sl-r2","sl-r3"];
  return sorted.map(function(u, i) {
    var name     = u[nameKey] || u.nickname || "—";
    var isMe     = name === STUDENT.nickname;
    var youBadge = isMe ? '<span class="sl-you-badge">あなた</span>' : "";
    return '<div class="sl-rank-row">' +
      '<div class="sl-rank-num ' + (medals[i]||"sl-rn") + '">' + (i+1) + '</div>' +
      '<div class="sl-rank-name">' + esc(name) + youBadge + '</div>' +
      '<div class="sl-rank-val ' + valClass + '">' + valFn(u) + '</div>' +
    '</div>';
  }).join("");
}

// ── ログ一覧 ──────────────────────────────────────────
function renderLogs() {
  var el = document.getElementById("log-list");
  if (!logs.length) {
    el.innerHTML = '<div class="empty-msg">まだ記録がありません</div>'; return;
  }
  el.innerHTML = logs.slice().reverse().map(function(l) {
    return '<div class="sl-log-item">' +
      '<div class="sl-log-header">' +
        '<span class="sl-log-subject">' + esc(l.subject) + '</span>' +
        '<span class="sl-log-min">' + l.minutes + '分</span>' +
      '</div>' +
      '<div class="sl-log-meta">' + l.date + ' · ' + esc(l.nickname) + '</div>' +
      (l.memo ? '<div class="sl-log-memo">' + esc(l.memo) + '</div>' : '') +
    '</div>';
  }).join("");
}

// ── 課題一覧 ──────────────────────────────────────────
function renderTasks() {
  var el = document.getElementById("task-list");
  el.innerHTML = TASKS_JSON.map(function(t) {
    var done = completedTasks.includes(t.id);
    return '<div class="sl-task-row">' +
      '<div class="sl-task-body">' +
        '<div class="sl-task-title' + (done ? " done" : "") + '">' + esc(t.title) + '</div>' +
        '<div class="sl-task-meta">' +
          '<span class="sl-subject-badge">' + esc(t.subject) + '</span>' +
          '<span class="sl-due">締切: ' + t.due + '</span>' +
          '<span class="sl-pts-badge">⭐ +' + t.points + 'pt</span>' +
        '</div>' +
      '</div>' +
      '<button class="sl-task-btn" onclick="toggleTask(\'' + t.id + '\')"' +
        (done ? ' disabled' : '') + '>' +
        (done ? '✓ 達成済み' : '達成する') +
      '</button>' +
    '</div>';
  }).join("");
}

// ============================================================
//  タブ切り替え
// ============================================================
function showTab(name) {
  ["home","manual","timer","tasks"].forEach(function(t) {
    document.getElementById("tab-btn-" + t).classList.toggle("active", t === name);
    document.getElementById("tab-" + t).classList.toggle("active",     t === name);
  });
}

// ============================================================
//  手入力 保存
// ============================================================
function saveManual() {
  var sub   = document.getElementById("m-subject").value;
  var min   = parseInt(document.getElementById("m-minutes").value);
  var memo  = document.getElementById("m-memo").value.trim();
  var errEl = document.getElementById("manual-err");
  var okEl  = document.getElementById("manual-ok");
  errEl.style.display = "none";
  okEl.style.display  = "none";
  if (!min || min < 1) {
    errEl.textContent   = "✕ 1分以上の時間を入力してください";
    errEl.style.display = "block";
    setTimeout(function() { errEl.style.display = "none"; }, 3500);
    return;
  }
  postLog({ date: todayStr(), subject: sub, minutes: min, memo: memo,
            student_id: STUDENT.id, nickname: STUDENT.nickname });
  document.getElementById("m-minutes").value = "";
  document.getElementById("m-memo").value    = "";
  okEl.style.display = "block";
  setTimeout(function() { okEl.style.display = "none"; showTab("home"); }, 1200);
}

// ============================================================
//  課題達成
// ============================================================
function toggleTask(id) {
  if (completedTasks.includes(id)) return;
  completedTasks.push(id);  // 楽観的UI更新
  renderTasks();
  var t = TASKS_JSON.find(function(x) { return x.id === id; });
  if (t) postTaskPoint(id, t.points);  // サーバーに保存＆ポイント加算
}

// ============================================================
//  タイマー
// ============================================================
function pad(n) { return String(n).padStart(2, "0"); }

function updateTimerUI() {
  var h = Math.floor(timerSec / 3600);
  var m = Math.floor((timerSec % 3600) / 60);
  var s = timerSec % 60;
  document.getElementById("timer-display").textContent = pad(h)+":"+pad(m)+":"+pad(s);
  var hint = document.getElementById("timer-pts-hint");
  if (timerRunning && !timerIsPaused) {
    var remaining = (lastAwardedMin + 5) * 60 - timerSec;
    hint.textContent = remaining > 0 ? "次の +1pt まで " + remaining + "秒" : "";
  } else { hint.textContent = ""; }
}

function startInterval() {
  timerInterval = setInterval(function() {
    timerSec = Math.floor((Date.now() - timerStartEpoch) / 1000);
    if (timerSec >= 10800) { timerStop(); return; }
    var curMin = Math.floor(timerSec / 60);
    if (curMin > 0 && curMin % 5 === 0 && curMin > lastAwardedMin) {
      lastAwardedMin = curMin;
      // タイマー中のポイントはフロントで即時表示、ログ保存時にサーバーへ反映
      myPoints++;
      allPoints[STUDENT.id] = (allPoints[STUDENT.id] || 0) + 1;
      floatPoints("+1pt");
      updatePointDisplay();
    }
    updateTimerUI();
  }, 500);
}

function timerStart() {
  if (timerRunning) return;
  timerRunning    = true;
  timerIsPaused   = false;
  timerStartEpoch = Date.now() - elapsedAtPause * 1000;
  document.getElementById("btn-start").disabled = true;
  document.getElementById("btn-pause").disabled = false;
  document.getElementById("btn-stop").disabled  = false;
  document.getElementById("timer-status").textContent = "計測中...";
  startInterval();
  try { localStorage.setItem(LS_TIMER, timerStartEpoch); } catch(e) {}
}

function timerPauseResume() {
  if (!timerRunning && !timerIsPaused) return;
  if (!timerIsPaused) {
    clearInterval(timerInterval); timerInterval = null;
    elapsedAtPause = timerSec; timerRunning = false; timerIsPaused = true;
    document.getElementById("btn-pause").textContent      = "▶ 再開";
    document.getElementById("timer-status").textContent   = "休憩中...";
    document.getElementById("timer-pts-hint").textContent = "";
    try { localStorage.removeItem(LS_TIMER); } catch(e) {}
  } else {
    timerIsPaused   = false; timerRunning = true;
    timerStartEpoch = Date.now() - elapsedAtPause * 1000;
    document.getElementById("btn-pause").textContent    = "⏸ 休憩";
    document.getElementById("timer-status").textContent = "計測中...";
    startInterval();
    try { localStorage.setItem(LS_TIMER, timerStartEpoch); } catch(e) {}
  }
}

function timerStop() {
  clearInterval(timerInterval); timerInterval = null;
  timerRunning = false; timerIsPaused = false;
  var mins = Math.floor(timerSec / 60);
  if (mins < 1) {
    alert("1分未満のため記録できません");
    timerReset(); return;
  }
  document.getElementById("timer-main").style.display    = "none";
  document.getElementById("timer-confirm").style.display = "block";
  document.getElementById("conf-time").textContent       = mins + "分 " + pad(timerSec % 60) + "秒";
  document.getElementById("conf-time").dataset.min       = mins;
  try { localStorage.removeItem(LS_TIMER); } catch(e) {}
}

function saveTimer() {
  var sub  = document.getElementById("conf-subject").value;
  var memo = document.getElementById("conf-memo").value.trim();
  var mins = parseInt(document.getElementById("conf-time").dataset.min);
  postLog({ date: todayStr(), subject: sub, minutes: mins, memo: memo,
            student_id: STUDENT.id, nickname: STUDENT.nickname });
  var okEl = document.getElementById("timer-ok");
  okEl.style.display = "block";
  setTimeout(function() { okEl.style.display = "none"; timerReset(); showTab("home"); }, 1200);
}

function editTimer() {
  var el  = document.getElementById("conf-time");
  var cur = parseInt(el.dataset.min);
  var v   = prompt("分数を修正してください:", cur);
  if (v && parseInt(v) >= 1) {
    el.dataset.min = parseInt(v); el.textContent = parseInt(v) + "分 00秒";
  }
}
function discardTimer() {
  if (confirm("この計測結果を破棄しますか？")) { timerReset(); showTab("home"); }
}
function timerReset() {
  clearInterval(timerInterval); timerInterval = null;
  timerSec = 0; timerRunning = false; timerIsPaused = false;
  elapsedAtPause = 0; timerStartEpoch = null; lastAwardedMin = 0;
  document.getElementById("timer-display").textContent   = "00:00:00";
  document.getElementById("timer-status").textContent    = "準備完了";
  document.getElementById("timer-pts-hint").textContent  = "";
  document.getElementById("btn-start").disabled  = false;
  document.getElementById("btn-pause").disabled  = true;
  document.getElementById("btn-stop").disabled   = true;
  document.getElementById("btn-pause").textContent = "⏸ 休憩";
  document.getElementById("timer-main").style.display    = "block";
  document.getElementById("timer-confirm").style.display = "none";
  document.getElementById("conf-memo").value = "";
  try { localStorage.removeItem(LS_TIMER); } catch(e) {}
}

document.addEventListener("visibilitychange", function() {
  if (!timerRunning || timerIsPaused) return;
  if (document.hidden) {
    clearInterval(timerInterval); timerInterval = null;
    elapsedAtPause = timerSec; timerRunning = false; timerIsPaused = true;
    document.getElementById("btn-pause").textContent      = "▶ 再開";
    document.getElementById("btn-start").disabled         = true;
    document.getElementById("timer-status").textContent   = "タブ離脱で一時停止中";
    document.getElementById("timer-pts-hint").textContent = "";
    try { localStorage.removeItem(LS_TIMER); } catch(e) {}
  }
});

function restoreTimer() {
  try {
    var saved = localStorage.getItem(LS_TIMER);
    if (!saved) return;
    var elapsed = Math.floor((Date.now() - parseInt(saved)) / 1000);
    if (elapsed <= 0 || elapsed >= 10800) { localStorage.removeItem(LS_TIMER); return; }
    elapsedAtPause = elapsed; timerSec = elapsed; timerIsPaused = true;
    updateTimerUI();
    document.getElementById("btn-pause").disabled       = false;
    document.getElementById("btn-stop").disabled        = false;
    document.getElementById("btn-start").disabled       = true;
    document.getElementById("btn-pause").textContent    = "▶ 再開";
    document.getElementById("timer-status").textContent = "前回の計測が残っています（再開で復元）";
  } catch(e) {}
}

// ============================================================
//  ドロワー
// ============================================================
function openDrawer() {
  document.getElementById("drawer").classList.add("open");
  document.getElementById("drawer-overlay").classList.add("open");
}
function closeDrawer() {
  document.getElementById("drawer").classList.remove("open");
  document.getElementById("drawer-overlay").classList.remove("open");
}

// ============================================================
//  ユーティリティ
// ============================================================
function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
