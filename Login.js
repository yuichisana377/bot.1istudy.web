// ============================================================
//  Login.js — ログインページ専用スクリプト
//
//  ★ ログインはDiscordのみ（学籍番号＋パスワードでのログインは廃止）。
//    サーバー側（bot.py）でも、ログイン先のDiscordサーバー
//    （guild_id=1509880344806162544）のメンバーでなければログインを
//    拒否する。
//
//  フロー:
//    1. localStorage に有効なセッション（session_token付き）があれば自動ログイン
//    2. loginWithDiscord() → Discordの認可画面へ → 認可後サーバー側で分岐：
//       ・登録済み → session_tokenをクエリパラメータで受け取りそのままログイン
//       ・初めて／未登録 → ?discord_reg=<dtoken> 付きで戻ってきて登録ステップへ
//
//  遷移先:
//    sessionStorage に 'post_login_redirect' が保存されていれば
//    ログイン後にそのページへ戻る（例: Cardmaker.htmlから来た場合）。
//    無ければ通常通り REDIRECT_PATH（StudyLog.html）へ遷移する。
// ============================================================

const API_BASE      = "/api/";
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
  const params = new URLSearchParams(location.search);

  // ★ 既にDiscordログイン登録済みの場合：APIサーバー（別ドメイン）側では
  //   localStorageを共有できないため、session_tokenをURLのクエリパラメータで
  //   受け取り、ここ（フロントエンドのドメイン上）でlocalStorageに保存する。
  const discordToken = params.get("discord_session_token");
  if (discordToken) {
    const studentId = params.get("student_id") || "";
    const nickname  = params.get("nickname") || studentId;
    const palette   = paletteFor(studentId);
    saveSession({ id: studentId, nickname }, discordToken, palette);
    history.replaceState(null, "", location.pathname); // URLからトークンを消す
    location.href = getRedirectTarget();
    return;
  }

  // ★ Discordログインで初回登録が必要な場合、/discord_login_start →
  //   Discord認可 → コールバック経由で ?discord_reg=<dtoken> 付きで
  //   このページに戻ってくる。最優先でそちらを処理する。
  const dtoken = params.get("discord_reg");
  if (dtoken) {
    openDiscordRegisterStep(dtoken);
    return;
  }

  // 自動ログイン（localStorage に session_token 付きの保存済みセッションがある場合のみ）
  const saved = getSession();
  if (saved && saved.session_token) {
    autoLogin(saved);
    return;
  }
  localStorage.removeItem(SESSION_KEY); // session_tokenの無い旧形式セッションは破棄
  showStep("step-id");
});

// ============================================================
//  セッション
// ============================================================
function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

// user: {id, nickname}, sessionToken: ログイン成功時に発行された session_token
function saveSession(user, sessionToken, colorPalette) {
  const session = {
    student_id:    user.id,
    nickname:      user.nickname,
    color:         colorPalette.color,
    text_color:    colorPalette.text,
    session_token: sessionToken,
    logged_in_at:  new Date().toISOString(),
  };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
  return session;
}

// ID（文字列）から常に同じ色を選ぶ（新規登録時のインデックスに依存しないように）
function paletteFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

// ── 遷移先の決定 ─────────────────────────────────────────────
// Cardmaker.html など他ページから「未ログイン警告→ログインへ」で来た場合、
// sessionStorage に戻り先が記憶されているのでそちらを優先する。
function getRedirectTarget() {
  const savedRedirect = sessionStorage.getItem('post_login_redirect');
  if (savedRedirect) {
    sessionStorage.removeItem('post_login_redirect');
    return savedRedirect;
  }
  return REDIRECT_PATH;
}

// ── 自動ログイン ─────────────────────────────────────────────
// ★ session_token の有効性はサーバー側でしか判定できない（改ざん・期限切れ等）ので、
//   軽いAPI（get_users）を叩いて通信自体が生きているかだけ確認し、
//   トークンの正当性チェック自体は StudyLog.html 側の各APIコールに任せる
//  （そちらで not_logged_in が返ってくれば自動的にログイン画面へ戻される）。
async function autoLogin(session) {
  showStep("step-loading");
  setLoadingMsg("ログイン情報を確認中…");
  location.href = getRedirectTarget();
}

// ============================================================
//  API
// ============================================================
// ── Discordログイン関連 ──────────────────────────────────
async function fetchDiscordRegInfo(dtoken) {
  const res = await fetch(
    `${API_BASE}discord_reg_info?dtoken=${encodeURIComponent(dtoken)}`,
    { headers: { "Content-Type": "application/json" } }
  );
  return res.json(); // { ok:true, discord_username } or { ok:false, error:"reg_token_invalid" }
}

async function completeDiscordRegistration(dtoken, studentId, nickname) {
  const res = await fetch(`${API_BASE}discord_complete_registration`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      guild_id: GUILD_ID, dtoken,
      student_id: studentId, nickname,
    }),
  });
  return res.json(); // { ok:true, session_token, student:{id,nickname} } or { ok:false, error }
}

// ============================================================
//  ステップ切り替え
// ============================================================
function showStep(id) {
  document.querySelectorAll(".login-step").forEach(el => {
    el.style.display = el.id === id ? "" : "none";
  });
  if (id === "step-discord-reg") {
    setTimeout(() => document.getElementById("inp-discord-student-id")?.focus(), 60);
  }
}

function setLoadingMsg(msg) {
  const el = document.getElementById("loading-msg");
  if (el) el.textContent = msg;
}

function backToId() {
  document.getElementById("discord-reg-err").style.display = "none";
  showStep("step-id");
}

// ============================================================
//  Discordログイン
//  ─────────────────────────────
//  1. loginWithDiscord() でDiscordの認可画面へ移動
//  2. 認可後、サーバー側で以下のいずれかに分岐する：
//     ・既にDiscordログイン登録済み → そのままセッションが発行され、
//       StudyLog.htmlへ自動遷移する（このページには戻ってこない）
//     ・初めて／未登録 → ?discord_reg=<dtoken> 付きでこのページに戻り、
//       openDiscordRegisterStep() が呼ばれる
//     ・対象サーバーのメンバーでない → サーバー側がエラーページを表示する
//       （このページには戻ってこない）
// ============================================================
function loginWithDiscord() {
  location.href = `${API_BASE}discord_login_start?guild_id=${GUILD_ID}`;
}

async function openDiscordRegisterStep(dtoken) {
  document.getElementById("inp-dtoken").value = dtoken;
  document.getElementById("discord-reg-err").style.display = "none";

  showStep("step-discord-reg");

  try {
    const info = await fetchDiscordRegInfo(dtoken);
    if (info.ok && info.discord_username) {
      // Discordの表示名をニックネームの初期値として提案する（そのまま使うかは本人の自由）
      const nickEl = document.getElementById("inp-discord-nickname");
      if (nickEl && !nickEl.value) nickEl.value = info.discord_username.slice(0, 16);
    } else if (!info.ok) {
      showDiscordRegErr("このリンクの有効期限が切れています。もう一度「Discordでログイン」からやり直してください。");
    }
  } catch {
    // 参考情報の取得に失敗しても、登録フォーム自体は使えるので致命的ではない
  }

  // URLに残った ?discord_reg=... を消しておく（再読み込みで壊れないように）
  history.replaceState(null, "", location.pathname);
}

async function submitDiscordRegister() {
  const dtoken   = document.getElementById("inp-dtoken").value;
  const id       = document.getElementById("inp-discord-student-id").value.trim().toUpperCase();
  const nickname = document.getElementById("inp-discord-nickname").value.trim();
  const btnEl    = document.getElementById("btn-discord-reg-submit");

  if (!validateDiscordId(id)) return;

  setBtn(btnEl, true, "登録中…");

  try {
    const result = await completeDiscordRegistration(dtoken, id, nickname);

    if (result.ok) {
      const palette = paletteFor(result.student.id);
      saveSession(result.student, result.session_token, palette);
      location.href = getRedirectTarget();
      return;
    }

    if (result.error === "nickname_required") {
      showDiscordRegErr("ニックネームを入力してください");
      return;
    }
    if (result.error === "reg_token_invalid") {
      showDiscordRegErr("このリンクの有効期限が切れています。もう一度「Discordでログイン」からやり直してください。");
      return;
    }
    showDiscordRegErr("登録に失敗しました。時間をおいて再試行してください。");
  } catch {
    showDiscordRegErr("サーバーに接続できません。時間をおいて再試行してください。");
  } finally {
    setBtn(btnEl, false, "登録してログイン " + Icons.html('check', {size:15}));
  }
}

function validateDiscordId(raw) {
  if (!raw) { showDiscordRegErr("学籍番号を入力してください"); return false; }
  if (!/^[A-Z0-9]{2,20}$/.test(raw)) {
    showDiscordRegErr("半角英数字で入力してください（例: 1I001）");
    return false;
  }
  return true;
}

function showDiscordRegErr(msg) {
  const el = document.getElementById("discord-reg-err");
  el.innerHTML     = Icons.html('close', {size:14}) + " " + escHtml(msg);
  el.style.display = "block";
}

// ============================================================
//  ユーティリティ
// ============================================================
// ★ labelは常にこのファイル内の固定文字列（呼び出し側にユーザー入力を
//   渡す箇所は無い）なので、innerHTMLで組み立てても安全。
function setBtn(el, disabled, label) {
  if (!el) return;
  el.disabled     = disabled;
  el.innerHTML    = label;
}

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// Enter キー
document.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const active = [...document.querySelectorAll(".login-step")]
    .find(el => el.style.display !== "none");
  if (!active) return;
  if (active.id === "step-discord-reg") submitDiscordRegister();
});

// ★ ここまでエラーなく実行できた＝JSが生きている合図として、<body>先頭の
//   「読み込み中…」代替表示（js-fail-fallback、Icons.js参照）を消す。
hideLoadingFallback();
