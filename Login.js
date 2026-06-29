// ============================================================
//  Login.js — ログインページ専用スクリプト
//  Login.html から読み込む
//
//  認証フロー:
//    1. SAMPLE_USERS から student_id を選択
//    2. password を照合（サンプルはすべて "1234"）
//    3. 認証成功 → localStorage に SESSION_KEY で保存
//    4. StudyLog.html へリダイレクト
//
//  StudyLog.js 側での使い方:
//    const session = JSON.parse(localStorage.getItem("sl_session") || "null");
//    if (!session) location.href = "/Login.html";
//    const STUDENT = { id: session.student_id, nickname: session.nickname };
// ============================================================

const SESSION_KEY   = "sl_session";
const REDIRECT_PATH = "/StudyLog.html";

// ── サンプルユーザー定義 ─────────────────────────────────
// 実運用では API から取得する想定。password は必ずサーバーサイドで検証すること。
const SAMPLE_USERS = [
  { student_id: "1I001", nickname: "Yuki",   password: "1234", color: "#dbeafe", text: "#1e40af" },
  { student_id: "1I002", nickname: "Hana",   password: "1234", color: "#dcfce7", text: "#166534" },
  { student_id: "1I003", nickname: "Ren",    password: "1234", color: "#fce7f3", text: "#9d174d" },
  { student_id: "1I004", nickname: "Sora",   password: "1234", color: "#ffedd5", text: "#9a3412" },
  { student_id: "1I005", nickname: "Koharu", password: "1234", color: "#fef9c3", text: "#854d0e" },
  { student_id: "1I006", nickname: "Kai",    password: "1234", color: "#ede9fe", text: "#6d28d9" },
];

// ── 起動 ────────────────────────────────────────────────
window.addEventListener("load", () => {
  // すでにログイン済みならリダイレクト
  if (getSession()) {
    location.href = REDIRECT_PATH;
    return;
  }
  buildSelect();
  buildSampleGrid();
});

// ── セッション取得 ───────────────────────────────────────
function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch(e) {
    return null;
  }
}

// ── プルダウン生成 ───────────────────────────────────────
function buildSelect() {
  const sel = document.getElementById("sel-user");
  SAMPLE_USERS.forEach(u => {
    const opt = document.createElement("option");
    opt.value       = u.student_id;
    opt.textContent = u.nickname + "（" + u.student_id + "）";
    sel.appendChild(opt);
  });
}

// ── サンプルカードグリッド生成 ───────────────────────────
function buildSampleGrid() {
  const grid = document.getElementById("sample-grid");
  SAMPLE_USERS.forEach(u => {
    const initials = u.nickname.slice(0, 2).toUpperCase();

    const card = document.createElement("div");
    card.className = "sample-card";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", u.nickname + " でログイン");
    card.innerHTML =
      '<div class="sample-avatar" style="background:' + u.color + ';color:' + u.text + '">' + initials + '</div>' +
      '<div class="sample-info">' +
        '<div class="sample-nickname">' + esc(u.nickname) + '</div>' +
        '<div class="sample-id">' + esc(u.student_id) + '</div>' +
      '</div>';

    card.addEventListener("click", () => quickLogin(u.student_id));
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") quickLogin(u.student_id);
    });

    grid.appendChild(card);
  });
}

// ── カードクリックで即ログイン ───────────────────────────
function quickLogin(student_id) {
  document.getElementById("sel-user").value    = student_id;
  document.getElementById("inp-password").value = "1234";
  doLogin();
}

// ── ログイン実行 ─────────────────────────────────────────
function doLogin() {
  const studentId = document.getElementById("sel-user").value;
  const password  = document.getElementById("inp-password").value;
  const errEl     = document.getElementById("login-err");
  const btn       = document.querySelector(".login-btn");

  errEl.style.display = "none";

  if (!studentId) { showErr("アカウントを選択してください"); return; }
  if (!password)  { showErr("パスワードを入力してください"); return; }

  btn.disabled  = true;
  btn.innerHTML = '<span class="login-spinner"></span>確認中…';

  // サンプルなので setTimeout で疑似 async
  setTimeout(() => {
    const user = SAMPLE_USERS.find(u => u.student_id === studentId);

    if (!user || user.password !== password) {
      btn.disabled    = false;
      btn.textContent = "ログイン";
      showErr("student_id またはパスワードが正しくありません");
      return;
    }

    const session = {
      student_id:   user.student_id,
      nickname:     user.nickname,
      color:        user.color,
      text_color:   user.text,
      logged_in_at: new Date().toISOString(),
    };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch(e) {}

    location.href = REDIRECT_PATH;
  }, 600);
}

// ── パスワード表示切替 ───────────────────────────────────
function togglePw() {
  const inp = document.getElementById("inp-password");
  inp.type  = inp.type === "password" ? "text" : "password";
}

// ── エラー表示 ───────────────────────────────────────────
function showErr(msg) {
  const el = document.getElementById("login-err");
  el.textContent   = "✕ " + msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 4000);
}

// ── ユーティリティ ───────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
