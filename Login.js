// ============================================================
//  Login.js — ログインページ専用スクリプト（学籍番号のみ認証）
//
//  認証フロー:
//    1. 学籍番号を入力
//    2. localStorage に登録済み → セッション生成してリダイレクト
//    3. 未登録 → ニックネーム入力画面へ遷移
//    4. ニックネーム登録 → ユーザー保存 → リダイレクト
//
//  StudyLog.js 側での使い方（変更なし）:
//    const session = JSON.parse(localStorage.getItem("sl_session") || "null");
//    if (!session) location.href = "/Login.html";
// ============================================================

const SESSION_KEY  = "sl_session";
const USERS_KEY    = "sl_users";       // 登録ユーザー一覧
const REDIRECT_PATH = "/StudyLog.html";

// アバターカラーパレット（登録順に自動割り当て）
const AVATAR_COLORS = [
  { color: "#dbeafe", text: "#1e40af" },
  { color: "#dcfce7", text: "#166534" },
  { color: "#fce7f3", text: "#9d174d" },
  { color: "#ffedd5", text: "#9a3412" },
  { color: "#fef9c3", text: "#854d0e" },
  { color: "#ede9fe", text: "#6d28d9" },
  { color: "#fee2e2", text: "#991b1b" },
  { color: "#f0fdf4", text: "#15803d" },
];

// ── 起動 ────────────────────────────────────────────────────
window.addEventListener("load", () => {
  if (getSession()) { location.href = REDIRECT_PATH; return; }
  showStep("step-id");
});

// ── セッション ───────────────────────────────────────────────
function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

// ── 登録ユーザー一覧 ─────────────────────────────────────────
function getUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; } catch { return {}; }
}
function saveUsers(users) {
  try { localStorage.setItem(USERS_KEY, JSON.stringify(users)); } catch {}
}

// ── ステップ切り替え ─────────────────────────────────────────
function showStep(id) {
  document.querySelectorAll(".login-step").forEach(el => {
    el.style.display = el.id === id ? "" : "none";
  });
}

// ============================================================
//  STEP 1 — 学籍番号入力
// ============================================================
function submitId() {
  const raw = document.getElementById("inp-student-id").value.trim().toUpperCase();
  const errEl = document.getElementById("id-err");
  errEl.style.display = "none";

  // バリデーション（例: 英数字 3〜20文字）
  if (!raw) { showIdErr("学籍番号を入力してください"); return; }
  if (!/^[A-Z0-9]{2,20}$/.test(raw)) {
    showIdErr("学籍番号は半角英数字で入力してください"); return;
  }

  const users = getUsers();

  if (users[raw]) {
    // 既存ユーザー → 即ログイン
    createSession(raw, users[raw]);
  } else {
    // 新規 → ニックネーム登録ステップへ
    document.getElementById("reg-student-id-label").textContent = raw;
    document.getElementById("inp-student-id-hidden").value = raw;
    document.getElementById("inp-nickname").value = "";
    document.getElementById("reg-err").style.display = "none";
    showStep("step-register");
    document.getElementById("inp-nickname").focus();
  }
}

function showIdErr(msg) {
  const el = document.getElementById("id-err");
  el.textContent = "✕ " + msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 4000);
}

// ============================================================
//  STEP 2 — ニックネーム登録
// ============================================================
function submitRegister() {
  const studentId = document.getElementById("inp-student-id-hidden").value;
  const nickname  = document.getElementById("inp-nickname").value.trim();
  const errEl     = document.getElementById("reg-err");
  errEl.style.display = "none";

  if (!nickname) { showRegErr("ニックネームを入力してください"); return; }
  if (nickname.length > 16) { showRegErr("16文字以内で入力してください"); return; }

  const users = getUsers();
  const palette = AVATAR_COLORS[Object.keys(users).length % AVATAR_COLORS.length];

  const userEntry = { nickname, color: palette.color, text: palette.text };
  users[studentId] = userEntry;
  saveUsers(users);

  createSession(studentId, userEntry);
}

function showRegErr(msg) {
  const el = document.getElementById("reg-err");
  el.textContent = "✕ " + msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 4000);
}

function backToId() {
  showStep("step-id");
}

// ============================================================
//  セッション生成 → リダイレクト
// ============================================================
function createSession(studentId, userEntry) {
  const session = {
    student_id:   studentId,
    nickname:     userEntry.nickname,
    color:        userEntry.color,
    text_color:   userEntry.text,
    logged_in_at: new Date().toISOString(),
  };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
  location.href = REDIRECT_PATH;
}

// ── Enter キー対応 ───────────────────────────────────────────
document.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const step1 = document.getElementById("step-id");
  const step2 = document.getElementById("step-register");
  if (step1 && step1.style.display !== "none") submitId();
  else if (step2 && step2.style.display !== "none") submitRegister();
});
