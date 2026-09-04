// ============================================================
//  Login.js — ログインページ専用スクリプト
//
//  ★ ログインはDiscordのみ（学籍番号＋パスワードでのログインは廃止）。
//    サーバー側（bot.py）でも、ログイン先のDiscordサーバーのメンバーで
//    なければログインを拒否する。
//
//  ★ 複数サーバー対応（追加）：以前は対象サーバーが1つに固定されていた
//    （GUILD_ID定数）が、複数のDiscordサーバーにBotを導入できるように
//    なったため、「どのサーバーか」はログイン時にサーバー側が
//    Discordのメンバーシップから自動判定する方式に変更した。
//    ・登録済みサーバーが1件だけ → 従来通りそのままログイン
//    ・登録済みサーバーが2件以上 → ?guild_choice=<token> で戻ってきて
//      選択画面（chooseGuildFromChoice）を表示し、選んだ1件を
//      /finalize_login にPOSTしてセッションを発行する
//    ・未登録（メンバーであるサーバーが複数）→ 学籍番号登録ステップの中に
//      サーバー選択欄を出す（openDiscordRegisterStep）
//    判定できたサーバーは saveSession() が localStorage の "current_guild"
//    （{guild_id, guild_name}）に保存し、他ページはこれを読んで動く
//    （GUILD_ID定数は廃止。getCurrentGuildId()参照）。
//
//  フロー:
//    1. localStorage に有効なセッション（session_token付き）があれば自動ログイン
//    2. loginWithDiscord() → Discordの認可画面へ → 認可後サーバー側で分岐：
//       ・登録済み(1件) → session_tokenをクエリパラメータで受け取りそのままログイン
//       ・登録済み(複数) → ?guild_choice=<token> 付きで戻ってきて選択ステップへ
//       ・初めて／未登録 → ?discord_reg=<dtoken> 付きで戻ってきて登録ステップへ
//
//  遷移先:
//    sessionStorage に 'post_login_redirect' が保存されていれば
//    ログイン後にそのページへ戻る（例: Cardmaker.htmlから来た場合）。
//    無ければ通常通り REDIRECT_PATH（StudyLog.html）へ遷移する。
// ============================================================

const API_BASE      = "/api/";
const SESSION_KEY   = "sl_session";
const GUILD_KEY      = "current_guild"; // ★ 追加：{guild_id, guild_name}。GUILD_ID定数の代わり。
const REDIRECT_PATH = "/StudyLog.html";

// ★ 複数サーバー対応：学籍番号登録ステップで選択中のguild_id（候補が1件なら自動選択）
let selectedRegGuildId = null;

// ★ /nameコマンドでサーバーごとに設定された表示名（現在current_guildが分かっていれば
//   その名前、まだ分からなければ"学生勉強会web"のまま）をロゴに反映する。
(function () {
  try {
    const g = JSON.parse(localStorage.getItem(GUILD_KEY));
    const name = (g && g.guild_name) ? g.guild_name : "学生勉強会web";
    const logoEl = document.querySelector(".login-logo-name");
    if (logoEl) logoEl.textContent = name;
  } catch (e) {}
})();

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
    const studentId  = params.get("student_id") || "";
    const nickname   = params.get("nickname") || studentId;
    const guildId    = params.get("guild_id") || "";
    const guildName  = params.get("guild_name") || "";
    const multiGuild = params.get("multi_guild") === "1";
    const palette    = paletteFor(studentId);
    saveSession({ id: studentId, nickname }, discordToken, palette, { id: guildId, name: guildName, multiGuild });
    history.replaceState(null, "", location.pathname); // URLからトークンを消す
    location.href = getRedirectTarget();
    return;
  }

  // ★ 複数サーバー対応：既に複数サーバーに登録済みのDiscordユーザーが
  //   ログインしようとした場合、?guild_choice=<token> 付きで戻ってくる。
  //   session_tokenはまだ発行されていない（候補一覧だけが入ったトークン）ので、
  //   選択画面を出し、選ばれた1件を/finalize_loginにPOSTして初めて発行させる。
  const guildChoiceToken = params.get("guild_choice");
  if (guildChoiceToken) {
    openGuildChoiceStep(guildChoiceToken);
    history.replaceState(null, "", location.pathname);
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
  // ★ 複数サーバー対応で発生した不具合の修正：session_tokenはあるが
  //   current_guild（サーバー情報）が無い「今日のデプロイより前からの
  //   ログイン済みセッション」だと、他ページの「GUILD_IDが無ければ
  //   Login.htmlへ」ガードに引っかかって戻ってきて、ここでまた
  //   autoLoginしてそのページへ送り返す…という無限リダイレクトループに
  //   陥っていた（current_guildを補う手段がここに無かったため）。
  //   session_tokenだけではどのサーバー向けか分からない以上、ここで
  //   ループさせず、諦めて新規ログイン（Discordの認可からやり直し）に
  //   倒すのが安全。
  const saved = getSession();
  const savedGuild = getCurrentGuild();
  if (saved && saved.session_token && savedGuild && savedGuild.guild_id) {
    autoLogin(saved);
    return;
  }
  localStorage.removeItem(SESSION_KEY); // session_tokenの無い旧形式セッション、current_guild不明のセッションは破棄

  // ★ 追加：DiscordのDM・チャンネルに貼られたCardMaker等のリンクをアプリ内ブラウザで
  //   開いた場合、そのアプリ内ブラウザは端末の普段のブラウザとはlocalStorageを共有しない
  //   別のブラウザ環境として扱われるため、保存済みセッションが見つからず（＝上のsaved判定に
  //   引っかからず）必ずここに来てしまう。ただしDiscordのアプリ内ブラウザを開けている時点で
  //   本人はDiscordにログイン済みであることが保証されているため、「Discordでログイン」
  //   ボタンを待たず自動的にOAuth認可へ進む（Discord側が過去に一度でも認可済みなら、
  //   認可確認すら出ずそのまま戻ってくることが多い＝体感上ほぼ自動ログインになる）。
  //   ・UA判定はDiscordクライアントのバージョンや将来の仕様変更で変わりうるベストエフォート。
  //     判定できない場合は従来通りボタンを表示するだけなので、誤判定しても実害はない。
  //   ・「サーバーコードをお持ちの方はこちら」等の代替導線を必要とする少数のケースのために、
  //     ボタン自体は消さず、画面はそのまま出したうえで自動的に遷移させる形にしている。
  if (isDiscordInAppBrowser()) {
    loginWithDiscord();
  }
  showStep("step-id");
});

// ============================================================
//  セッション
// ============================================================
function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

function getCurrentGuild() {
  try { return JSON.parse(localStorage.getItem(GUILD_KEY)); } catch { return null; }
}

// user: {id, nickname}, sessionToken: ログイン成功時に発行された session_token
// guild: {id, name, multiGuild}（★ 複数サーバー対応：省略時は現在のcurrent_guildを維持する。
//   multiGuildは「Botが導入されている複数のサーバーに実際に参加しているか」で、
//   ドロワーの「サーバーを切り替える」を出すかどうかの判定に使う＝ユーザーの
//   明示的な要望で、単一サーバーの人には出さない）
function saveSession(user, sessionToken, colorPalette, guild) {
  const session = {
    student_id:    user.id,
    nickname:      user.nickname,
    color:         colorPalette.color,
    text_color:    colorPalette.text,
    session_token: sessionToken,
    logged_in_at:  new Date().toISOString(),
  };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
  if (guild && guild.id) {
    try {
      localStorage.setItem(GUILD_KEY, JSON.stringify({
        guild_id: guild.id, guild_name: guild.name || "", multi_guild: !!guild.multiGuild,
      }));
    } catch {}
  }
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

async function completeDiscordRegistration(dtoken, guildId, studentId, nickname) {
  const res = await fetch(`${API_BASE}discord_complete_registration`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      guild_id: guildId, dtoken,
      student_id: studentId, nickname,
    }),
  });
  return res.json(); // { ok:true, session_token, student:{id,nickname} } or { ok:false, error }
}

// ★ 複数サーバー対応：/finalize_login。guild_choiceトークン＋選んだguild_idを
//   送り、その場でセッションを発行してもらう（GETリダイレクトのURLに
//   session_tokenを載せない設計にするため、ここだけPOSTで完結させる）。
async function finalizeLogin(token, guildId) {
  const res = await fetch(`${API_BASE}finalize_login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, guild_id: guildId }),
  });
  return res.json(); // { ok:true, session_token, student, guild_id, guild_name } or { ok:false, error }
}

// ★ 複数サーバー対応：サーバーコード（招待コード）でこの端末のサーバーだけを設定する。
//   ログインはしない（session_tokenは発行されない）。
async function resolveGuildInviteCode(code) {
  const res = await fetch(`${API_BASE}resolve_guild_invite_code?code=${encodeURIComponent(code)}`);
  return res.json(); // { ok:true, guild_id, guild_name } or { ok:false, error }
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
  if (id === "step-guild-code") {
    setTimeout(() => document.getElementById("inp-guild-code")?.focus(), 60);
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

// ★ 追加：Discordのアプリ内ブラウザ（DM・チャンネルのリンクをタップして開いた場合）
//   かどうかをUser-Agentから判定する。iOS/Android版DiscordのUAには"Discord/"という
//   トークンが含まれる（ベストエフォート。将来のDiscordアプリの更新でUAが変わった
//   場合は判定できなくなるだけで、その場合も従来通りボタン操作でログインできる）。
function isDiscordInAppBrowser() {
  return /\bDiscord\//i.test(navigator.userAgent || "");
}

// ============================================================
//  Discordログイン
//  ─────────────────────────────
//  1. loginWithDiscord() でDiscordの認可画面へ移動
//  2. 認可後、サーバー側で以下のいずれかに分岐する：
//     ・既にDiscordログイン登録済み(1件) → そのままセッションが発行され、
//       StudyLog.htmlへ自動遷移する（このページには戻ってこない）
//     ・既にDiscordログイン登録済み(複数) → ?guild_choice=<token> 付きで
//       戻ってきて openGuildChoiceStep() が呼ばれる
//     ・初めて／未登録 → ?discord_reg=<dtoken> 付きでこのページに戻り、
//       openDiscordRegisterStep() が呼ばれる
//     ・Bot導入済みのどのサーバーにも参加していない → サーバー側が
//       エラーページを表示する（このページには戻ってこない）
// ============================================================
function loginWithDiscord() {
  // ★ 複数サーバー対応：guild_idはもう渡さない（サーバー側がDiscordの
  //   メンバーシップから自動判定する）。
  location.href = `${API_BASE}discord_login_start`;
}

// ★ 複数サーバー対応：既に複数サーバーに登録済みのDiscordユーザーの選択画面。
//   candidatesParamはURLの?candidates=に載ってきたguild_id/guild_nameだけの
//   一覧（表示用。実際の選択はtoken側で必ずサーバー側が再検証する）。
function openGuildChoiceStep(token) {
  const params = new URLSearchParams(location.search);
  let candidates = [];
  try { candidates = JSON.parse(params.get("candidates") || "[]"); } catch { candidates = []; }

  const listEl = document.getElementById("guild-choice-list");
  listEl.innerHTML = "";
  candidates.forEach(c => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "login-guild-choice-btn";
    // ★ 未登録の候補（このサーバーではまだ学籍番号登録をしていない）には
    //   その旨を添える。選ぶと学籍番号登録ステップへ案内される
    //   （chooseGuildFromChoiceのneeds_registration分岐参照）。
    const label = (c.guild_name || String(c.guild_id)) + (c.registered ? "" : "（未登録）");
    btn.textContent = label;
    btn.dataset.origLabel = label; // ★ エラー時にボタンの文字を元に戻すため保持しておく
    btn.addEventListener("click", () => chooseGuildFromChoice(token, c.guild_id, btn));
    listEl.appendChild(btn);
  });
  showStep("step-guild-choice");
}

async function chooseGuildFromChoice(token, guildId, btnEl) {
  document.querySelectorAll("#guild-choice-list .login-guild-choice-btn").forEach(b => b.disabled = true);
  if (btnEl) btnEl.textContent = "処理中…";
  const errEl = document.getElementById("guild-choice-err");
  errEl.style.display = "none";
  try {
    const result = await finalizeLogin(token, guildId);
    if (result.ok && result.needs_registration) {
      // ★ 選んだサーバーではまだ未登録 → 学籍番号登録ステップへ引き継ぐ
      //   （既存の1サーバー向け登録フローをそのまま再利用する）。
      openDiscordRegisterStep(result.discord_reg_token);
      return;
    }
    if (result.ok) {
      const palette = paletteFor(result.student.id);
      saveSession(result.student, result.session_token, palette, { id: result.guild_id, name: result.guild_name, multiGuild: result.multi_guild });
      location.href = getRedirectTarget();
      return;
    }
    errEl.textContent = result.error === "invalid_guild"
      ? "選択に失敗しました。もう一度ログインし直してください。"
      : (result.error || "ログインに失敗しました。");
    errEl.style.display = "block";
  } catch {
    errEl.textContent = "サーバーに接続できません。時間をおいて再試行してください。";
    errEl.style.display = "block";
  } finally {
    // ★ 修正：以前はボタンの文字を"処理中…"のまま戻していなかったため、
    //   実際には失敗して再クリックできる状態でも、見た目だけ固まって
    //   見えてしまっていた（実質的な「処理中で止まる」不具合の一因）。
    document.querySelectorAll("#guild-choice-list .login-guild-choice-btn").forEach(b => {
      b.disabled = false;
      if (b.dataset.origLabel) b.textContent = b.dataset.origLabel;
    });
  }
}

async function openDiscordRegisterStep(dtoken) {
  document.getElementById("inp-dtoken").value = dtoken;
  document.getElementById("discord-reg-err").style.display = "none";
  selectedRegGuildId = null;

  showStep("step-discord-reg");

  try {
    const info = await fetchDiscordRegInfo(dtoken);
    if (info.ok) {
      if (info.discord_username) {
        // Discordの表示名をニックネームの初期値として提案する（そのまま使うかは本人の自由）
        const nickEl = document.getElementById("inp-discord-nickname");
        if (nickEl && !nickEl.value) nickEl.value = info.discord_username.slice(0, 16);
      }
      renderRegGuildChoices(info.candidates || []);
    } else {
      showDiscordRegErr("このリンクの有効期限が切れています。もう一度「Discordでログイン」からやり直してください。");
    }
  } catch {
    // 参考情報の取得に失敗しても、登録フォーム自体は使えるので致命的ではない
  }

  // URLに残った ?discord_reg=... を消しておく（再読み込みで壊れないように）
  history.replaceState(null, "", location.pathname);
}

// ★ 複数サーバー対応：未登録のDiscordユーザーが、Bot導入済みの複数サーバーの
//   メンバーだった場合、どのサーバーに登録するか選ばせる。候補が1件だけなら
//   欄自体を隠し自動選択する（従来の1サーバー運用時と体験を変えないため）。
function renderRegGuildChoices(candidates) {
  const fieldEl = document.getElementById("discord-reg-guild-field");
  const listEl  = document.getElementById("discord-reg-guild-list");
  listEl.innerHTML = "";

  if (candidates.length <= 1) {
    selectedRegGuildId = candidates.length === 1 ? candidates[0].guild_id : null;
    fieldEl.style.display = "none";
    return;
  }

  selectedRegGuildId = null;
  fieldEl.style.display = "";
  candidates.forEach(c => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "login-guild-choice-btn";
    btn.textContent = c.guild_name || String(c.guild_id);
    btn.addEventListener("click", () => {
      selectedRegGuildId = c.guild_id;
      listEl.querySelectorAll(".login-guild-choice-btn").forEach(b => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");
    });
    listEl.appendChild(btn);
  });
}

async function submitDiscordRegister() {
  const dtoken   = document.getElementById("inp-dtoken").value;
  const id       = document.getElementById("inp-discord-student-id").value.trim().toUpperCase();
  const nickname = document.getElementById("inp-discord-nickname").value.trim();
  const btnEl    = document.getElementById("btn-discord-reg-submit");

  if (!validateDiscordId(id)) return;
  if (!selectedRegGuildId) {
    showDiscordRegErr("登録するサーバーを選んでください");
    return;
  }

  setBtn(btnEl, true, "登録中…");

  try {
    const result = await completeDiscordRegistration(dtoken, selectedRegGuildId, id, nickname);

    if (result.ok) {
      const palette = paletteFor(result.student.id);
      saveSession(result.student, result.session_token, palette, { id: selectedRegGuildId, name: "", multiGuild: result.multi_guild });
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

// ★ 複数サーバー対応：サーバーコード（招待コード）でこの端末のサーバーだけを
//   設定する。ログインはしない（閲覧専用ページが動くようになるだけ）。
async function submitGuildCode() {
  const code  = document.getElementById("inp-guild-code").value.trim().toUpperCase();
  const errEl = document.getElementById("guild-code-err");
  const btnEl = document.getElementById("btn-guild-code-submit");
  errEl.style.display = "none";
  if (!code) {
    errEl.textContent = "コードを入力してください";
    errEl.style.display = "block";
    return;
  }
  setBtn(btnEl, true, "確認中…");
  try {
    const result = await resolveGuildInviteCode(code);
    if (result.ok) {
      try {
        localStorage.setItem(GUILD_KEY, JSON.stringify({ guild_id: result.guild_id, guild_name: result.guild_name || "" }));
      } catch {}
      // ★ ログイン不要で閲覧できるのは現状「予定一覧」（index.html／Plan.js）だけ
      //   （Timetable.html含む他ページは全面ログイン必須のため、コード設定だけでは開けない）。
      location.href = "/index.html";
      return;
    }
    errEl.textContent = result.error || "コードが正しくありません。";
    errEl.style.display = "block";
  } catch {
    errEl.textContent = "サーバーに接続できません。時間をおいて再試行してください。";
    errEl.style.display = "block";
  } finally {
    setBtn(btnEl, false, "設定する");
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
  if (active.id === "step-guild-code") submitGuildCode();
});

// ★ ここまでエラーなく実行できた＝JSが生きている合図として、<body>先頭の
//   「読み込み中…」代替表示（js-fail-fallback、Icons.js参照）を消す。
hideLoadingFallback();
