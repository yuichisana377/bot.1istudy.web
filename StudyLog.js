// ============================================================
//  StudyLog.js — 勉強ログ専用スクリプト
//  ポイントは GitHub (points_{guild_id}.json) でサーバー管理
//  → 累計ポイントはヘッダーバッジに表示
//  → ポイントランキングは「今週獲得分」のみ（毎週リセット）
//     ・勉強ログ分: floor(minutes/5) pt  ← ログの日付でフィルタ
//     ・課題達成分: +points pt            ← 達成日でフィルタ（全ユーザー対象）
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

// ── 課題 JSON（動的に読み込む） ────────────────────────
let TASKS_JSON = [];

// ── Discord科目一覧 ───────────────────────────────────
let SUBJECTS = [];

async function loadSubjects() {
  try {
    const data = await api("/channels?guild_id=" + GUILD_ID);
    SUBJECTS = data.ok ? data.channels.map(ch => ch.name) : [];
  } catch(e) { SUBJECTS = []; }
}

async function loadTasks() {
  try {
    const data = await api("/list_schedule?guild_id=" + GUILD_ID);
    if (!data.ok) { TASKS_JSON = []; renderTasks(); return; }

    const today = new Date(); today.setHours(0, 0, 0, 0);

    TASKS_JSON = (data.plans || [])
      .filter(p => {
        const isTarget = p.content.includes("【提出】") || p.content.includes("【宿題】");
        const due = new Date(p.date); due.setHours(0, 0, 0, 0);
        return isTarget && due >= today;
      })
      .map(p => ({
        id:      `${p.date}_${p.subject}_${p.content}`,
        subject: p.subject,
        title:   p.content.replace(/【.*?】/, "").trim(),
        due:     p.date,
        points:  5,
      }));

    renderTasks();
  } catch(e) { TASKS_JSON = []; renderTasks(); }
}

// ── LocalStorage キー（タイマー復元のみ） ──────────────
const LS_TIMER = "sl_timer_" + STUDENT.id;

// ── グローバル状態 ──────────────────────────────────────
let logs              = [];   // 全ユーザーのログ
let allPoints         = {};   // 累計ポイント { "1I001": 12, ... }（ヘッダーバッジ用）
let myPoints          = 0;    // 自分の累計ポイント
let completedTasks    = [];   // 達成済み課題（自分のみ） [{id, date, points}, ...]
let allCompletedTasks = {};   // 達成済み課題（全ユーザー） { "1I001": [{id,date,points}], ... }
let nicknameMap       = {};   // { "1I001": "太郎", ... }

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
window.addEventListener("load", function() {
  applySession();
  setTodayLabel();
  restoreTimer();

  Promise.all([
    loadSubjects(),
    loadLogs(),
    loadPoints(),
    loadCompletedTasks(),      // 自分用（課題タブの達成済み表示に必要）
    loadAllCompletedTasks(),   // 全員用（週間ランキング集計に必要）
    loadTasks()
  ]).then(function() {
    renderSubjectDropdown();
    renderAll();
    renderTasks();
  });
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

// ── 達成済み課題（自分のみ・サーバー管理・日付付き） ───
async function loadCompletedTasks() {
  try {
    var data = await api(
      "/get_completed_tasks?guild_id=" + GUILD_ID + "&student_id=" + STUDENT.id
    );
    if (data.ok) {
      // サーバーは [{id, date, points}, ...] を返す（旧形式の null も含む）
      completedTasks = (data.done || []).map(function(e) {
        return typeof e === "string" ? { id: e, date: null, points: null } : e;
      });
    } else {
      completedTasks = [];
    }
  } catch(e) { completedTasks = []; }
}

// ── 達成済み課題（全ユーザー・週間ランキング集計用） ───
async function loadAllCompletedTasks() {
  try {
    var data = await api("/get_completed_tasks?guild_id=" + GUILD_ID);
    allCompletedTasks = (data.ok && data.done && typeof data.done === "object" && !Array.isArray(data.done))
      ? data.done
      : {};

    // ★ ここで nicknameMap を補完する
    Object.keys(allCompletedTasks).forEach(function(sid) {
      if (!nicknameMap[sid] && sid === STUDENT.id) {
        nicknameMap[sid] = STUDENT.nickname;
      }
    });

  } catch(e) { allCompletedTasks = {}; }
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

// ── ログ取得（nicknameMap も同時に構築） ───────────────
async function loadLogs() {
  try {
    var data = await api("/list_study_logs?guild_id=" + GUILD_ID);
    logs = data.ok ? (data.logs || []) : [];
    logs.forEach(function(l) {
      if (l.student_id && l.nickname) nicknameMap[l.student_id] = l.nickname;
    });
    nicknameMap[STUDENT.id] = STUDENT.nickname;
  } catch(e) { logs = []; }
}

// ── ポイント取得（累計・ヘッダーバッジ用） ────────────
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

// ── ログ投稿 ──────────────────────────────────────────
async function postLog(entry) {
  var earned = Math.floor(entry.minutes / 5);
  try {
    await api("/add_study_log", {
      method: "POST",
      body: JSON.stringify(Object.assign({ guild_id: GUILD_ID }, entry)),
    });
    if (earned > 0) {
      allPoints[STUDENT.id] = (allPoints[STUDENT.id] || 0) + earned;
      myPoints = allPoints[STUDENT.id];
      floatPoints("+" + earned + "pt");
      updatePointDisplay();
    }
  } catch(e) {
    if (earned > 0) {
      myPoints += earned;
      floatPoints("+" + earned + "pt");
      updatePointDisplay();
    }
  }
  nicknameMap[STUDENT.id] = STUDENT.nickname;
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
//  今週の獲得ポイントを計算（ランキング用）
//  ・勉強ログ分: floor(minutes/5) → 今週のログのみ対象（全ユーザー）
//  ・課題達成分: 達成エントリに保存された points を最優先で使用
//                （無ければ現在の TASKS_JSON、それも無ければ5ptに
//                 フォールバック）→ 今週達成したもののみ対象（全ユーザー）
// ============================================================
function calcWeeklyPoints(wl) {
  var r   = getWeekRange();
  var map = {};

  // ① 勉強ログ分（全ユーザー）
  wl.forEach(function(l) {
    if (!map[l.student_id]) map[l.student_id] = 0;
    map[l.student_id] += Math.floor(l.minutes / 5);
  });

  // ② 課題達成分（全ユーザー・今週達成したもの）
  Object.keys(allCompletedTasks).forEach(function(sid) {
    (allCompletedTasks[sid] || []).forEach(function(e) {
      if (!e.date) return;  // 旧データ（date=null）はスキップ
      var d = new Date(e.date); d.setHours(0, 0, 0, 0);
      if (d < r.mon || d > r.sun) return;  // 今週以外はスキップ

      var pts;
      if (e.points != null) {
        pts = e.points;  // サーバー保存値（達成時点のポイント・最も正確）
      } else {
        var task = TASKS_JSON.find(function(t) { return t.id === e.id; });
        pts = task ? task.points : 5;
      }

      if (!map[sid]) map[sid] = 0;
      map[sid] += pts;
    });
  });

  return map;  // { "1I001": 12, "1I002": 3, ... }
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
// ============================================================

// 同率を考慮して上位3位相当のエントリを返す
function topWithTies(arr, key) {
  if (!arr.length) return [];
  var sorted = arr.slice().sort(function(a, b) { return b[key] - a[key]; });
  var result = [];
  var rank = 0;
  var prev = null;
  for (var i = 0; i < sorted.length; i++) {
    if (sorted[i][key] !== prev) {
      rank = i + 1;
      prev = sorted[i][key];
    }
    if (rank > 3) break;
    result.push(Object.assign({ rank: rank }, sorted[i]));
  }
  return result;
}

function buildRankData(wl) {
  nicknameMap[STUDENT.id] = STUDENT.nickname;

  // ── 勉強時間マップ ──────────────────────────────────
  var timeMap = {};
  wl.forEach(function(l) {
    if (!timeMap[l.student_id]) {
      if (l.student_id && l.nickname) {
        nicknameMap[l.student_id] = nicknameMap[l.student_id] || l.nickname;
      }
      timeMap[l.student_id] = { nickname: nicknameMap[l.student_id] || l.nickname, min: 0 };
    }
    timeMap[l.student_id].min += l.minutes;
  });

  // ── 今週獲得ポイントマップ（全ユーザー） ────────────
  var weekPtsRaw = calcWeeklyPoints(wl);
  var ptsMap = {};
  Object.keys(weekPtsRaw).forEach(function(sid) {
    ptsMap[sid] = {
      nickname: nicknameMap[sid] || sid,
      pts: weekPtsRaw[sid],
    };
  });

  return {
    byTime: topWithTies(Object.values(timeMap), "min"),
    byPts:  topWithTies(Object.values(ptsMap),  "pts"),
  };
}

// ============================================================
//  描画
// ============================================================
function renderAll() {
  var wl  = getThisWeekLogs();
  var tot = wl.reduce(function(s,l){ return s+l.minutes; }, 0);

  // ── 自分のサマリー ────────────────────────────────
  var myWeekMin = wl.filter(function(l){ return l.student_id === STUDENT.id; })
                     .reduce(function(s,l){ return s+l.minutes; }, 0);
  var myWeekPts = calcWeeklyPoints(wl)[STUDENT.id] || 0;
  var myTotalMin = logs.filter(function(l){ return l.student_id === STUDENT.id; })
                        .reduce(function(s,l){ return s+l.minutes; }, 0);
  document.getElementById("my-week-time").textContent  = myWeekMin + "分";
  document.getElementById("my-week-pts").textContent   = myWeekPts + "pt";
  document.getElementById("my-total-time").textContent = myTotalMin + "分";

  renderRankings(wl);
  renderLogs();
  renderEveryone(wl, tot);
}

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
  return sorted.map(function(u) {
    var rank     = u.rank || 1;
    var name     = u[nameKey] || u.nickname || "—";
    var isMe     = name === STUDENT.nickname;
    var youBadge = isMe ? '<span class="sl-you-badge">あなた</span>' : "";
    var medalCls = medals[rank - 1] || "sl-rn";
    return '<div class="sl-rank-row">' +
      '<div class="sl-rank-num ' + medalCls + '">' + rank + '</div>' +
      '<div class="sl-rank-name">' + esc(name) + youBadge + '</div>' +
      '<div class="sl-rank-val ' + valClass + '">' + valFn(u) + '</div>' +
    '</div>';
  }).join("");
}

// ── ログ一覧（自分のみ） ───────────────────────────────
function renderLogs() {
  var el     = document.getElementById("log-list");
  var myLogs = logs.filter(function(l) { return l.student_id === STUDENT.id; });
  if (!myLogs.length) {
    el.innerHTML = '<div class="empty-msg">まだ記録がありません</div>'; return;
  }
  el.innerHTML = myLogs.slice().reverse().map(function(l) {
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

// ── みんなの記録（①全体合計 ②メンバー別 ③全員のログ） ──
function renderEveryone(wl, totMin) {
  // ① 1I勉強会 全体の今週合計
  var weekPtsRaw  = calcWeeklyPoints(wl);
  var totPts      = Object.values(weekPtsRaw).reduce(function(s, v) { return s + v; }, 0);

  var minEl = document.getElementById("everyone-week-min");
  var ptsEl = document.getElementById("everyone-week-pts");
  if (minEl) minEl.textContent = totMin + "分";
  if (ptsEl) ptsEl.textContent = totPts + "pt";

  // ② メンバーごとの今週の記録（アカウントが存在する人＝
  //    ログ・累計ポイント・課題達成のいずれかに登場した student_id 全員）
  var weekMinMap = {};
  wl.forEach(function(l) {
    weekMinMap[l.student_id] = (weekMinMap[l.student_id] || 0) + l.minutes;
  });

  var memberIds = {};
  Object.keys(nicknameMap).forEach(function(id) { memberIds[id] = true; });
  Object.keys(allPoints).forEach(function(id) { memberIds[id] = true; });
  Object.keys(allCompletedTasks).forEach(function(id) { memberIds[id] = true; });
  memberIds[STUDENT.id] = true;

  var members = Object.keys(memberIds).map(function(id) {
    return {
      id:       id,
      nickname: nicknameMap[id] || id,
      min:      weekMinMap[id] || 0,
      pts:      weekPtsRaw[id] || 0,
    };
  }).sort(function(a, b) {
    return (b.min - a.min) || (b.pts - a.pts) || a.nickname.localeCompare(b.nickname, "ja");
  });

  var memberListEl = document.getElementById("member-week-list");
  if (memberListEl) {
    memberListEl.innerHTML = members.length
      ? members.map(function(m) {
          var isMe     = m.id === STUDENT.id;
          var youBadge = isMe ? '<span class="sl-you-badge">あなた</span>' : "";
          return '<div class="sl-rank-row">' +
            '<div class="sl-rank-name">' + esc(m.nickname) + youBadge + '</div>' +
            '<div class="sl-rank-val sl-rank-val-time">' + m.min + '分</div>' +
            '<div class="sl-rank-val sl-rank-val-pts">' + m.pts + 'pt</div>' +
          '</div>';
        }).join("")
      : '<div class="sl-rank-empty">データなし</div>';
  }

  // ③ みんなの勉強ログ
  var el = document.getElementById("everyone-log-list");
  if (!el) return;
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
  var doneIds = completedTasks.map(function(e) { return e.id; });
  el.innerHTML = TASKS_JSON.map(function(t) {
    var done = doneIds.includes(t.id);
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
  var doneIds = completedTasks.map(function(e) { return e.id; });
  if (doneIds.includes(id)) return;

  var t = TASKS_JSON.find(function(x) { return x.id === id; });
  var entry = { id: id, date: todayStr(), points: t ? t.points : 5 };

  // 楽観的UI更新（自分用リスト・全員用ランキングデータの両方に反映）
  completedTasks.push(entry);
  if (!allCompletedTasks[STUDENT.id]) allCompletedTasks[STUDENT.id] = [];
  allCompletedTasks[STUDENT.id].push(entry);

  renderTasks();
  renderAll();  // ランキングにも即時反映

  if (t) postTaskPoint(id, t.points);
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

// ── 科目プルダウン描画 ───────────────────────────────
function renderSubjectDropdown() {
  const mSel = document.getElementById("m-subject");
  const cSel = document.getElementById("conf-subject");
  if (mSel) {
    mSel.innerHTML = SUBJECTS.map(sub =>
      `<option value="${sub}">${sub}</option>`
    ).join("");
  }
  if (cSel) {
    cSel.innerHTML = SUBJECTS.map(sub =>
      `<option value="${sub}">${sub}</option>`
    ).join("");
  }
}

// ============================================================
//  ユーティリティ
// ============================================================
function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
