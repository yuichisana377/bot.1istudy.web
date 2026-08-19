// ============================================================
//  Login.js — ログインページ専用スクリプト
//
//  フロー:
//    1. localStorage に有効なセッション（session_token付き）があれば自動ログイン
//    2. 学籍番号 + パスワードを入力 → POST /login
//       - 成功           → セッション保存 → 遷移先へ
//       - user_not_found → 新規登録ステップへ（ニックネーム＋パスワード設定）
//       - password_not_set → 登録ステップへ（既存アカウントのパスワード初回設定。
//                             ニックネームは既存のものを表示するだけで変更不可）
//       - wrong_password → エラー表示のみ
//    3. 登録ステップ完了後、あらためて /login を呼んでセッショントークンを取得する
//
//  遷移先:
//    sessionStorage に 'post_login_redirect' が保存されていれば
//    ログイン後にそのページへ戻る（例: Cardmaker.htmlから来た場合）。
//    無ければ通常通り REDIRECT_PATH（StudyLog.html）へ遷移する。
// ============================================================

const API_BASE      = "https://chiro-ubuntuserver.tail1130ba.ts.net/";
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

// user: {id, nickname}, sessionToken: /loginが返した session_token
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
// ★ 以前はここで /get_users を呼び、全生徒の学籍番号・ニックネーム一覧を
//   丸ごと取得していた（ログイン画面を開いてIDを1件確認するだけなのに、
//   認証なしで名簿全体がブラウザに渡ってしまっていた）。
//   /check_student は問い合わせた1件についてだけ最小限の情報を返す。
async function checkStudent(id) {
  const res = await fetch(
    `${API_BASE}/check_student?guild_id=${GUILD_ID}&id=${encodeURIComponent(id)}`,
    { headers: { "Content-Type": "application/json" } }
  );
  const data = await res.json();
  if (!data.ok) throw new Error("check_student_failed");
  return data; // { ok:true, exists:boolean, nickname?, has_password? }
}

async function loginRequest(id, password) {
  const res = await fetch(`${API_BASE}/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guild_id: GUILD_ID, id, password }),
  });
  return res.json(); // { ok:true, session_token, student:{id,nickname} } または { ok:false, error }
}

async function addUser(id, nickname, password) {
  const res = await fetch(`${API_BASE}/add_user`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      guild_id:   GUILD_ID,
      id,
      nickname,
      password,
      created_at: new Date().toISOString().slice(0, 10),
    }),
  });
  return res.json(); // { ok: true } or { ok: false, error: "already_exists" | ... }
}

async function setPasswordRequest(id, password) {
  const res = await fetch(`${API_BASE}/set_password`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guild_id: GUILD_ID, id, password }),
  });
  return res.json(); // { ok: true } or { ok: false, error: "already_set" | ... }
}

async function requestPasswordResetCode(id) {
  const res = await fetch(`${API_BASE}/request_password_reset_code`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guild_id: GUILD_ID, id }),
  });
  return res.json(); // { ok: true } or { ok: false, error: "user_not_found" | "not_linked" | "too_soon" | ... }
}

async function confirmPasswordReset(id, code, newPassword) {
  const res = await fetch(`${API_BASE}/confirm_password_reset`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guild_id: GUILD_ID, id, code, new_password: newPassword }),
  });
  return res.json(); // { ok: true } or { ok: false, error: "wrong_code" | "code_expired" | ... }
}

// ── Discordログイン関連 ──────────────────────────────────
async function fetchDiscordRegInfo(dtoken) {
  const res = await fetch(
    `${API_BASE}/discord_reg_info?dtoken=${encodeURIComponent(dtoken)}`,
    { headers: { "Content-Type": "application/json" } }
  );
  return res.json(); // { ok:true, discord_username } or { ok:false, error:"reg_token_invalid" }
}

async function completeDiscordRegistration(dtoken, studentId, nickname) {
  const res = await fetch(`${API_BASE}/discord_complete_registration`, {
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
  // フォーカス制御
  if (id === "step-id") {
    setTimeout(() => document.getElementById("inp-student-id")?.focus(), 60);
  }
  if (id === "step-register") {
    const mode = document.getElementById("reg-mode").value;
    setTimeout(() => document.getElementById(mode === "new" ? "inp-nickname" : "inp-reg-password")?.focus(), 60);
  }
  if (id === "step-forgot") {
    setTimeout(() => document.getElementById("inp-forgot-id")?.focus(), 60);
  }
  if (id === "step-discord-reg") {
    setTimeout(() => document.getElementById("inp-discord-student-id")?.focus(), 60);
  }
}

function setLoadingMsg(msg) {
  const el = document.getElementById("loading-msg");
  if (el) el.textContent = msg;
}

// ============================================================
//  STEP 1 — 学籍番号＋パスワード入力
// ============================================================
async function submitId() {
  const raw      = document.getElementById("inp-student-id").value.trim().toUpperCase();
  const password = document.getElementById("inp-password").value;
  const btnEl    = document.getElementById("btn-login");

  if (!validateId(raw)) return;

  if (!password) {
    // ★ パスワード未入力でも、まだ登録されていない学籍番号（＝初めての場合）なら
    //   登録前でパスワードを持っていないのは当然なので、そのまま新規登録画面へ進める。
    //   既に登録済みの学籍番号の場合は、これまで通りパスワード入力を求める。
    setBtn(btnEl, true, "確認中…");
    try {
      const check = await checkStudent(raw);
      if (!check.exists) {
        openRegisterStep(raw, "new");
        return;
      }
    } catch {
      // 確認に失敗した場合は、判定できないので通常通りエラーにする
    } finally {
      setBtn(btnEl, false, "ログイン →");
    }
    showIdErr("パスワードを入力してください");
    return;
  }

  setBtn(btnEl, true, "確認中…");

  try {
    const result = await loginRequest(raw, password);

    if (result.ok) {
      // ログイン成功
      const palette = paletteFor(result.student.id);
      saveSession(result.student, result.session_token, palette);
      location.href = getRedirectTarget();
      return;
    }

    if (result.error === "user_not_found") {
      // ★ 未登録 → 新規登録ステップへ（パスワードがまだ無い＝登録画面へ）
      openRegisterStep(raw, "new", password);
      return;
    }
    if (result.error === "password_not_set") {
      // ★ 既存アカウントだがパスワード未設定 → パスワード設定のため登録画面へ
      openRegisterStep(raw, "setpw", password);
      return;
    }
    if (result.error === "wrong_password") {
      showIdErr("パスワードが正しくありません");
      return;
    }
    showIdErr("ログインに失敗しました。時間をおいて再試行してください。");
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

// ── 登録ステップを開く（新規登録 or 既存アカウントのパスワード初回設定）──
async function openRegisterStep(id, mode, prefillPassword) {
  document.getElementById("inp-student-id-hidden").value = id;
  document.getElementById("reg-mode").value               = mode;
  document.getElementById("reg-err").style.display        = "none";
  // ★ 新規登録・既存アカウントのパスワード初回設定、どちらの場合も
  //   STEP1で入力したパスワードは引き継がず空欄にする。
  document.getElementById("inp-reg-password").value       = "";
  document.getElementById("inp-reg-password2").value      = "";

  const nicknameField = document.getElementById("reg-nickname-field");

  if (mode === "new") {
    document.getElementById("reg-title").innerHTML = "新規登録 " + Icons.html('wave', {size:20});
    document.getElementById("reg-desc").innerHTML =
      `<strong id="reg-id-label">${escHtml(id)}</strong> はまだ登録されていません。<br>` +
      `呼ばれたいニックネームとパスワードを入力して登録してください。<br>` +
      `<span class="login-reg-note">※ 本名は禁止・公開されます</span>`;
    nicknameField.style.display    = "";
    document.getElementById("inp-nickname").value = "";
  } else {
    // setpw: 既存アカウントのパスワードが未設定
    nicknameField.style.display = "none";
    let nicknameLabel = id;
    try {
      const check = await checkStudent(id);
      if (check.exists && check.nickname) nicknameLabel = check.nickname;
    } catch {}
    document.getElementById("reg-title").innerHTML = "パスワード設定 " + Icons.html('key', {size:20});
    document.getElementById("reg-desc").innerHTML =
      `<strong id="reg-id-label">${escHtml(nicknameLabel)}（${escHtml(id)}）</strong> はまだパスワードが設定されていません。<br>` +
      `今後ログインに使うパスワードを設定してください。`;
  }

  showStep("step-register");
}

// ============================================================
//  STEP 2 — 新規登録 ／ パスワード設定
// ============================================================
async function submitRegister() {
  const id       = document.getElementById("inp-student-id-hidden").value;
  const mode     = document.getElementById("reg-mode").value; // "new" | "setpw"
  const nickname = document.getElementById("inp-nickname").value.trim();
  const password  = document.getElementById("inp-reg-password").value;
  const password2 = document.getElementById("inp-reg-password2").value;
  const btnEl    = document.getElementById("btn-register");

  if (mode === "new" && !validateNickname(nickname)) return;
  if (!validatePassword(password, password2)) return;

  setBtn(btnEl, true, mode === "new" ? "登録中…" : "設定中…");

  try {
    let result;
    if (mode === "new") {
      result = await addUser(id, nickname, password);
    } else {
      result = await setPasswordRequest(id, password);
    }

    if (!result.ok) {
      if (result.error === "already_exists") {
        showRegErr("この学籍番号はすでに登録されています。ログイン画面に戻ってください。");
      } else if (result.error === "already_set") {
        showRegErr("このアカウントはすでにパスワードが設定されています。ログイン画面からログインしてください。");
      } else {
        showRegErr("処理に失敗しました。時間をおいて再試行してください。");
      }
      return;
    }

    // 登録／パスワード設定に成功 → 続けてログインしてセッショントークンを取得する
    const loginResult = await loginRequest(id, password);
    if (!loginResult.ok) {
      showRegErr("設定は完了しましたが、自動ログインに失敗しました。ログイン画面から入り直してください。");
      backToId();
      return;
    }
    const palette = paletteFor(loginResult.student.id);
    saveSession(loginResult.student, loginResult.session_token, palette);
    location.href = getRedirectTarget();
  } catch {
    showRegErr("サーバーに接続できません。時間をおいて再試行してください。");
  } finally {
    setBtn(btnEl, false, "登録してログイン " + Icons.html('check', {size:15}));
  }
}

function validateNickname(nickname) {
  if (!nickname)          { showRegErr("ニックネームを入力してください"); return false; }
  if (nickname.length > 16) { showRegErr("16文字以内で入力してください"); return false; }
  return true;
}

function validatePassword(password, password2, errFn) {
  const show = errFn || showRegErr;
  if (!password || password.length < 4) { show("パスワードは4文字以上で入力してください"); return false; }
  if (password !== password2) { show("パスワード（確認）が一致しません"); return false; }
  return true;
}

function backToId() {
  document.getElementById("reg-err").style.display = "none";
  showStep("step-id");
}

// ============================================================
//  STEP 3 — パスワードを忘れた場合の再設定
// ============================================================
function openForgotStep() {
  document.getElementById("forgot-err").style.display        = "none";
  document.getElementById("forgot-pw-fields").style.display   = "none";
  document.getElementById("btn-forgot-send").disabled         = false;
  document.getElementById("btn-forgot-send").textContent      = "Discordに確認コードを送る";
  document.getElementById("inp-forgot-code").value            = "";
  document.getElementById("inp-forgot-newpw").value           = "";
  document.getElementById("inp-forgot-newpw2").value          = "";
  // 既にSTEP1で入力済みの学籍番号があれば引き継ぐ
  const idAlready = document.getElementById("inp-student-id").value.trim().toUpperCase();
  document.getElementById("inp-forgot-id").value = idAlready;
  showStep("step-forgot");
}

async function submitForgotSendCode() {
  const id    = document.getElementById("inp-forgot-id").value.trim().toUpperCase();
  const btnEl = document.getElementById("btn-forgot-send");

  if (!validateForgotId(id)) return;

  setBtn(btnEl, true, "送信中…");
  try {
    const result = await requestPasswordResetCode(id);
    if (result.ok) {
      document.getElementById("forgot-pw-fields").style.display = "";
      showForgotOk(Icons.html('check', {size:14}) + " Discordに確認コードを送信しました（10分間有効）");
      setTimeout(() => document.getElementById("inp-forgot-code")?.focus(), 60);
    } else if (result.error === "user_not_found") {
      showForgotErr("その学籍番号は登録されていません");
    } else if (result.error === "not_linked") {
      showForgotErr("Discordと連携されていません。Discordで /id連携 コマンドを実行してから、もう一度お試しください。");
    } else if (result.error === "too_soon") {
      showForgotErr("少し時間をおいてから再度お試しください（あと約" + (result.retry_after_sec || 60) + "秒）");
    } else {
      showForgotErr("送信に失敗しました。時間をおいて再試行してください。");
    }
  } catch {
    showForgotErr("サーバーに接続できません。時間をおいて再試行してください。");
  } finally {
    setBtn(btnEl, false, "Discordに確認コードを送る");
  }
}

async function submitForgotConfirm() {
  const id     = document.getElementById("inp-forgot-id").value.trim().toUpperCase();
  const code   = document.getElementById("inp-forgot-code").value.trim();
  const newPw  = document.getElementById("inp-forgot-newpw").value;
  const newPw2 = document.getElementById("inp-forgot-newpw2").value;
  const btnEl  = document.getElementById("btn-forgot-confirm");

  if (!/^[0-9]{6}$/.test(code)) { showForgotErr("確認コード（6桁の数字）を入力してください"); return; }
  if (!validatePassword(newPw, newPw2, showForgotErr)) return;

  setBtn(btnEl, true, "再設定中…");
  try {
    const result = await confirmPasswordReset(id, code, newPw);
    if (!result.ok) {
      if (result.error === "wrong_code")            showForgotErr("確認コードが正しくありません");
      else if (result.error === "code_expired")     showForgotErr("確認コードの有効期限が切れました。もう一度送信してください。");
      else if (result.error === "code_not_requested") showForgotErr("先に確認コードを送信してください");
      else                                            showForgotErr("再設定に失敗しました。時間をおいて再試行してください。");
      return;
    }
    // 再設定成功 → 続けてログインしてセッショントークンを取得する
    const loginResult = await loginRequest(id, newPw);
    if (!loginResult.ok) {
      showForgotOk(Icons.html('check', {size:14}) + " パスワードを再設定しました。ログイン画面からお入りください。");
      setTimeout(backToId, 1500);
      return;
    }
    const palette = paletteFor(loginResult.student.id);
    saveSession(loginResult.student, loginResult.session_token, palette);
    location.href = getRedirectTarget();
  } catch {
    showForgotErr("サーバーに接続できません。時間をおいて再試行してください。");
  } finally {
    setBtn(btnEl, false, "パスワードを再設定してログイン " + Icons.html('check', {size:15}));
  }
}

function validateForgotId(raw) {
  if (!raw) { showForgotErr("学籍番号を入力してください"); return false; }
  if (!/^[A-Z0-9]{2,20}$/.test(raw)) {
    showForgotErr("半角英数字で入力してください（例: 1I001）");
    return false;
  }
  return true;
}

function showForgotErr(msg) {
  const el = document.getElementById("forgot-err");
  el.innerHTML     = Icons.html('close', {size:14}) + " " + escHtml(msg);
  el.style.color   = "";
  el.style.display = "block";
}

function showForgotOk(msg) {
  const el = document.getElementById("forgot-err");
  el.innerHTML     = msg;
  el.style.color   = "#16a34a";
  el.style.display = "block";
}

// ============================================================
//  STEP 4 — Discordログイン
//  ─────────────────────────────
//  1. loginWithDiscord() でDiscordの認可画面へ移動
//  2. 認可後、サーバー側で以下のいずれかに分岐する：
//     ・既にDiscordログイン登録済み → そのままセッションが発行され、
//       StudyLog.htmlへ自動遷移する（このページには戻ってこない）
//     ・初めて／未登録 → ?discord_reg=<dtoken> 付きでこのページに戻り、
//       openDiscordRegisterStep() が呼ばれる
// ============================================================
function loginWithDiscord() {
  location.href = `${API_BASE}/discord_login_start?guild_id=${GUILD_ID}`;
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

// 学籍番号の形式チェック（既存の validateId は id-err 側に出すため、ここでは discord-reg-err 用に別途用意）
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

function showIdErr(msg) {
  const el = document.getElementById("id-err");
  el.innerHTML     = Icons.html('close', {size:14}) + " " + escHtml(msg);
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 5000);
}

function showRegErr(msg) {
  const el = document.getElementById("reg-err");
  el.innerHTML     = Icons.html('close', {size:14}) + " " + escHtml(msg);
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
  if (active.id === "step-discord-reg") submitDiscordRegister();
});
