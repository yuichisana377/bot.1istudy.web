// ============================================================ 754
//  StudyLog.js — 勉強ログ専用スクリプト
//  ポイントは GitHub (points_{guild_id}.json) でサーバー管理
//  → 累計ポイントはヘッダーバッジに表示
//  → ポイントランキングは「今週獲得分」のみ（毎週リセット）
//     ・勉強ログ分: floor(minutes/5) pt  ← ログの日付でフィルタ
//     ・課題達成分: +points pt            ← 達成日でフィルタ（全ユーザー対象）
//
//  ★ 課題のポイントは Plan.js（予定管理ページ）の追加・編集画面で
//     設定可能。plans に points フィールドがあればそれを使用し、
//     無ければデフォルト 5pt にフォールバックする。
// ============================================================

// ============================================================
//  ★ 連打対策：保存系ボタン共通のローディング表示（ぐるぐる＋「保存中…」）
//   HTML/CSS側の変更なしで動くよう、スピナー用CSSはJSから自前で挿入する。
// ============================================================
(function injectSpinnerStyle() {
  if (document.getElementById("sl-spinner-style")) return;
  var style = document.createElement("style");
  style.id = "sl-spinner-style";
  style.textContent =
    "@keyframes sl-spin{to{transform:rotate(360deg);}}" +
    ".sl-spinner{display:inline-block;width:14px;height:14px;margin-right:6px;" +
    "vertical-align:-2px;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;" +
    "border-radius:50%;animation:sl-spin .7s linear infinite;}" +
    "button.sl-btn-loading{opacity:.85;cursor:default;}";
  document.head.appendChild(style);
})();

// ボタンを「送信中」状態にする／元に戻す共通ヘルパー
// btn: 対象のbutton要素, loading: true=送信中にする / false=元に戻す, label: 送信中に表示する文言
function setButtonLoading(btn, loading, label) {
  if (!btn) return;
  if (loading) {
    if (btn.dataset.origLabel === undefined) btn.dataset.origLabel = btn.textContent;
    btn.disabled = true;
    btn.classList.add("sl-btn-loading");
    btn.innerHTML = '<span class="sl-spinner"></span>' + (label || "保存中…");
  } else {
    btn.disabled = false;
    btn.classList.remove("sl-btn-loading");
    btn.textContent = (btn.dataset.origLabel !== undefined) ? btn.dataset.origLabel : btn.textContent;
    delete btn.dataset.origLabel;
  }
}

const API_BASE    = "https://chiro-ubuntuserver.tail1130ba.ts.net/";
const GUILD_ID    = "1509880344806162544";
const SESSION_KEY = "sl_session";
const DEFAULT_TASK_POINTS = 5;

// ★ 備考をcontent文字列に埋め込むための区切り文字列（Plan.jsと同じ形式）
const NOTE_SEP = '\n📝備考：';

// ★ content から【カテゴリ】タグを除いた「内容」と「備考」を分離する（Plan.jsのparsePlanContentに相当）
function splitContentNote(raw) {
  const stripped = String(raw).replace(/【.*?】/, "").trim();
  const [textPart, notePart] = stripped.split(NOTE_SEP);
  return { text: (textPart || "").trim(), note: (notePart || "").trim() };
}

// ── セッション取得・チェック ────────────────────────────
function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch(e) { return null; }
}
// ★ session_token が無いセッション（パスワード未対応の古いログイン方式で
//   作られたもの）はサーバー側で本人確認できないため、ログインし直させる
(function() {
  var s = getSession();
  if (!s || !s.session_token) { location.replace("/Login.html"); }
})();

const _s = getSession() || {};
const STUDENT = {
  id:        _s.student_id,
  nickname:  _s.nickname,
  color:     _s.color,
  textColor: _s.text_color,
};
// ★ サーバー側の本人確認に使うセッショントークン。/login で発行され、
//   ポイントに関わるAPI（勉強ログ追加・課題達成など）を呼ぶたびに
//   一緒に送る。サーバーはこれを使って student_id を特定するので、
//   クライアントが送る student_id 自体は（表示用途を除き）信用されない。
const SESSION_TOKEN = _s.session_token;

// ★ 追加：ドロワー下部に「だれとしてログインしているか」を表示する（2026/08/19）
function renderDrawerAccount() {
  const el = document.getElementById('drawer-account');
  if (!el) return;
  el.innerHTML = '';
  if (STUDENT.nickname) {
    const name = document.createElement('div');
    name.className = 'drawer-account-name';
    name.textContent = `👤 ${STUDENT.nickname}`;
    el.appendChild(name);
  } else {
    const link = document.createElement('a');
    link.className = 'drawer-account-login-link';
    link.href = '/Login.html';
    link.textContent = 'ログインしていません';
    el.appendChild(link);
  }
}
renderDrawerAccount();


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
        // ★「提出」「宿題」に加えて、その他カテゴリでも任意でポイントが
        //   付いている予定は達成一覧の対象に含める
        const isTarget = p.content.includes("【提出】") || p.content.includes("【宿題】") || (p.points != null);
        const due = new Date(p.date); due.setHours(0, 0, 0, 0);
        return isTarget && due >= today;
      })
      .map(p => {
        const { text, note } = splitContentNote(p.content);
        return {
          id:      `${p.date}_${p.subject}_${p.content}`,
          subject: p.subject,
          title:   text,
          note:    note, // ★ 備考（タップで表示するため分離）
          due:     p.date,
          // ★ サーバー側（予定管理の追加・編集画面）で設定したポイントを優先。
          //    未設定の予定は従来どおりデフォルト5ptにフォールバック。
          points:  (p.points != null) ? p.points : DEFAULT_TASK_POINTS,
        };
      });

    renderTasks();
  } catch(e) { TASKS_JSON = []; renderTasks(); }
}

// ============================================================
//  ★ 連続記録の制限（誤操作・二重送信防止）
//   ・タイマー記録：前回の記録から「今回記録しようとしている分数」以上の
//     実時間が経過していないと保存できない
//     （タイマーの経過時間を改ざんして即座に長時間記録するのを防ぐ）
//   ・手入力：同じ教科での連続記録は、前回の記録から1分経過するまで
//     行えない
// ============================================================
const LS_TIMER_LASTLOG  = "sl_timer_lastlog_"  + STUDENT.id; // { at, minutes }
const LS_MANUAL_LASTLOG = "sl_manual_lastlog_" + STUDENT.id; // { [subject]: at }
const MANUAL_COOLDOWN_MS = 20 * 1000; // 20秒（連打対策。サーバー側のMANUAL_COOLDOWN_SECと一致させること）

function getTimerLastLog() {
  try { return JSON.parse(localStorage.getItem(LS_TIMER_LASTLOG)); } catch(e) { return null; }
}
function setTimerLastLog(mins) {
  try { localStorage.setItem(LS_TIMER_LASTLOG, JSON.stringify({ at: Date.now(), minutes: mins })); } catch(e) {}
}

function getManualLastLogMap() {
  try { return JSON.parse(localStorage.getItem(LS_MANUAL_LASTLOG)) || {}; } catch(e) { return {}; }
}
function setManualLastLog(subject) {
  var map = getManualLastLogMap();
  map[subject] = Date.now();
  try { localStorage.setItem(LS_MANUAL_LASTLOG, JSON.stringify(map)); } catch(e) {}
}

// ── グローバル状態 ──────────────────────────────────────
let logs              = [];   // 全ユーザーのログ
let allPoints         = {};   // 累計ポイント { "1I001": 12, ... }（ヘッダーバッジ用）
let myPoints          = 0;    // 自分の累計ポイント
let completedTasks    = [];   // 達成済み課題（自分のみ） [{id, date, points, nickname}, ...]
let allCompletedTasks = {};   // 達成済み課題（全ユーザー） { "1I001": [{id,date,points,nickname}], ... }
let nicknameMap       = {};   // { "1I001": "太郎", ... }

// ★ 現在サーバーに送信中のタスクID（二重送信・ポーリング競合防止）
let pendingTaskIds = new Set();

let timerInterval     = null;  // 表示更新用（500ms）
let timerSyncInterval = null;  // ★ サーバーとの定期同期用（複数端末対応・自動休憩の検知）
let timerSec          = 0;
let timerRunning      = false;
let timerIsPaused     = false;
let pauseReason       = null;  // ★ 一時停止の理由 "manual"（自分で休憩） / "checkpoint"（3時間経過での自動休憩）
let accumulatedSec    = 0;     // ★ 直近の計測区間を含まない、これまでの累計秒（サーバーのaccumulated_secと同期）
let runStartClientEpoch = null; // ★ 現在の計測区間の開始時刻（この端末のDate.now()換算）
let lastAwardedMin    = 0;
let lastCheckpointMin = 0;     // ★ 3時間（180分）区切りのチェックを二重に走らせないための直近チェック済み分数

// ============================================================
//  起動
// ============================================================
window.addEventListener("load", function() {
  applySession();
  setTodayLabel();
  restoreTimer();
  initTaskListEvents(); // ★ 課題リストのクリックをイベント委譲で処理（IDに引用符が含まれても壊れないように）

  // ★ 修正：「ログ一覧」の表示が、ポイント・達成済み課題・全ユーザー名簿
  //   など他のデータ取得が終わるまで待たされていて遅く感じられていた。
  //   renderLogs() は logs（loadLogs()の結果）だけで描画できるので、
  //   他の読み込みを待たず最優先で取得し、届いた時点ですぐ表示する。
  //   （loadLogs() の呼び出しは1回だけ。下のPromise.allでは、ここで
  //   発行済みのPromiseをそのまま使い回す＝二重フェッチしない）
  const logsPromise = loadLogs();
  logsPromise.then(renderLogs);

  Promise.all([
    logsPromise,
    loadUsers(),           // ★ 全ユーザーのnicknameMapを構築
    loadSubjects(),
    loadPoints(),
    loadCompletedTasks(),
    loadAllCompletedTasks(),
    loadTasks()
  ]).then(function() {
    renderSubjectDropdown();
    renderAll(); // ★ ランキング・みんなの記録も含めて改めて描画（renderLogs()の再描画は無害）
    renderTasks();
  });
  prefetchOtherPages(); // ★ 追加：メニューを開くのを待たず、初期表示後に自動で他ページを裏で先読み
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
  attachAccountClickHandlers();
}

// ★ 「⚙ アカウント」ボタンの代わりに、ヘッダーのニックネーム／学籍番号を
//   クリックするとアカウント設定モーダルが開くようにする
function attachAccountClickHandlers() {
  hideLegacyAccountButton();

  var nicknameEl = document.getElementById("header-nickname");
  var idEl       = document.getElementById("header-id");
  var avatarEl   = document.getElementById("header-avatar");

  [nicknameEl, idEl, avatarEl].forEach(function(el) {
    if (!el) return;
    el.style.cursor = "pointer";
    el.title = "タップしてアカウント設定を開く";
    el.onclick = openAccountModal;
  });
}

// ============================================================
//  ★ アカウント設定（ニックネーム変更・パスワード変更）
//  ─────────────────────────────
//  以前は専用の「⚙ アカウント」ボタン（フローティング or
//  id="header-account-btn"）から開いていたが、現在はヘッダーの
//  ニックネーム／学籍番号（attachAccountClickHandlers参照）を
//  タップすることで開く方式に変更。HTML側に古いボタンが残っている
//  場合は誤動作防止のため非表示にしておく。
//  パスワード変更は、Discordの/id連携が済んでいる本人にDMで確認コードを
//  送り、それを入力してもらってから初めて反映する（本人確認のため）。
// ============================================================
function hideLegacyAccountButton() {
  var legacyBtn = document.getElementById("header-account-btn");
  if (legacyBtn) legacyBtn.style.display = "none";
  var fab = document.getElementById("sl-acct-fab");
  if (fab) fab.remove();
}

function openAccountModal() {
  closeAccountModal(); // 二重生成防止

  var overlay = document.createElement("div");
  overlay.id = "sl-acct-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.55);" +
    "display:flex;align-items:center;justify-content:center;padding:16px;";
  overlay.onclick = function(e) { if (e.target === overlay) closeAccountModal(); };

  var box = document.createElement("div");
  box.style.cssText =
    "background:#fff;border-radius:16px;max-width:420px;width:100%;" +
    "max-height:90vh;overflow:auto;padding:24px;font-family:inherit;" +
    "box-shadow:0 20px 50px rgba(0,0,0,.3);";

  box.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
      '<h2 style="margin:0;font-size:18px;">アカウント設定</h2>' +
      '<button id="sl-acct-close" style="border:none;background:none;font-size:20px;cursor:pointer;line-height:1;">✕</button>' +
    '</div>' +

    '<div style="font-size:13px;color:#64748b;margin-bottom:20px;">学籍番号: ' + escapeHtmlSl(STUDENT.id) + '</div>' +

    '<div style="margin-bottom:24px;">' +
      '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">ニックネーム</label>' +
      '<div style="display:flex;gap:8px;">' +
        '<input id="sl-acct-nickname" maxlength="16" value="' + escapeHtmlSl(STUDENT.nickname) + '" ' +
          'style="flex:1;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;">' +
        '<button id="sl-acct-nickname-save" style="padding:8px 14px;border:none;border-radius:8px;background:#2563eb;color:#fff;font-size:13px;cursor:pointer;">保存</button>' +
      '</div>' +
      '<div id="sl-acct-nickname-msg" style="font-size:12px;margin-top:6px;"></div>' +
    '</div>' +

    '<div style="border-top:1px solid #e2e8f0;padding-top:20px;">' +
      '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">パスワードの変更</label>' +
      '<p style="font-size:12px;color:#64748b;margin:0 0 10px;">' +
        '本人確認のため、Discordに確認コードを送ります。<br>' +
        '（Discordの /id連携 コマンドを済ませている生徒のみ利用できます）' +
      '</p>' +
      '<button id="sl-acct-send-code" style="padding:8px 14px;border:none;border-radius:8px;background:#334155;color:#fff;font-size:13px;cursor:pointer;">Discordに確認コードを送る</button>' +
      '<div id="sl-acct-code-msg" style="font-size:12px;margin-top:6px;"></div>' +

      '<div id="sl-acct-pw-fields" style="display:none;margin-top:14px;">' +
        '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">確認コード（6桁）</label>' +
        '<input id="sl-acct-code" maxlength="6" inputmode="numeric" placeholder="123456" ' +
          'style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;margin-bottom:10px;">' +
        '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">新しいパスワード（4文字以上）</label>' +
        '<input id="sl-acct-newpw" type="password" maxlength="64" ' +
          'style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;margin-bottom:10px;">' +
        '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">新しいパスワード（確認）</label>' +
        '<input id="sl-acct-newpw2" type="password" maxlength="64" ' +
          'style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;margin-bottom:10px;">' +
        '<button id="sl-acct-confirm-pw" style="width:100%;padding:10px;border:none;border-radius:8px;background:#2563eb;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">パスワードを変更する</button>' +
        '<div id="sl-acct-pw-msg" style="font-size:12px;margin-top:6px;"></div>' +
      '</div>' +
    '</div>' +

    '<div style="border-top:1px solid #e2e8f0;padding-top:20px;margin-top:20px;">' +
      '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">🔗 Discord連携</label>' +
      '<p style="font-size:12px;color:#64748b;margin:0 0 10px;">' +
        '連携すると、タイマーの3時間経過通知などをDiscordのDMで直接受け取れます。' +
      '</p>' +
      '<button id="sl-acct-oauth-btn" style="width:100%;padding:10px;border:none;border-radius:8px;background:#5865F2;color:#fff;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">🔗 Discordで連携する</button>' +
      '<div id="sl-acct-oauth-msg" style="font-size:12px;margin-top:6px;text-align:center;"></div>' +
    '</div>';

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  document.getElementById("sl-acct-close").onclick  = closeAccountModal;
  document.getElementById("sl-acct-nickname-save").onclick = submitNicknameChange;
  document.getElementById("sl-acct-send-code").onclick     = requestPasswordChangeCode;
  document.getElementById("sl-acct-confirm-pw").onclick    = submitPasswordChange;
  document.getElementById("sl-acct-oauth-btn").onclick     = startDiscordOAuth;
}

function closeAccountModal() {
  var el = document.getElementById("sl-acct-overlay");
  if (el) el.remove();
}

function escapeHtmlSl(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function setAcctMsg(id, msg, isError) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? "#dc2626" : "#16a34a";
}

// ── ニックネーム変更 ────────────────────────────────────
async function submitNicknameChange() {
  var input = document.getElementById("sl-acct-nickname");
  var btn   = document.getElementById("sl-acct-nickname-save");
  var nickname = (input.value || "").trim();

  if (!nickname)            { setAcctMsg("sl-acct-nickname-msg", "ニックネームを入力してください", true); return; }
  if (nickname.length > 16) { setAcctMsg("sl-acct-nickname-msg", "16文字以内で入力してください", true); return; }

  btn.disabled = true;
  try {
    var data = await api("/change_nickname", {
      method: "POST",
      body: JSON.stringify({ guild_id: GUILD_ID, session_token: SESSION_TOKEN, nickname: nickname }),
    });
    if (data && data.ok) {
      // ★ セッション・画面上の表示・nicknameMapを全て更新する
      STUDENT.nickname = nickname;
      var s = getSession() || {};
      s.nickname = nickname;
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch(e) {}
      nicknameMap[STUDENT.id] = nickname;
      applySession();
      renderAll();
      setAcctMsg("sl-acct-nickname-msg", "✓ 保存しました");
    } else if (data && data.error === "not_logged_in") {
      forceReLogin();
    } else {
      setAcctMsg("sl-acct-nickname-msg", "保存に失敗しました", true);
    }
  } catch(e) {
    setAcctMsg("sl-acct-nickname-msg", "サーバーに接続できません", true);
  } finally {
    btn.disabled = false;
  }
}

// ── パスワード変更：STEP1 確認コード送信 ────────────────
async function requestPasswordChangeCode() {
  var btn = document.getElementById("sl-acct-send-code");
  btn.disabled = true;
  try {
    var data = await api("/request_password_change_code", {
      method: "POST",
      body: JSON.stringify({ guild_id: GUILD_ID, session_token: SESSION_TOKEN }),
    });
    if (data && data.ok) {
      document.getElementById("sl-acct-pw-fields").style.display = "";
      setAcctMsg("sl-acct-code-msg", "✓ Discordに確認コードを送信しました（10分間有効）");
      document.getElementById("sl-acct-code").focus();
    } else if (data && data.error === "not_logged_in") {
      forceReLogin();
    } else if (data && data.error === "not_linked") {
      setAcctMsg("sl-acct-code-msg", "Discordと連携されていません。Discordで /id連携 コマンドを実行してから、もう一度お試しください。", true);
    } else if (data && data.error === "too_soon") {
      setAcctMsg("sl-acct-code-msg", "少し時間をおいてから再度お試しください（あと約" + (data.retry_after_sec || 60) + "秒）", true);
    } else {
      setAcctMsg("sl-acct-code-msg", "送信に失敗しました。時間をおいて再試行してください。", true);
    }
  } catch(e) {
    setAcctMsg("sl-acct-code-msg", "サーバーに接続できません", true);
  } finally {
    btn.disabled = false;
  }
}

// ── パスワード変更：STEP2 コード＋新パスワードで確定 ────
async function submitPasswordChange() {
  var code     = (document.getElementById("sl-acct-code").value || "").trim();
  var newPw    = document.getElementById("sl-acct-newpw").value;
  var newPw2   = document.getElementById("sl-acct-newpw2").value;
  var btn      = document.getElementById("sl-acct-confirm-pw");

  if (!/^[0-9]{6}$/.test(code)) { setAcctMsg("sl-acct-pw-msg", "確認コード（6桁の数字）を入力してください", true); return; }
  if (!newPw || newPw.length < 4) { setAcctMsg("sl-acct-pw-msg", "パスワードは4文字以上で入力してください", true); return; }
  if (newPw !== newPw2) { setAcctMsg("sl-acct-pw-msg", "パスワード（確認）が一致しません", true); return; }

  btn.disabled = true;
  try {
    var data = await api("/confirm_password_change", {
      method: "POST",
      body: JSON.stringify({
        guild_id: GUILD_ID, session_token: SESSION_TOKEN,
        code: code, new_password: newPw,
      }),
    });
    if (data && data.ok) {
      setAcctMsg("sl-acct-pw-msg", "✓ パスワードを変更しました");
      document.getElementById("sl-acct-code").value   = "";
      document.getElementById("sl-acct-newpw").value  = "";
      document.getElementById("sl-acct-newpw2").value = "";
    } else if (data && data.error === "not_logged_in") {
      forceReLogin();
    } else if (data && data.error === "wrong_code") {
      setAcctMsg("sl-acct-pw-msg", "確認コードが正しくありません", true);
    } else if (data && data.error === "code_expired") {
      setAcctMsg("sl-acct-pw-msg", "確認コードの有効期限が切れました。もう一度送信してください。", true);
    } else if (data && data.error === "code_not_requested") {
      setAcctMsg("sl-acct-pw-msg", "先に確認コードを送信してください", true);
    } else {
      setAcctMsg("sl-acct-pw-msg", "変更に失敗しました。時間をおいて再試行してください。", true);
    }
  } catch(e) {
    setAcctMsg("sl-acct-pw-msg", "サーバーに接続できません", true);
  } finally {
    btn.disabled = false;
  }
}

// ── ログアウト ──────────────────────────────────────────
function doLogout() {
  if (!confirm("ログアウトしますか？")) return;
  localStorage.removeItem(SESSION_KEY);
  location.replace("/Login.html");
}

// ★ サーバー側でセッションが無効（期限切れ・別端末でログアウト等）と
//   判定された場合に、ログイン画面へ強制的に戻す

function forceReLogin() {
  localStorage.removeItem(SESSION_KEY);
  alert("ログインが切れました。もう一度ログインしてください。");
  location.replace("/Login.html");
}

// ── Discord OAuth連携（「Discordでログイン」ボタン方式） ──
// ★ ログイン済み（session_token検証済み）の本人だけが呼べるAPIで
//   一時stateを発行してもらい、そのstate付きでDiscordの認可画面に
//   ブラウザごと移動する。認可後はサーバー側(/discord_oauth_callback)が
//   stateを検証してから連携するので、他人になりすまして連携される
//   心配はない（state自体が「ログイン済みの本人」に対してのみ発行される）。
async function startDiscordOAuth() {
  var btn = document.getElementById("sl-acct-oauth-btn");
  btn.disabled = true;
  try {
    var data = await api("/discord_oauth_start", {
      method: "POST",
      body: JSON.stringify({ guild_id: GUILD_ID, session_token: SESSION_TOKEN }),
    });
    if (data && data.ok && data.authorize_url) {
      location.href = data.authorize_url; // Discordの認可画面へ移動
    } else if (data && data.error === "not_logged_in") {
      forceReLogin();
    } else if (data && data.error === "oauth_not_configured") {
      setAcctMsg("sl-acct-oauth-msg", "現在Discord連携（OAuth）は準備中です。上のコード方式をご利用ください。", true);
    } else {
      setAcctMsg("sl-acct-oauth-msg", "連携の開始に失敗しました。時間をおいて再試行してください。", true);
    }
  } catch(e) {
    setAcctMsg("sl-acct-oauth-msg", "サーバーに接続できません", true);
  } finally {
    btn.disabled = false;
  }
}

// ── 全ユーザー一覧からnicknameMapを構築 ★ ──────────────
async function loadUsers() {
  try {
    var data = await api("/get_users?guild_id=" + GUILD_ID);
    if (data.ok) {
      (data.users || []).forEach(function(u) {
        if (u.id && u.nickname) nicknameMap[u.id] = u.nickname;
      });
    }
  } catch(e) {}
  // 自分自身は必ずセッションから上書き
  nicknameMap[STUDENT.id] = STUDENT.nickname;
}

// ── 達成済み課題（自分のみ・サーバー管理・日付付き） ───
async function loadCompletedTasks() {
  try {
    var data = await api(
      "/get_completed_tasks?guild_id=" + GUILD_ID + "&student_id=" + STUDENT.id
    );
    if (data.ok) {
      completedTasks = (data.done || []).map(function(e) {
        return typeof e === "string"
          ? { id: e, date: null, points: null, nickname: null }
          : e;
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

// ── ログ取得（nicknameMap も同時に補完） ───────────────
async function loadLogs() {
  try {
    var data = await api("/list_study_logs?guild_id=" + GUILD_ID);
    logs = data.ok ? (data.logs || []) : [];
    logs.forEach(function(l) {
      // loadUsers() で取得済みの値を優先し、未登録IDのみ補完
      if (l.student_id && l.nickname && !nicknameMap[l.student_id]) {
        nicknameMap[l.student_id] = l.nickname;
      }
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
// ★ 戻り値 { ok: true } / { ok: false, error: "…" }
//    サーバー側の不正防止チェック（連続記録の制限など）で拒否された場合や
//    通信エラーの場合は ok:false を返し、呼び出し側でエラー表示を行う。
//    （以前は通信エラー時もローカルだけ成功扱いにしていたが、サーバー側の
//      不正防止チェックを無意味にしてしまうため、失敗はきちんと失敗として扱う）
async function postLog(entry) {
  var data;
  try {
    data = await api("/add_study_log", {
      method: "POST",
      body: JSON.stringify(Object.assign({ guild_id: GUILD_ID, session_token: SESSION_TOKEN }, entry)),
    });
  } catch(e) {
    return { ok: false, error: "通信エラーが発生しました。もう一度お試しください。" };
  }

  if (!data || data.ok === false) {
    if (data && data.error === "not_logged_in") { forceReLogin(); return { ok: false, error: "ログインが切れました。再度ログインしてください。" }; }
    return { ok: false, error: (data && data.error) || "記録に失敗しました。" };
  }

  var earned = (data.earned != null) ? data.earned : Math.floor(entry.minutes / 5);
  if (earned > 0) {
    allPoints[STUDENT.id] = (data.total != null) ? data.total : (allPoints[STUDENT.id] || 0) + earned;
    myPoints = allPoints[STUDENT.id];
    floatPoints("+" + earned + "pt");
    updatePointDisplay();
  }
  nicknameMap[STUDENT.id] = STUDENT.nickname;
  logs.push(entry);
  renderAll();
  return { ok: true };
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
      if (!e.date) return;
      var d = new Date(e.date); d.setHours(0, 0, 0, 0);
      if (d < r.mon || d > r.sun) return;

      var pts;
      if (e.points != null) {
        pts = e.points;
      } else {
        var task = TASKS_JSON.find(function(t) { return t.id === e.id; });
        pts = task ? task.points : DEFAULT_TASK_POINTS;
      }

      if (!map[sid]) map[sid] = 0;
      map[sid] += pts;
    });
  });

  return map;
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
      timeMap[l.student_id] = {
        nickname: nicknameMap[l.student_id] || l.nickname,
        min: 0
      };
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

// ── みんなの記録 ──────────────────────────────────────
function renderEveryone(wl, totMin) {
  var weekPtsRaw = calcWeeklyPoints(wl);
  var totPts     = Object.values(weekPtsRaw).reduce(function(s, v) { return s + v; }, 0);

  var minEl = document.getElementById("everyone-week-min");
  var ptsEl = document.getElementById("everyone-week-pts");
  if (minEl) minEl.textContent = totMin + "分";
  if (ptsEl) ptsEl.textContent = totPts + "pt";

  var weekMinMap = {};
  wl.forEach(function(l) {
    weekMinMap[l.student_id] = (weekMinMap[l.student_id] || 0) + l.minutes;
  });

  // nicknameMap に存在する全員＋ポイント・課題達成のある全員を対象にする
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
// ★② 達成済みは下に並ぶようソートする
// ★① pendingTaskIds に含まれるタスクは「送信中」表示にしてボタンを無効化
function renderTasks() {
  var el = document.getElementById("task-list");
  var doneIds = completedTasks.map(function(e) { return e.id; });

  var sorted = TASKS_JSON.slice().sort(function(a, b) {
    var aDone = doneIds.includes(a.id) ? 1 : 0;
    var bDone = doneIds.includes(b.id) ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone; // 未達成が先、達成済みが後ろ
    // 同じ達成状態同士は締切が近い順
    return new Date(a.due) - new Date(b.due);
  });

  el.innerHTML = sorted.map(function(t) {
    var done    = doneIds.includes(t.id);
    var pending = pendingTaskIds.has(t.id);

    var btnLabel = pending ? '<span class="sl-spinner" style="border-color:rgba(0,0,0,.25);border-top-color:#334155;"></span>送信中…' : (done ? "✓ 達成済み" : "達成する");
    var btnClass = "sl-task-btn" + (done ? " sl-task-btn-done" : "");

    // ★ 備考は普段は隠しておき、タップで表示する（Plan.jsの詳細表示と同じ考え方）
    var noteDot  = t.note ? '<span class="note-dot" title="備考あり">📝</span>' : '';
    var noteHtml = t.note ? '<div class="sl-task-note">' + esc(t.note) + '</div>' : '';

    return '<div class="sl-task-row' + (done ? " done-row" : "") + '">' +
      '<div class="sl-task-body' + (t.note ? " has-note" : "") + '">' +
        '<div class="sl-task-title' + (done ? " done" : "") + '">' + esc(t.title) + '</div>' +
        '<div class="sl-task-meta">' +
          '<span class="sl-subject-badge">' + esc(t.subject) + '</span>' +
          '<span class="sl-due">締切: ' + t.due + '</span>' +
          '<span class="sl-pts-badge">⭐ +' + t.points + 'pt</span>' +
          noteDot +
        '</div>' +
        noteHtml +
      '</div>' +
      '<button class="' + btnClass + '" data-task-id="' + escAttr(t.id) + '"' +
        (pending ? ' disabled' : '') + '>' +
        btnLabel +
      '</button>' +
    '</div>';
  }).join("");
}

// ★ 課題リストのクリックをイベント委譲で処理する（一度だけ登録すればOK）
//   ・「達成する／達成済み」ボタン → toggleTask()
//   ・備考ありの本文（.has-note） → toggleTaskNote()
//   inline onclick に生のIDや備考文字列を直接埋め込むと、内容に引用符（' や "）が
//   含まれた場合にHTML/JSが壊れて達成ボタンが反応しなくなるため、この方式に変更。
function initTaskListEvents() {
  var el = document.getElementById("task-list");
  if (!el || el.dataset.boundClick) return;
  el.dataset.boundClick = "1";
  el.addEventListener("click", function(e) {
    var btn = e.target.closest(".sl-task-btn");
    if (btn) {
      if (btn.disabled) return;
      toggleTask(btn.dataset.taskId);
      return;
    }
    var body = e.target.closest(".sl-task-body.has-note");
    if (body) toggleTaskNote(body);
  });
}

// ★ 備考のタップ表示切り替え（.sl-task-body をタップすると開閉する）
function toggleTaskNote(bodyEl) {
  var noteEl = bodyEl.querySelector(".sl-task-note");
  if (!noteEl) return;
  noteEl.classList.toggle("open");
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
async function saveManual() {
  var sub   = document.getElementById("m-subject").value;
  var min   = parseInt(document.getElementById("m-minutes").value);
  var memo  = document.getElementById("m-memo").value.trim();
  var errEl = document.getElementById("manual-err");
  var okEl  = document.getElementById("manual-ok");
  var btnEl = document.querySelector('button[onclick*="saveManual"]');
  errEl.style.display = "none";
  okEl.style.display  = "none";

  if (btnEl && btnEl.disabled) return; // ★ 連打防止：送信中は何もしない

  if (!min || min < 1) {
    errEl.textContent   = "✕ 1分以上の時間を入力してください";
    errEl.style.display = "block";
    setTimeout(function() { errEl.style.display = "none"; }, 3500);
    return;
  }

  // ★ 教科を問わず、本人の直近の手入力から MANUAL_COOLDOWN_MS 経つまで不可（連打防止）
  //   ※サーバー側（bot.py の add_study_log）にも同じ判定があり、そちらが最終防衛。
  //     ここはあくまで早めにエラーを見せるためのUX用チェック。
  var manualMap  = getManualLastLogMap();
  var allTimes   = Object.keys(manualMap).map(function(k) { return manualMap[k]; });
  var lastAnyAt  = allTimes.length ? Math.max.apply(null, allTimes) : null;
  if (lastAnyAt) {
    var elapsedAnyMs = Date.now() - lastAnyAt;
    if (elapsedAnyMs < MANUAL_COOLDOWN_MS) {
      var remainAnySec = Math.ceil((MANUAL_COOLDOWN_MS - elapsedAnyMs) / 1000);
      errEl.textContent   = "✕ 記録は、前回から" + (MANUAL_COOLDOWN_MS / 1000) + "秒経ってから行えます（あと" + remainAnySec + "秒）";
      errEl.style.display = "block";
      setTimeout(function() { errEl.style.display = "none"; }, 3500);
      return;
    }
  }

  // ★ 同じ教科での連続手入力は、前回の記録から MANUAL_COOLDOWN_MS 経つまで不可
  var lastAt = manualMap[sub];
  if (lastAt) {
    var elapsedMs = Date.now() - lastAt;
    if (elapsedMs < MANUAL_COOLDOWN_MS) {
      var remainSec = Math.ceil((MANUAL_COOLDOWN_MS - elapsedMs) / 1000);
      errEl.textContent   = "✕ 同じ教科の記録は、前回から" + (MANUAL_COOLDOWN_MS / 1000) + "秒経ってから行えます（あと" + remainSec + "秒）";
      errEl.style.display = "block";
      setTimeout(function() { errEl.style.display = "none"; }, 3500);
      return;
    }
  }

  setButtonLoading(btnEl, true, "保存中…");

  var result = await postLog({ date: todayStr(), subject: sub, minutes: min, memo: memo,
            student_id: STUDENT.id, nickname: STUDENT.nickname, method: "manual" });

  if (!result.ok) {
    // ★ サーバー側の不正防止チェックで拒否された場合など
    setButtonLoading(btnEl, false);
    errEl.textContent   = "✕ " + result.error;
    errEl.style.display = "block";
    setTimeout(function() { errEl.style.display = "none"; }, 3500);
    return;
  }

  setManualLastLog(sub); // ★ 保存成功後に記録

  document.getElementById("m-minutes").value = "";
  document.getElementById("m-memo").value    = "";
  setButtonLoading(btnEl, false);
  okEl.style.display = "block";
  setTimeout(function() { okEl.style.display = "none"; showTab("home"); }, 1200);
}

// ============================================================
//  課題達成 / 取り消し
// ============================================================
// ★①②③ 対応版
//   ・サーバーへの送信が成功したのを確認してからローカル状態を更新する
//     （失敗時はローカルを変更しない＝ポーリングで勝手に戻る現象を防止）
//   ・送信中は多重クリックを防ぐため pendingTaskIds でボタンを無効化
//   ・達成済みをもう一度押すと /uncomplete_task を呼んで未達成に戻す
//     （★このエンドポイントはバックエンド側に新規実装が必要）
async function toggleTask(id) {
  if (pendingTaskIds.has(id)) return; // 二重送信防止

  var entryIndex = completedTasks.findIndex(function(e) { return e.id === id; });
  var isDone = entryIndex !== -1;

  pendingTaskIds.add(id);
  renderTasks();

  if (!isDone) {
    // ── 達成にする ──────────────────────────────────
    var t   = TASKS_JSON.find(function(x) { return x.id === id; });
    var pts = t ? t.points : DEFAULT_TASK_POINTS;

    try {
      var data = await api("/complete_task", {
        method: "POST",
        body: JSON.stringify({
          guild_id:      GUILD_ID,
          session_token: SESSION_TOKEN,
          task_id:       id,
        }),
      });
      if (!data || data.ok === false) {
        if (data && data.error === "not_logged_in") { forceReLogin(); return; }
        throw new Error("server rejected complete_task");
      }

      // ★ サーバーが成功を返してから、初めてローカルに反映する
      var entry = { id: id, date: todayStr(), points: pts, nickname: STUDENT.nickname };
      completedTasks.push(entry);
      if (!allCompletedTasks[STUDENT.id]) allCompletedTasks[STUDENT.id] = [];
      allCompletedTasks[STUDENT.id].push(entry);
      nicknameMap[STUDENT.id] = STUDENT.nickname;

      allPoints[STUDENT.id] = (data.total != null) ? data.total : (allPoints[STUDENT.id] || 0) + pts;
      myPoints = allPoints[STUDENT.id];
      updatePointDisplay();
      floatPoints("+" + pts + "pt");
    } catch (e) {
      alert("通信エラーのため達成にできませんでした。もう一度お試しください。");
    }
  } else {
    // ── 未達成に戻す ────────────────────────────────
    var removed = completedTasks[entryIndex];

    try {
      var data2 = await api("/uncomplete_task", {
        method: "POST",
        body: JSON.stringify({
          guild_id:      GUILD_ID,
          session_token: SESSION_TOKEN,
          task_id:       id,
        }),
      });
      if (!data2 || data2.ok === false) {
        if (data2 && data2.error === "not_logged_in") { forceReLogin(); return; }
        throw new Error("server rejected uncomplete_task");
      }

      // ★ サーバーが成功を返してから、初めてローカルに反映する
      completedTasks.splice(entryIndex, 1);
      if (allCompletedTasks[STUDENT.id]) {
        allCompletedTasks[STUDENT.id] = allCompletedTasks[STUDENT.id].filter(function(e) {
          return e.id !== id;
        });
      }

      var revertedTotal = (data2.total != null)
        ? data2.total
        : Math.max(0, (allPoints[STUDENT.id] || 0) - (removed ? removed.points : 0));
      allPoints[STUDENT.id] = revertedTotal;
      myPoints = revertedTotal;
      updatePointDisplay();
    } catch (e) {
      alert("通信エラーのため未達成に戻せませんでした。もう一度お試しください。\n（サーバー側に /uncomplete_task が実装されていない可能性があります）");
    }
  }

  pendingTaskIds.delete(id);
  renderTasks();
  renderAll();
}

// ============================================================
//  タイマー
// ============================================================
function pad(n) { return String(n).padStart(2, "0"); }

function updateTimerUI() {
  var t = Math.floor(timerSec); // ★ サーバー由来の値に端数が混ざっていても表示が壊れないようにする
  var h = Math.floor(t / 3600);
  var m = Math.floor((t % 3600) / 60);
  var s = t % 60;
  document.getElementById("timer-display").textContent = pad(h)+":"+pad(m)+":"+pad(s);
  var hint = document.getElementById("timer-pts-hint");
  if (timerRunning && !timerIsPaused) {
    var remaining = (lastAwardedMin + 5) * 60 - timerSec;
    hint.textContent = remaining > 0 ? "次の +1pt まで " + remaining + "秒" : "";
  } else { hint.textContent = ""; }
}

// ============================================================
//  ★ タイマー状態のサーバー同期（複数端末対応）
//  ─────────────────────────────
//  以前はタイマーの開始時刻をブラウザのlocalStorageだけに保存していたため
//  ①別端末・別ブラウザからは状態が見えず、二重に計測を始められる
//  ②タブを閉じる／バックグラウンドに置くとJSが止まり、「3時間経過」の
//    検知が遅れる（＝精度が低い。時には全く違う経過時間で「破棄」と
//    誤判定されてしまう）
//  という問題があった。
//  → 開始・一時停止・再開の「時刻」はサーバー（bot.py）で管理し、
//    どの端末で開いても同じ状態が見えるようにする。3時間経過の判定・
//    DM通知も、タブが開いているかに関係なくサーバー側が正確に行う
//    （StudyLog.js側はその結果を表示に反映するだけ）。
// ============================================================
async function timerApiState() {
  try {
    return await api("/timer_state?guild_id=" + GUILD_ID + "&session_token=" + encodeURIComponent(SESSION_TOKEN));
  } catch(e) { return null; }
}
async function timerApiStart() {
  try {
    return await api("/timer_start", { method: "POST",
      body: JSON.stringify({ guild_id: GUILD_ID, session_token: SESSION_TOKEN }) });
  } catch(e) { return null; }
}
async function timerApiPause() {
  try {
    return await api("/timer_pause", { method: "POST",
      body: JSON.stringify({ guild_id: GUILD_ID, session_token: SESSION_TOKEN }) });
  } catch(e) { return null; }
}
async function timerApiResume() {
  try {
    return await api("/timer_resume", { method: "POST",
      body: JSON.stringify({ guild_id: GUILD_ID, session_token: SESSION_TOKEN }) });
  } catch(e) { return null; }
}
async function timerApiStop() {
  try {
    return await api("/timer_stop", { method: "POST",
      body: JSON.stringify({ guild_id: GUILD_ID, session_token: SESSION_TOKEN }) });
  } catch(e) { return null; }
}

// 現在の実行中区間を含めた経過秒（表示用）
function computeElapsedSec() {
  if (timerRunning && runStartClientEpoch != null) {
    return accumulatedSec + Math.floor((Date.now() - runStartClientEpoch) / 1000);
  }
  return accumulatedSec;
}

// サーバーから受け取ったタイマー状態(state/elapsed_sec/run_start_epoch/
// accumulated_sec/pause_reason/server_now)をローカルの表示用変数へ反映する。
// ★ server_now とこの端末のDate.now()の差（時計のズレ）を吸収してから
//   run_start_epoch をこの端末の時計に換算するので、端末の時計が多少
//   ズレていても表示上の経過時間は正確になる。
function applyServerTimerState(resp) {
  var clockOffset = (resp.server_now != null) ? (resp.server_now - Date.now()) : 0;
  accumulatedSec  = Math.round(resp.accumulated_sec || 0); // ★ サーバー側で丸め済みのはずだが念のため防御的に丸める
  runStartClientEpoch = (resp.state === "running" && resp.run_start_epoch != null)
    ? (resp.run_start_epoch - clockOffset)
    : null;
  timerRunning  = (resp.state === "running");
  timerIsPaused = (resp.state === "paused");
  pauseReason   = resp.pause_reason || null; // "manual" | "checkpoint" | null
  timerSec = computeElapsedSec();
  // 離れていた間の5分区切りポイントを二重付与しないよう、経過分数から
  // 「本来もう付与されているはずの区切り」まで進めておく
  lastAwardedMin = Math.floor(timerSec / 60 / 5) * 5;
}

// ★ 定期的にサーバーの本当の状態と同期する（他端末での一時停止／再開、
//   3時間ごとの自動休憩などを検知するため）
function startSyncPolling() {
  if (timerSyncInterval) clearInterval(timerSyncInterval);
  timerSyncInterval = setInterval(syncTimerFromServer, 20000);
}

async function syncTimerFromServer() {
  var res = await timerApiState();
  if (!res || !res.ok) return;

  if (res.state === "idle") {
    // 保存・破棄が別端末で済んだ
    clearInterval(timerInterval);     timerInterval     = null;
    clearInterval(timerSyncInterval); timerSyncInterval = null;
    var onTimerScreen =
      document.getElementById("timer-main").style.display === "block" ||
      document.getElementById("timer-confirm").style.display === "block";
    if (onTimerScreen) timerReset();
    return;
  }

  if (res.state === "paused" && timerRunning) {
    // ★ 3時間経過による自動休憩、または他端末での一時停止
    clearInterval(timerInterval); timerInterval = null;
    applyServerTimerState(res);
    updateTimerUI();
    document.getElementById("btn-pause").textContent = "▶ 再開";
    if (pauseReason === "checkpoint") {
      document.getElementById("timer-status").textContent = "休憩中...（3時間経過したため自動的に休憩にしました。再開すると続きから計測できます）";
      notifyUserBrowserOnly("StudyLog", "3時間が経過したため、自動的に休憩（一時停止）にしました。「再開」から続きを計測できます。");
    } else {
      document.getElementById("timer-status").textContent = "休憩中...（他の端末で一時停止されました）";
    }
    startSyncPolling();
    return;
  }

  if (res.state === "running" && timerIsPaused) {
    applyServerTimerState(res);
    document.getElementById("btn-pause").textContent    = "⏸ 休憩";
    document.getElementById("timer-status").textContent = "計測中...（他の端末で再開されました）";
    startInterval();
    return;
  }

  if (res.state === "running") {
    applyServerTimerState(res); // ズレ補正
  }
}

function startInterval() {
  if (timerInterval) clearInterval(timerInterval);
  // ★ 直前に何分まで自動休憩チェック済みだったかを、現在の経過時間から
  //   合わせ直しておく（再開直後などに余計なチェックが走らないように）
  lastCheckpointMin = Math.floor(timerSec / 60 / 180) * 180;
  timerInterval = setInterval(function() {
    timerSec = computeElapsedSec();
    var curMin = Math.floor(timerSec / 60);

    // ★ 3時間（180分）ごとに、サーバー側の自動休憩判定を早めに取りに行く。
    //   タブが開いている間は最大20秒のポーリング待ちを避け、素早く休憩へ
    //   切り替わったことを反映できるようにする。実際の判定・DM通知は
    //   タブの状態に関わらずサーバー側（check_study_timers）が正確に行う。
    if (curMin > 0 && curMin % 180 === 0 && curMin > lastCheckpointMin) {
      lastCheckpointMin = curMin;
      syncTimerFromServer();
    }

    if (curMin > 0 && curMin % 5 === 0 && curMin > lastAwardedMin) {
      lastAwardedMin = curMin;
      myPoints++;
      allPoints[STUDENT.id] = (allPoints[STUDENT.id] || 0) + 1;
      floatPoints("+1pt");
      updatePointDisplay();
    }
    updateTimerUI();
  }, 500);
  startSyncPolling();
}

// ── ブラウザ通知（他のタブを見ていても気づけるように） ──────
// 許可されていれば端末通知、未許可・未対応ならalert()にフォールバック。
// ※ タブそのものを閉じている場合はどちらも動作しません（JSが動いていないため）。
function ensureNotifyPermission() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function notifyUser(title, body) {
  // ★ Discord連携済みなら本人のDiscordへ直接DM通知を送る（bot.py側で /id連携 済みの場合のみ）。
  //   これはブラウザのタブを閉じていても、他のサイトを見ていても届く。
  //   未連携・送信失敗の場合はブラウザ通知（またはalert）にフォールバックする。
  console.log("[notifyUser] /notify_dm 呼び出し開始", { guild_id: GUILD_ID, title: title, body: body });
  api("notify_dm", {
    method: "POST",
    body: JSON.stringify({ guild_id: GUILD_ID, session_token: SESSION_TOKEN, title: title, message: body })
  }).then(function(res) {
    console.log("[notifyUser] /notify_dm 応答:", res);
    if (!res || !res.ok) {
      console.warn("[notifyUser] DM失敗 or 未連携。ブラウザ通知にフォールバック。理由:", res && res.error);
      notifyUserBrowserOnly(title, body);
    }
  }).catch(function(err) {
    console.error("[notifyUser] /notify_dm 通信エラー。ブラウザ通知にフォールバック。", err);
    notifyUserBrowserOnly(title, body);
  });
}

function notifyUserBrowserOnly(title, body) {
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try { new Notification(title, { body: body }); return; } catch(e) {}
  }
  alert(body);
}

async function timerStart() {
  if (timerRunning || timerIsPaused) return;
  ensureNotifyPermission(); // ★ ユーザー操作（クリック）のタイミングで許可をリクエスト
  var btn = document.getElementById("btn-start");
  if (btn) btn.disabled = true; // ★ 連打防止（応答が返るまで）

  var res = await timerApiStart();

  if (!res || res.ok === false) {
    if (res && res.error === "not_logged_in") { forceReLogin(); return; }
    if (res && res.error === "already_paused") {
      // ★ 他の端末で既に一時停止中（3時間経過での自動休憩を含む） → こちらもその状態に合わせる
      applyServerTimerState(res);
      document.getElementById("btn-start").disabled = true;
      document.getElementById("btn-pause").disabled  = false;
      document.getElementById("btn-stop").disabled   = false;
      document.getElementById("btn-pause").textContent    = "▶ 再開";
      document.getElementById("timer-status").textContent =
        res.pause_reason === "checkpoint"
          ? "休憩中...（3時間経過したため自動的に休憩にしました。再開すると続きから計測できます）"
          : "休憩中...（他の端末で開始された記録に接続しました）";
      updateTimerUI();
      startSyncPolling();
      return;
    }
    if (btn) btn.disabled = false;
    alert("通信エラーのためタイマーを開始できませんでした。もう一度お試しください。");
    return;
  }

  applyServerTimerState(res);
  document.getElementById("btn-start").disabled = true;
  document.getElementById("btn-pause").disabled = false;
  document.getElementById("btn-stop").disabled  = false;
  document.getElementById("btn-pause").textContent = "⏸ 休憩";
  document.getElementById("timer-status").textContent =
    res.joined ? "計測中...（他の端末で開始された記録に接続しました）" : "計測中...";
  startInterval();
}

async function timerPauseResume() {
  if (!timerRunning && !timerIsPaused) return;
  var btn = document.getElementById("btn-pause");
  if (btn) btn.disabled = true; // ★ 連打防止（応答が返るまで）

  if (!timerIsPaused) {
    // 休憩する
    clearInterval(timerInterval); timerInterval = null;
    var res = await timerApiPause();
    if (!res || res.ok === false) {
      if (res && res.error === "not_logged_in") { forceReLogin(); return; }
      // サーバーとの同期に失敗した場合は最新状態を取り直して表示だけ合わせる
      var st = await timerApiState();
      if (st && st.ok) applyServerTimerState(st);
      startInterval();
      if (btn) btn.disabled = false;
      return;
    }
    applyServerTimerState(res);
    document.getElementById("btn-pause").textContent      = "▶ 再開";
    document.getElementById("timer-status").textContent   = "休憩中...";
    document.getElementById("timer-pts-hint").textContent = "";
  } else {
    // 再開する
    var res2 = await timerApiResume();
    if (!res2 || res2.ok === false) {
      if (res2 && res2.error === "not_logged_in") { forceReLogin(); return; }
      alert("通信エラーのため再開できませんでした。もう一度お試しください。");
      if (btn) btn.disabled = false;
      return;
    }
    applyServerTimerState(res2);
    document.getElementById("btn-pause").textContent    = "⏸ 休憩";
    document.getElementById("timer-status").textContent = "計測中...";
    startInterval();
  }
  if (btn) btn.disabled = false;
}

async function timerStop() {
  clearInterval(timerInterval); timerInterval = null;
  var wasRunning = timerRunning;
  timerRunning = false; timerIsPaused = true;

  // ★ ここではまだ保存/破棄が決まっていないため、サーバー側の記録は
  //   すぐに消さず「一時停止」扱いで経過時間だけ確定させておく。
  //   これにより他の端末には「一時停止しました」と正しく伝わり、
  //   計測中の表示が理由もなく途中でリセットされるのを防げる。
  //   （実際にサーバー側の記録を消すのは、保存 or 破棄が確定した時）
  if (wasRunning) {
    var res = await timerApiPause();
    if (res && res.ok) applyServerTimerState(res);
  }
  startSyncPolling(); // ★ 確認画面を見ている間も、他端末での保存/破棄を検知できるようにする

  var mins = Math.floor(timerSec / 60);
  if (mins < 1) {
    alert("1分未満のため記録できません");
    timerApiStop(); // 記録として残す価値が無いので、ここでサーバー側もクリアする
    timerReset(); return;
  }
  document.getElementById("timer-main").style.display    = "none";
  document.getElementById("timer-confirm").style.display = "block";
  document.getElementById("conf-time").textContent       = mins + "分 " + pad(timerSec % 60) + "秒";
  document.getElementById("conf-time").dataset.min       = mins;
}

async function saveTimer() {
  var sub  = document.getElementById("conf-subject").value;
  var memo = document.getElementById("conf-memo").value.trim();
  var mins = parseInt(document.getElementById("conf-time").dataset.min);
  var btnEl    = document.querySelector('button[onclick*="saveTimer"]');
  var editBtn  = document.querySelector('button[onclick*="editTimer"]');
  var discBtn  = document.querySelector('button[onclick*="discardTimer"]');

  if (btnEl && btnEl.disabled) return; // ★ 連打防止：送信中は何もしない

  // ★ 前回のタイマー記録から「今回記録しようとしている分数」以上の
  //    実時間が経過していない場合は保存させない（誤操作・二重送信防止）
  var last = getTimerLastLog();
  if (last && last.at) {
    var elapsedMs  = Date.now() - last.at;
    var requiredMs = mins * 60 * 1000;
    if (elapsedMs < requiredMs) {
      var remainMin = Math.ceil((requiredMs - elapsedMs) / 60000);
      alert("前回の記録からまだ十分な時間が経過していないため、この記録は保存できません。（あと約" + remainMin + "分待つ必要があります）");
      return;
    }
  }

  setButtonLoading(btnEl, true, "保存中…");
  if (editBtn) editBtn.disabled = true;
  if (discBtn) discBtn.disabled = true;

  var result = await postLog({ date: todayStr(), subject: sub, minutes: mins, memo: memo,
            student_id: STUDENT.id, nickname: STUDENT.nickname, method: "timer" });

  if (!result.ok) {
    // ★ サーバー側の不正防止チェックで拒否された場合など。
    //    確認画面はそのまま残し、ユーザーがもう一度試せるようにする。
    setButtonLoading(btnEl, false);
    if (editBtn) editBtn.disabled = false;
    if (discBtn) discBtn.disabled = false;
    alert(result.error);
    return;
  }

  setTimerLastLog(mins); // ★ 保存成功後に記録
  timerApiStop(); // ★ サーバー側のタイマー状態も後片付け（自動停止からの保存の場合など。結果は待たない）

  var okEl = document.getElementById("timer-ok");
  okEl.style.display = "block";
  setTimeout(function() {
    okEl.style.display = "none";
    setButtonLoading(btnEl, false);
    if (editBtn) editBtn.disabled = false;
    if (discBtn) discBtn.disabled = false;
    timerReset(); showTab("home");
  }, 1200);
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
  if (confirm("この計測結果を破棄しますか？")) {
    timerApiStop(); // ★ サーバー側のタイマー状態も後片付け（結果は待たない）
    timerReset(); showTab("home");
  }
}
function timerReset() {
  clearInterval(timerInterval);     timerInterval     = null;
  clearInterval(timerSyncInterval); timerSyncInterval = null;
  timerSec = 0; timerRunning = false; timerIsPaused = false; pauseReason = null;
  accumulatedSec = 0; runStartClientEpoch = null; lastAwardedMin = 0; lastCheckpointMin = 0;
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
}

// ★ ページを開いた直後に、サーバー側のタイマー状態を取得して画面に反映する。
//   これにより「別端末で計測中/休憩中の記録」もそのまま復元でき、また
//   3時間ごとの自動休憩もサーバー基準の正確な状態としてすぐに分かる
//   ようになる（以前のlocalStorageベースの判定はタブが開いていない間は
//   ズレる／進まないことがあった）。
async function restoreTimer() {
  var res = await timerApiState();
  if (!res || !res.ok) return;

  if (res.state !== "running" && res.state !== "paused") return; // idle：何もしない

  applyServerTimerState(res);
  document.getElementById("btn-start").disabled = true;
  document.getElementById("btn-pause").disabled = false;
  document.getElementById("btn-stop").disabled  = false;
  updateTimerUI();

  if (res.state === "paused") {
    document.getElementById("btn-pause").textContent    = "▶ 再開";
    document.getElementById("timer-status").textContent =
      res.pause_reason === "checkpoint"
        ? "休憩中...（3時間経過したため自動的に休憩にしました。再開すると続きから計測できます）"
        : "休憩中...（離れていた間も保持されていました）";
    startSyncPolling();
  } else {
    document.getElementById("btn-pause").textContent    = "⏸ 休憩";
    document.getElementById("timer-status").textContent = "計測中...（離れていた間も継続していました）";
    startInterval();
  }
}

// ============================================================
//  ドロワー
// ============================================================
function openDrawer() {
  document.getElementById("drawer").classList.add("open");
  document.getElementById("drawer-overlay").classList.add("open");
  prefetchOtherPages(); // ★ 追加：メニューを開いた瞬間に他ページを裏で先読み
}
// ★ 追加：ドロワーを開いた時点（＝まだどのページに行くか決める前）で、
//   他ページのJS/CSSをバックグラウンドで先読み（prefetch）しておく。
//   実際にメニューをタップしたときには既にブラウザキャッシュに入っている
//   ことが多く、体感の切り替え速度が上がる。一度実行したら再実行しない。
let _didPrefetchOtherPages = false;
function prefetchOtherPages() {
  if (_didPrefetchOtherPages) return;
  _didPrefetchOtherPages = true;
  [
    "/Plan.js",
    "/Timetable.js",
    "/Cardmaker.js", "/Cardmaker.css",
    "/Notice.js",
    "/ServiceInfo.js",
  ].forEach(href => {
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = href;
    document.head.appendChild(link);
  });
}
function closeDrawer() {
  document.getElementById("drawer").classList.remove("open");
  document.getElementById("drawer-overlay").classList.remove("open");
}

// ★ 追加：ドロワーのメニューをタップした瞬間に、読み込み中であることが
//   見た目にもすぐ伝わるよう、ページ遷移ローディングを即座に表示する
//   （実際のページ遷移はブラウザ標準の <a href> 遷移のまま。読み込みが
//   速いページならすぐ次のページに切り替わるので気づかない）。
document.querySelectorAll(".drawer-item[href]").forEach(a => {
  a.addEventListener("click", (e) => {
    // ★ 追加：今開いているページ自身の項目をタップした場合は、同じページへ
    //   わざわざ再遷移（リロード）せず、ドロワーを閉じるだけにする。
    if (a.classList.contains("active")) {
      e.preventDefault();
      closeDrawer();
      return;
    }
    const overlay = document.getElementById("page-nav-loading");
    if (overlay) overlay.classList.add("show");
  });
});
// ★ 追加：bfcache（ブラウザの「戻る」）で復元されたときに、遷移ローディングの
//   表示が残ったまま固まって見えないよう、表示のたびに必ず消しておく。
window.addEventListener("pageshow", () => {
  const overlay = document.getElementById("page-nav-loading");
  if (overlay) overlay.classList.remove("show");
});

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
// ★ 属性値用（esc()に加えて引用符もエスケープする。備考等の自由入力にクォートが
//   含まれていても onclick 属性やHTML構造が壊れないようにするため）
function escAttr(s) {
  return esc(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ============================================================
//  ★ JSON変更監視（予定・ログ・ポイント・達成状況）
//     いずれかに変化があったら、タイマーを止めずにデータだけ
//     再取得してランキング等を再描画する（ソフトリフレッシュ）
// ============================================================

// SHA-256 ハッシュ計算
async function digestMessage(message) {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// 指定パスのレスポンス本文からハッシュを計算
async function hashOfEndpoint(path) {
  const res = await fetch(API_BASE + path);
  const txt = await res.text();
  return digestMessage(txt);
}

// 監視対象4種類の最新ハッシュ（初回はnull＝比較せず保存だけ）
let watchHashes = {
  schedule:  null, // 予定・課題（list_schedule）
  logs:      null, // 勉強ログ（list_study_logs）
  points:    null, // 累計ポイント（get_points）
  completed: null, // 課題達成状況（get_completed_tasks・全ユーザー）
};

// 監視対象データをまとめて再取得＆再描画（タイマーには触れない）
async function refreshWatchedData() {
  // ★ 送信中のタスクがある間はポーリングでの上書きを避ける
  //   （送信完了後にtoggleTask内でrenderAll()するので取りこぼしは無い）
  if (pendingTaskIds.size > 0) return;

  await Promise.all([
    loadUsers(),
    loadSubjects(),
    loadLogs(),
    loadPoints(),
    loadCompletedTasks(),
    loadAllCompletedTasks(),
    loadTasks()
  ]);
  renderSubjectDropdown();
  renderAll();
  renderTasks();
}

// 変更チェック本体
async function checkForUpdates() {
  try {
    const [scheduleHash, logsHash, pointsHash, completedHash] = await Promise.all([
      hashOfEndpoint("/list_schedule?guild_id=" + GUILD_ID),
      hashOfEndpoint("/list_study_logs?guild_id=" + GUILD_ID),
      hashOfEndpoint("/get_points?guild_id=" + GUILD_ID),
      hashOfEndpoint("/get_completed_tasks?guild_id=" + GUILD_ID),
    ]);

    const isFirstCheck = watchHashes.schedule === null;

    const changed = !isFirstCheck && (
      scheduleHash  !== watchHashes.schedule  ||
      logsHash      !== watchHashes.logs      ||
      pointsHash    !== watchHashes.points    ||
      completedHash !== watchHashes.completed
    );

    watchHashes = {
      schedule:  scheduleHash,
      logs:      logsHash,
      points:    pointsHash,
      completed: completedHash,
    };

    if (changed) {
      await refreshWatchedData();
    }
  } catch(e) {}
}

// ★ 以前は10秒おきのポーリングだけだったが、サーバーが実際に常時稼働している
//   ので、変更があった瞬間にpushしてもらい即座に反映する（Server-Sent Events）。
//   接続が切れた場合に備え、10秒間隔のフォールバックポーリングも残す。
// ★ 勉強タイマーの同期（他端末での一時停止／再開、3時間ごとの自動休憩の検知）も
//   同じSSE接続に相乗りさせる。timerSyncInterval が動いている（＝タイマー画面が
//   進行中の記録を表示している）ときだけ syncTimerFromServer() を呼ぶことで、
//   従来のstartSyncPolling()と同じ「タイマーに関係あるときだけ同期する」条件を保つ。
function startRealtimeUpdates() {
  try {
    const es = new EventSource(`${API_BASE}events?guild_id=${GUILD_ID}`);
    es.onmessage = () => {
      checkForUpdates();
      if (timerSyncInterval) syncTimerFromServer();
    };
  } catch (e) {
    // EventSource非対応環境などでも、下のフォールバックポーリングだけで動作を継続できる
  }
}
startRealtimeUpdates();
setInterval(checkForUpdates, 10000);
