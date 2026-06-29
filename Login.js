// ============================================================
//  Login.js — ログインページ専用スクリプト
//
//  フロー:
//    1. localStorage に student_id があれば自動ログイン
//    2. 学籍番号を入力 → GET /get_users で照合
//       - 存在する → セッション保存 → StudyLog.html
//       - 存在しない → 新規登録ステップへ
//    3. 新規登録: 学籍番号 + ニックネーム → POST /add_user
//       → セッション保存 → StudyLog.html
// ============================================================

const API_BASE      = "https://python-bot-1istudy.onrender.com";
const GUILD_ID      = "1509880344806162544";
const SESSION_KEY   = "sl_session";
const REDIRECT_PATH = "/StudyLog.html";

// アバターカラーパレット（ユーザー数 % 8 で自動割り当て）
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
  // 自動ログイン（localStorage に保存済みセッションがある場合）
  const saved = getSession();
  if (saved) {
    autoLogin(saved);
    return;
  }
  showStep("step-id");
});

// ============================================================
//  セッション
// ============================================================
function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

function saveSession(user, colorPalette) {
  const session = {
    student_id:   user.id,
    nickname:     user.nickname,
    color:        colorPalette.color,
    text_color:   colorPalette.text,
    logged_in_at: new Date().toISOString(),
  };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
  return session;
}

// ── 自動ログイン ─────────────────────────────────────────────
async function autoLogin(session) {
  showStep("step-loading");
  setLoadingMsg("ログイン情報を確認中…");

  try {
    const users = await fetchUsers();
    const user  = users.find(u => u.id === session.student_id);
    if (user) {
      // ユーザーが引き続き users.json に存在 → そのまま遷移
      location.href = REDIRECT_PATH;
    } else {
      // users.json から削除されていた場合はセッションをクリア
      localStorage.removeItem(SESSION_KEY);
      showStep("step-id");
      showIdErr("セッションが無効になりました。再度ログインしてください。");
    }
  } catch {
    // サーバーエラーでも、既存セッションを信頼してそのまま遷移
    location.href = REDIRECT_PATH;
  }
}

// ============================================================
//  API
// ============================================================
async function fetchUsers() {
  const res = await fetch(
    `${API_BASE}/get_users?guild_id=${GUILD_ID}`,
    { headers: { "Content-Type": "application/json" } }
  );
  const data = await res.json();
  if (!data.ok) throw new Error("fetch_users_failed");
  return data.users || [];
}

async function addUser(id, nickname) {
  const res = await fetch(`${API_BASE}/add_user`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      guild_id:   GUILD_ID,
      id,
      nickname,
      created_at: new Date().toISOString().slice(0, 10),
    }),
  });
  return res.json(); // { ok: true } or { ok: false, error: "already_exists" }
}

// ============================================================
//  ステップ切り替え
// ============================================================
function showStep(id) {
  document.querySelectorAll(".login-step").forEach(el => {
    el.style.display = el.id === id ? "" : "none";
  });
  // フォーカス制御
  if (id === "step-id") {
    setTimeout(() => document.getElementById("inp-student-id")?.focus(), 60);
  }
  if (id === "step-register") {
    setTimeout(() => document.getElementById("inp-nickname")?.focus(), 60);
  }
}

function setLoadingMsg(msg) {
  const el = document.getElementById("loading-msg");
  if (el) el.textContent = msg;
}

// ============================================================
//  STEP 1 — 学籍番号入力
// ============================================================
async function submitId() {
  const raw   = document.getElementById("inp-student-id").value.trim().toUpperCase();
  const btnEl = document.getElementById("btn-login");

  if (!validateId(raw)) return;

  setBtn(btnEl, true, "確認中…");

  try {
    const users = await fetchUsers();
    const user  = users.find(u => u.id === raw);

    if (user) {
      // 既存ユーザー → ログイン
      const palette = AVATAR_COLORS[users.indexOf(user) % AVATAR_COLORS.length];
      saveSession(user, palette);
      location.href = REDIRECT_PATH;
    } else {
      // 未登録 → 新規登録ステップへ
      document.getElementById("reg-id-label").textContent    = raw;
      document.getElementById("inp-student-id-hidden").value = raw;
      document.getElementById("inp-nickname").value          = "";
      document.getElementById("reg-err").style.display       = "none";
      showStep("step-register");
    }
  } catch {
    showIdErr("サーバーに接続できません。時間をおいて再試行してください。");
  } finally {
    setBtn(btnEl, false, "ログイン →");
  }
}

function validateId(raw) {
  if (!raw) { showIdErr("学籍番号を入力してください"); return false; }
  if (!/^[A-Z0-9]{2,20}$/.test(raw)) {
    showIdErr("半角英数字で入力してください（例: 1I001）");
    return false;
  }
  return true;
}

// ============================================================
//  STEP 2 — 新規登録
// ============================================================
async function submitRegister() {
  const id       = document.getElementById("inp-student-id-hidden").value;
  const nickname = document.getElementById("inp-nickname").value.trim();
  const btnEl    = document.getElementById("btn-register");

  if (!validateNickname(nickname)) return;

  setBtn(btnEl, true, "登録中…");

  try {
    // 直前に重複チェック（二重登録防止）
    const users   = await fetchUsers();
    if (users.find(u => u.id === id)) {
      // 同じ端末の別タブなどで既に登録された場合
      const user    = users.find(u => u.id === id);
      const palette = AVATAR_COLORS[users.indexOf(user) % AVATAR_COLORS.length];
      saveSession(user, palette);
      location.href = REDIRECT_PATH;
      return;
    }

    const result = await addUser(id, nickname);

    if (result.ok) {
      // 登録成功 → 再取得してセッション作成
      const updated = await fetchUsers();
      const user    = updated.find(u => u.id === id) || { id, nickname };
      const palette = AVATAR_COLORS[(updated.length - 1) % AVATAR_COLORS.length];
      saveSession(user, palette);
      location.href = REDIRECT_PATH;
    } else if (result.error === "already_exists") {
      showRegErr("この学籍番号はすでに登録されています。ログイン画面に戻ってください。");
    } else {
      showRegErr("登録に失敗しました。時間をおいて再試行してください。");
    }
  } catch {
    showRegErr("サーバーに接続できません。時間をおいて再試行してください。");
  } finally {
    setBtn(btnEl, false, "登録してログイン ✓");
  }
}

function validateNickname(nickname) {
  if (!nickname)          { showRegErr("ニックネームを入力してください"); return false; }
  if (nickname.length > 16) { showRegErr("16文字以内で入力してください"); return false; }
  return true;
}

function backToId() {
  document.getElementById("reg-err").style.display = "none";
  showStep("step-id");
}

// ============================================================
//  ユーティリティ
// ============================================================
function setBtn(el, disabled, label) {
  if (!el) return;
  el.disabled     = disabled;
  el.textContent  = label;
}

function showIdErr(msg) {
  const el = document.getElementById("id-err");
  el.textContent   = "✕ " + msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 5000);
}

function showRegErr(msg) {
  const el = document.getElementById("reg-err");
  el.textContent   = "✕ " + msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 5000);
}

// Enter キー
document.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const active = [...document.querySelectorAll(".login-step")]
    .find(el => el.style.display !== "none");
  if (!active) return;
  if (active.id === "step-id")       submitId();
  if (active.id === "step-register") submitRegister();
});
