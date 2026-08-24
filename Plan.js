
// ============================================================
//  plan.js — 予定管理ページ用スクリプト
//  index.html から読み込む
// ============================================================

const API_BASE = "/api/";
const GUILD_ID = "1509880344806162544";

// ★ 2026/08/20に一度、閲覧（/list_schedule）にもログインを必須にしたが、
//   Discordアプリ内ブラウザ等でセッションが正しく機能しない環境があり
//   「予定一覧だけは誰でも見られるように」というユーザーの明示的な指示
//   （2026/08/24）で、このページ自体の全面ログイン必須は撤廃した。
//   代わりに、予定一覧以外（「ログ」タブ・追加/編集/削除）はサーバー
//   参加済みのログインユーザー限定のまま維持する（下記参照）。
//   Notice.js/Cardmaker.js と同じ sl_session キーからセッションを読む。
const SESSION_KEY = 'sl_session';
const LOGIN_PATH = '/Login.html'; // ★ ログインページのパス（Login.jsのREDIRECT_PATHと同じ基準）
function getLoginSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}
// ★ 追加：変更系の操作（追加・編集・削除）を行う直前に呼ぶ。未ログインなら
//   ログイン画面へ誘導し、falseを返す（呼び出し側はそのまま処理を中断する）。
//   ログイン後にこのページへ戻ってこられるよう、遷移先をsessionStorageに記憶しておく
//  （Login.js側の getRedirectTarget() が post_login_redirect を見て使う）。
function requireLoginOrRedirect() {
  const s = getLoginSession();
  if (!s || !s.session_token) {
    sessionStorage.setItem('post_login_redirect', location.href);
    location.href = LOGIN_PATH;
    return null;
  }
  return s;
}
// ★ 追加：ドロワー下部に「だれとしてログインしているか」を表示する（2026/08/19）
//   StudyLog.jsのヘッダーアバターと同じ見た目（色付き丸アバター＋ニックネーム）。
//   タップでミニメニュー（アカウント設定／ログアウト）を開閉する。
function renderDrawerAccount() {
  const el = document.getElementById('drawer-account');
  if (!el) return;
  el.innerHTML = '';
  el.classList.remove('is-open');
  const s = getLoginSession();
  if (!(s && s.session_token && s.nickname)) {
    const link = document.createElement('a');
    link.className = 'drawer-account-login-link';
    link.href = LOGIN_PATH;
    link.textContent = 'ログインしていません';
    el.appendChild(link);
    return;
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'drawer-account-btn';

  const avatar = document.createElement('span');
  avatar.className = 'drawer-account-avatar';
  avatar.textContent = s.nickname.slice(0, 2).toUpperCase();
  if (s.color) avatar.style.background = s.color;
  if (s.text_color) avatar.style.color = s.text_color;
  btn.appendChild(avatar);

  const names = document.createElement('span');
  names.className = 'drawer-account-names';
  const nameEl = document.createElement('span');
  nameEl.className = 'drawer-account-name';
  nameEl.textContent = s.nickname;
  names.appendChild(nameEl);
  if (s.student_id) {
    const idEl = document.createElement('span');
    idEl.className = 'drawer-account-id';
    idEl.textContent = s.student_id;
    names.appendChild(idEl);
  }
  btn.appendChild(names);

  const chevron = document.createElement('span');
  chevron.className = 'drawer-account-chevron';
  chevron.textContent = '›';
  btn.appendChild(chevron);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    el.classList.toggle('is-open');
  });

  const menu = document.createElement('div');
  menu.className = 'drawer-account-menu';

  // ★ アカウント設定（Discord連携・パスワード変更）は勉強ログページに
  //   実装があるので、そちらを開く（?openAccount=1 を見て自動でモーダルを開く）。
  const settingsLink = document.createElement('a');
  settingsLink.className = 'drawer-account-menu-item';
  settingsLink.href = '/StudyLog.html?openAccount=1';
  settingsLink.innerHTML = Icons.html('settings', {size:16}) + ' アカウント設定（Discord連携・パスワード変更）';
  menu.appendChild(settingsLink);

  const logoutBtn = document.createElement('button');
  logoutBtn.type = 'button';
  logoutBtn.className = 'drawer-account-menu-item is-danger';
  logoutBtn.innerHTML = Icons.html('logout', {size:16}) + ' ログアウト';
  logoutBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await showAppConfirm({ title: 'ログアウトしますか？', okLabel: 'ログアウト', danger: true });
    if (!ok) return;
    localStorage.removeItem(SESSION_KEY);
    location.href = LOGIN_PATH;
  });
  menu.appendChild(logoutBtn);

  el.appendChild(btn);
  el.appendChild(menu);
}
document.addEventListener('click', (e) => {
  const el = document.getElementById('drawer-account');
  if (el && !el.contains(e.target)) el.classList.remove('is-open');
});
renderDrawerAccount();

// ★ 追加：表示テキスト／HTML属性値の両方に安全なHTMLエスケープ。
//   予定のsubject/content（カテゴリの【】部分も含む）は生徒が自由に入力できる
//   文字列で、これまで未エスケープのままinnerHTMLへ挿入していたため、
//   悪意ある内容の予定を1件作られるだけでホーム画面を開いた全員に
//   スクリプトが実行される保存型XSSが成立していた。
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ★ ポイント付与対象カテゴリ
const POINT_CATEGORIES = ['提出', '宿題'];

// ★ ポイント選択肢
const POINT_OPTIONS = [3, 5, 10, 15];

// ★ 備考をcontent文字列に埋め込むための区切り文字列
//   Botがそのままcontentをディスコードに投稿するため、見た目が崩れない読める形にする
const NOTE_SEP = '\n📝備考：';

// ============================================================
//  グローバル状態
// ============================================================
let plans    = [];
let channels = [];
let calState = {};
let editTarget = null;
let delTarget  = null;
let detailTarget = null; // ★ 詳細モーダルで表示中の予定のlabel
// ★ 追加：Safari／Discordアプリ内ブラウザ等で、まれにlist_scheduleの取得が
//   （ネットワークの瞬断・タイムアウト等で）失敗することがあり、以前は
//   catch(e){ plans = []; } で「本当に予定が0件」と区別せず握りつぶしていたため、
//   ユーザーからは「たまに予定なしになる（リロード・開き直しでも直らず、
//   ログインし直すと直る）」というバグに見えていた。実際にはログインし直す
//   ことで直っていたのではなく、その際にもう一度読み込みが走って偶然成功して
//   いただけと考えられる。取得失敗と「0件」を区別して表示するためのフラグ。
let plansLoadFailed = false;
let plansLoadErrorDetail = ''; // ★ 追加：原因調査用に、失敗理由（data.error等）を画面にも出す

// ============================================================
//  ★ 予定一覧・ログの段階読み込み（ページング）
//  ─────────────────────────────
//  予定を自動削除しなくなったため、過去分は年月とともに増え続ける。
//  全件を読み込んでから表示すると開くたびに遅くなっていくので、
//  ①これからの予定（未来分）を先に読み込んで即表示 → ②過去分は直近から
//  1ページ分だけ自動で追加読み込み → ③それでも続きがあれば
//  「もっと読み込む」ボタンで手動追加、という段階的な読み込みにする。
//  ログも同様に、最新分を1ページ読み込んで即表示し、続きはボタンで読む。
// ============================================================
const PAST_PLANS_PAGE_SIZE = 50;
const LOGS_PAGE_SIZE       = 50;
let pastPlansOffset  = 0;
let pastPlansHasMore = false;
let pastPlansLoading = false;
let logsData    = [];
let logsLoadErrorCode = null; // ★ 追加：取得失敗の理由（'guild_membership_required'等）。0件との区別に使う
let logsOffset  = 0;
let logsHasMore = false;
let logsLoading = false;

// ★ ポイント選択状態（'add' / 'edit' ごとに選択中のポイント値を保持）
let selectedPoints = { add: null, edit: null };

// ★ 絞り込み状態
let filterSubject = 'all';  // 'all' or channel name
let filterCat     = 'all';  // 'all' or category string

// ============================================================
//  日付ユーティリティ（ローカル時刻＝日本時間で YYYY-MM-DD を返す）
//  ※ toISOString() はUTC基準になるため使わない
// ============================================================
function todayLocalStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * ★ 予定リストの重複除去（date+subject+content が同じものは先勝ちで1つに）。
 *   サーバー側が scope パラメータ未対応（再デプロイ前など）だと、未来分・
 *   過去分の取得が両方とも「全件」を返してしまい、それを連結すると全予定が
 *   2重に表示されてしまう。読み込みを合成する箇所では必ずこれを通す。
 */
function dedupePlans(list) {
  const seen = new Set();
  const out = [];
  for (const p of list) {
    const key = `${p.date}/${p.subject}${p.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

// ============================================================
//  起動
// ============================================================
window.addEventListener('load', () => {
  loadChannels();
  loadPlans();
  applyLogTabVisibility(); // ★ 追加：未ログインには「ログ」タブ自体を見せない
  prefetchOtherPages(); // ★ 追加：メニューを開くのを待たず、初期表示後に自動で他ページを裏で先読み
});

// ★ 追加（2026/08/24）：予定一覧は誰でも見られるが、「ログ」タブ
//   （list_logs＝予定の変更履歴）はサーバー参加済みのログインユーザー
//   限定にした（ユーザーの明示的な指示）。ここではログインしていない
//   ことだけを見て、タブのボタン自体を隠す（他ページのrequireLoginOrRedirect
//   等と同じ「ログイン済みかどうか」の簡易チェック。実際の閲覧可否は
//   サーバー側のrequire_member_sessionで最終判定される）。
function applyLogTabVisibility() {
  const s = getLoginSession();
  const btns = document.querySelectorAll('.view-toggle .view-btn');
  const logBtn = [...btns].find(b => b.getAttribute('onclick') === "switchPlanView('log')");
  if (logBtn) logBtn.style.display = (s && s.session_token) ? '' : 'none';
}

// ============================================================
//  サブビュー切り替え（予定一覧 / ログ）
// ============================================================
function switchPlanView(v) {
  document.querySelectorAll('.view-btn').forEach((b, i) => {
    b.classList.toggle('active', ['plan','log'][i] === v);
  });
  document.getElementById('plan-sub-plan').classList.toggle('active', v === 'plan');
  document.getElementById('plan-sub-log').classList.toggle('active',  v === 'log');

  // 絞り込みバーの表示切り替え
  const filterBar = document.getElementById('filter-bar');
  const filterBtn = document.getElementById('filter-toggle-btn');
  if (filterBar) {
    if (v === 'log') {
      filterBar.classList.remove('open');
      if (filterBtn) filterBtn.classList.remove('filter-toggle-active');
    }
  }

  if (v === 'log') {
    loadLogs();
  }

  if (v === 'plan') {
    setTimeout(scrollToToday, 50);
  }
}

function scrollLogsTop() {
  const el = document.getElementById('log-content');
  if (!el) return;
  window.scrollTo({ top: el.offsetTop - 70, behavior: 'smooth' });
}

function onTodayButton() {
  const isLog = document.getElementById('plan-sub-log').classList.contains('active');
  if (isLog) {
    scrollLogsTop();
  } else {
    scrollToToday();
  }
}

// ============================================================
//  API ヘルパー
// ============================================================
// ★ 修正：以前はデフォルトで認証ヘッダを付けない作りだったため、list_schedule等
//   ログインを要求するようになったGET APIに対してもsession_tokenが送られておらず、
//   （そのAPI側で未実装だと）未ログインでも実データが返ってしまう抜け穴になっていた。
//   ログイン済みなら常にAuthorizationヘッダを自動で付ける（session_tokenをURLクエリに
//   載せないためでもある。個々の呼び出し側が明示的に付け忘れる心配がなくなる）。
async function api(path, opts = {}) {
  const session = getLoginSession();
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    (session && session.session_token) ? { "Authorization": "Bearer " + session.session_token } : {},
    opts.headers || {}
  );
  // ★ 追加：Cardmaker.js等と同じ理由（ブラウザ・中間プロキシのGETキャッシュ対策）。
  //   サーバー側もNO_CACHE_PATHSでCache-Control: no-storeを返すようにしたが、
  //   fetch側でも明示しておくことで二重に確実にする。
  const res = await fetch(API_BASE + path.replace(/^\/+/, ''), { cache: 'no-store', ...opts, headers });
  return res.json();
}

// ============================================================
//  チャンネル読み込み
// ============================================================
async function loadChannels() {
  try {
    const data = await api(`/channels?guild_id=${GUILD_ID}`);
    channels = data.ok ? data.channels : [];
  } catch(e) { channels = []; }
  renderChannelOptions();
  renderSubjectFilterChips();  // ★ 絞り込みチップも更新
}

// ============================================================
//  予定一覧読み込み
// ============================================================
async function loadPlans() {
  document.getElementById('plan-loading').style.display = 'block';
  document.getElementById('plan-content').innerHTML = '';
  plans = [];
  plansLoadFailed  = false;
  plansLoadErrorDetail = '';
  pastPlansOffset  = 0;
  pastPlansHasMore = false;

  // ① これからの予定（未来分）を先に読み込んで表示する
  //   ★ 追加：ネットワークの瞬断等での取得失敗（例外 or {ok:false}）を
  //   「0件」と区別せず表示していたバグの対策。まず1回だけ自動で再試行し、
  //   それでも失敗した場合だけ plansLoadFailed を立てて renderPlans() 側で
  //   「読み込みに失敗しました」を出す（＝本当に0件のときは従来通り
  //   「予定はありません」のまま）。
  let data = await fetchFutureSchedule();
  if (!data.ok) data = await fetchFutureSchedule();
  if (data.ok) {
    plans = dedupePlans(data.plans);
  } else if (data.error === 'not_logged_in') {
    // ★ 追加：セッションが無効（期限切れ・破損等）な場合、これまでの
    //   「読み込みに失敗しました」＋再読み込みボタンのままだと、何度
    //   再試行してもセッション自体は直らないため、利用者が無限に
    //   ボタンを押し続ける事故になる。これはページ全体のログイン
    //   チェック（冒頭のIIFE）が「localStorageに何らかのsession_token
    //   が存在するか」しか見ておらず、期限切れ等で無効なトークンでも
    //   素通りしてしまうために起こる（サーバー側のresolve_sessionで
    //   初めて無効と判定される）。ここで検知したら諦めて再ログインへ
    //   誘導する（ログイン後にこのページへ戻れるようpost_login_redirect
    //   を使う。冒頭のIIFEと同じ仕組み）。
    sessionStorage.setItem('post_login_redirect', location.href);
    localStorage.removeItem(SESSION_KEY);
    location.replace(LOGIN_PATH);
    return;
  } else {
    plans = [];
    plansLoadFailed = true;
    plansLoadErrorDetail = data.error || data.__clientError || '';
  }
  document.getElementById('plan-loading').style.display = 'none';
  renderPlans();
  scrollToToday();

  // ② 続けて、過去分を直近から1ページ分だけ自動で追加読み込みする
  //   （まだ多く残っている場合は「もっと読み込む」ボタンで手動追加）
  //   ★ ①が失敗した状態で②まで走らせても混乱するだけなので、①が
  //   成功したときだけ行う。
  if (!plansLoadFailed) await loadMorePastPlans();
}

async function fetchFutureSchedule() {
  try {
    return await api(`/list_schedule?guild_id=${GUILD_ID}&scope=future`);
  } catch (e) {
    // ★ 追加：原因調査用に、通信自体の例外メッセージも拾っておく
    //  （data.errorがサーバーからの明示的なエラーコード、__clientErrorが
    //   fetch自体が失敗した場合のブラウザ側のエラーメッセージ）。
    return { ok: false, __clientError: (e && e.message) || String(e) };
  }
}

/** 過去の予定を1ページ分読み込んで既存の plans に追加する（「もっと読み込む」ボタンからも呼ばれる） */
async function loadMorePastPlans() {
  if (pastPlansLoading) return;
  pastPlansLoading = true;
  const btn = document.getElementById('plan-load-more-btn');
  if (btn) setLoading(btn, '読み込み中…', true);

  try {
    const data = await api(`/list_schedule?guild_id=${GUILD_ID}&scope=past&offset=${pastPlansOffset}&limit=${PAST_PLANS_PAGE_SIZE}`);
    if (data.ok) {
      plans = dedupePlans(plans.concat(data.plans));
      pastPlansOffset += data.plans.length;
      pastPlansHasMore = !!data.has_more;
    } else {
      pastPlansHasMore = false;
    }
  } catch(e) {
    pastPlansHasMore = false;
  }
  pastPlansLoading = false;
  renderPlans();
}

function scrollToToday() {
  const filtered = getFilteredPlans();
  if (!filtered.length) return;

  const today = todayLocalStr();
  const futureDates = filtered.map(p => p.date).filter(d => d >= today).sort();

  let targetDate = null;
  if (futureDates.includes(today)) {
    targetDate = today;
  } else if (futureDates.length > 0) {
    targetDate = futureDates[0];
  } else {
    targetDate = filtered.map(p => p.date).sort().slice(-1)[0];
  }

  const targetEl = document.querySelector(`.date-group[data-date="${targetDate}"]`);
  if (!targetEl) return;

  const offset = targetEl.getBoundingClientRect().top + window.pageYOffset - 70;

  window.scrollTo({
    top: offset,
    behavior: 'auto'
  });
}


// ============================================================
//  ログ読み込み
// ============================================================
async function loadLogs() {
  document.getElementById('log-loading').style.display = 'block';
  document.getElementById('log-content').innerHTML = '';
  logsData    = [];
  logsOffset  = 0;
  logsHasMore = false;
  logsLoadErrorCode = null; // ★ 追加：0件と取得失敗を区別する（Plan.js側のplansLoadFailedと同じ考え方）

  // 最新から1ページ分だけ読み込んで、すべて読み込む前に表示する
  try {
    const data = await api(`/list_logs?guild_id=${GUILD_ID}&offset=0&limit=${LOGS_PAGE_SIZE}`);
    if (data.ok) {
      logsData    = data.logs;
      logsOffset  = data.logs.length;
      logsHasMore = !!data.has_more;
    } else {
      logsLoadErrorCode = data.error || 'unknown';
    }
  } catch(e) { logsData = []; logsLoadErrorCode = 'network_error'; }
  document.getElementById('log-loading').style.display = 'none';
  renderLogs();
}

/** ログを1ページ分読み込んで既存の logsData に追加する（「もっと読み込む」ボタンから呼ばれる） */
async function loadMoreLogs() {
  if (logsLoading) return;
  logsLoading = true;
  const btn = document.getElementById('log-load-more-btn');
  if (btn) setLoading(btn, '読み込み中…', true);

  try {
    const data = await api(`/list_logs?guild_id=${GUILD_ID}&offset=${logsOffset}&limit=${LOGS_PAGE_SIZE}`);
    if (data.ok) {
      logsData = logsData.concat(data.logs);
      logsOffset += data.logs.length;
      logsHasMore = !!data.has_more;
    } else {
      logsHasMore = false;
    }
  } catch(e) {
    logsHasMore = false;
  }
  logsLoading = false;
  renderLogs();
}

// ============================================================
//  ★ 絞り込みロジック
// ============================================================

/** 現在のフィルタを適用した plans を返す */
function getFilteredPlans() {
  return plans.filter(p => {
    // 教科フィルタ
    if (filterSubject !== 'all' && p.subject !== filterSubject) return false;

    // カテゴリフィルタ
    if (filterCat !== 'all') {
      const { cat } = parsePlanContent(p.content);

      // 提出・宿題まとめフィルタ
      if (filterCat === 'hw') {
        if (cat !== '提出' && cat !== '宿題') return false;
      } else {
        if (cat !== filterCat) return false;
      }
    }

    return true;
  });
}

/** 教科チップを描画（チャンネル読み込み後に呼ぶ） */
function renderSubjectFilterChips() {
  const wrap = document.getElementById('filter-subject-chips');
  if (!wrap) return;

  const allBtn = `<button class="chip chip-active" data-subj="all" onclick="toggleSubjFilter(this)">すべて</button>`;
  const chs = channels.map(c =>
    `<button class="chip" data-subj="${esc(c.name)}" onclick="toggleSubjFilter(this)">${esc(c.name)}</button>`
  ).join('');
  wrap.innerHTML = allBtn + chs;
}

/** 教科チップがクリックされたとき */
function toggleSubjFilter(btn) {
  filterSubject = btn.dataset.subj;
  btn.closest('.filter-chips').querySelectorAll('.chip').forEach(c => c.classList.remove('chip-active'));
  btn.classList.add('chip-active');
  renderPlans();
}

/** カテゴリチップがクリックされたとき */
function toggleCatFilter(btn) {
  filterCat = btn.dataset.cat;
  btn.closest('.filter-chips').querySelectorAll('.chip').forEach(c => c.classList.remove('chip-active'));
  btn.classList.add('chip-active');
  renderPlans();
}

// ============================================================
//  時間割（曜日ごとの教科順）
// ============================================================
const TIMETABLE = {
  mon: [
    { subject: "コンピュータリテラシ", items: ["教科書"] },
    { subject: "情報技術概論",         items: ["教科書", "プリント"] },
    { subject: "国語1乙a",             items: ["教科書", "資料集", "辞書"] },
  ],
  tue: [
    { subject: "化学1a",     items: ["教科書", "ワーク"] },
    { subject: "情報基礎",   items: ["教科書"] },
    { subject: "線形数学1a", items: ["教科書", "ノート", "ワーク"] },
    { subject: "地理a",      items: ["教科書", "資料集", "地図帳"] },
  ],
  wed: [
    { subject: "物理1a",     items: ["教科書", "プリント"] },
    { subject: "体育1a",     items: ["体操服", "教科書"] },
    { subject: "英語会話a",  items: ["教科書", "多読手帳"] },
    { subject: "その他",     items: [] },
  ],
  thu: [
    { subject: "情報工学ゼミ1", items: [] },
    { subject: "公共a",         items: ["教科書", "資料集", "プリント"] },
    { subject: "基礎解析1a",    items: ["教科書", "ワーク", "ノート"] },
    { subject: "国語1甲a",      items: ["国語ノート"] },
  ],
  fri: [
    { subject: "英語表現基礎a",           items: ["英語教科書", "辞書"] },
    { subject: "基礎解析",                items: ["教科書", "ノート"] },
    { subject: "英語コミュニケーション1a", items: ["英語教科書"] },
  ],
};

const WDAY_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];

/** 日付文字列(YYYY-MM-DD)からその曜日の時間割上の教科順インデックスを返す */
function timetableOrderIndex(dateStr, subject) {
  const d = new Date(dateStr + 'T00:00:00');
  const key = WDAY_KEYS[d.getDay()];
  const list = TIMETABLE[key];
  if (!list) return Infinity; // 土日など時間割がない曜日は元の順序のまま末尾扱い
  const idx = list.findIndex(item => item.subject === subject);
  return idx === -1 ? Infinity : idx; // 時間割にない教科は末尾
}

/** 同じ日付内の予定配列を、その曜日の時間割順に安定ソートする */
function sortByTimetable(dateStr, dayPlans) {
  return dayPlans
    .map((p, i) => ({ p, i, order: timetableOrderIndex(dateStr, p.subject) }))
    .sort((a, b) => (a.order - b.order) || (a.i - b.i))
    .map(x => x.p);
}

// ============================================================
//  予定一覧 描画
// ============================================================
const WDAYS = ['日','月','火','水','木','金','土'];

function parsePlanContent(raw) {
  const cat  = raw.match(/^【(.+?)】/)?.[1] || '';
  const rest = raw.replace(/^【.+?】/, '');
  const [textPart, notePart] = rest.split(NOTE_SEP);
  return { cat, text: (textPart || '').trim(), note: (notePart || '').trim() };
}

function renderPlans() {
  const el = document.getElementById('plan-content');
  const filtered = getFilteredPlans();

  // ★ 日付は昇順（過去→未来）で並ぶため、「もっと読み込む」で追加される
  //   過去の予定は一番上に来る。ボタンも一覧の先頭に置く。
  const loadMoreHtml = pastPlansHasMore
    ? `<button type="button" id="plan-load-more-btn" class="load-more-btn" onclick="loadMorePastPlans()">さらに過去の予定を読み込む</button>`
    : '';

  if (!filtered.length) {
    // ★ 追加：取得自体に失敗した場合は「予定はありません」ではなく、
    //   失敗したことが分かる表示＋再読み込みボタンを出す（本当に0件の
    //   ときとの見分けがつかない、というバグへの対策）。
    if (plansLoadFailed) {
      // ★ 追加：原因調査のため、失敗理由（サーバーのエラーコード or
      //   通信エラーのメッセージ）を小さく添えておく（無ければ何も出さない）。
      const detailHtml = plansLoadErrorDetail
        ? `<div class="error-msg" style="margin-top:-8px;padding-top:0;background:none;font-size:11px;color:var(--text-tertiary)">(詳細: ${esc(plansLoadErrorDetail)})</div>`
        : '';
      el.innerHTML = loadMoreHtml +
        '<div class="error-msg">予定の読み込みに失敗しました。通信環境をご確認ください。</div>' +
        detailHtml +
        '<button type="button" class="load-more-btn" onclick="loadPlans()">もう一度読み込む</button>';
      return;
    }
    el.innerHTML = loadMoreHtml + (plans.length
      ? '<div class="empty-msg">条件に一致する予定はありません</div>'
      : '<div class="empty-msg">予定はありません</div>');
    return;
  }

  const today = todayLocalStr();
  const grouped = {};
  filtered.forEach(p => { (grouped[p.date] = grouped[p.date] || []).push(p); });

  el.innerHTML = loadMoreHtml + Object.keys(grouped).sort().map(date => {
    const d = new Date(date + 'T00:00:00');
    const label = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${WDAYS[d.getDay()]}）`;

    const isToday = date === today;
    const isPast  = date < today;

    // ★ 時間割順に並べ替え
    const dayPlans = sortByTimetable(date, grouped[date]);

    const rows = dayPlans.map(p => {
      const { cat, text, note } = parsePlanContent(p.content);
      const ptsBadge = (p.points != null)
        ? `<span class="badge badge-pts"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-3px;flex-shrink:0" aria-hidden="true"><path d="M12 3.5l2.5 5.3 5.8.8-4.2 4.1 1 5.8-5.1-2.7-5.1 2.7 1-5.8-4.2-4.1 5.8-.8Z"/></svg> ${p.points}pt</span>`
        : '';
      const noteDot = note ? `<span class="note-dot" title="備考あり"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-3px;flex-shrink:0" aria-hidden="true"><path d="M6 4h9l3 3v13H6Z"/><path d="M15 4v3h3"/><path d="M9 13h6"/><path d="M9 17h6"/><path d="M9 9h3"/></svg></span>` : '';
      const label = `${p.date}/${p.subject}${p.content}`;
      return `<div class="plan-row" data-label="${esc(label)}" onclick="showPlanDetail(this)">
        <span class="subject">${esc(p.subject)}</span>
        <span class="badge badge-${esc(cat)}">${esc(cat)}</span>
        <span class="content">${esc(text)}</span>
        ${noteDot}
        ${ptsBadge}
      </div>`;
    }).join('');

    return `<div class="date-group ${isPast ? 'past' : ''}" data-date="${date}">
      <div class="date-label">${label}${isToday ? '<span class="today-tag">今日</span>' : ''}</div>
      <div class="date-card">${rows}</div>
    </div>`;
  }).join('');
}

// ============================================================
//  ★ 予定詳細モーダル
// ============================================================
function showPlanDetail(el) {
  const label = el.dataset.label;
  const plan = plans.find(p => `${p.date}/${p.subject}${p.content}` === label);
  if (!plan) return;

  detailTarget = label; // ★ 編集・削除ボタンから参照できるように保存

  const { cat, text, note } = parsePlanContent(plan.content);
  const d = new Date(plan.date + 'T00:00:00');
  const dateLabel = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${WDAYS[d.getDay()]}）`;

  const rowsHtml = [
    `<div class="detail-item"><div class="dl-label">日付</div><div class="dl-value">${esc(dateLabel)}</div></div>`,
    `<div class="detail-item"><div class="dl-label">科目</div><div class="dl-value">${esc(plan.subject)}</div></div>`,
    `<div class="detail-item"><div class="dl-label">カテゴリ</div><div class="dl-value"><span class="badge badge-${esc(cat)}">${esc(cat)}</span></div></div>`,
    `<div class="detail-item"><div class="dl-label">内容</div><div class="dl-value">${esc(text)}</div></div>`,
  ];
  if (plan.points != null) {
    rowsHtml.push(`<div class="detail-item"><div class="dl-label">ポイント</div><div class="dl-value"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-3px;flex-shrink:0" aria-hidden="true"><path d="M12 3.5l2.5 5.3 5.8.8-4.2 4.1 1 5.8-5.1-2.7-5.1 2.7 1-5.8-4.2-4.1 5.8-.8Z"/></svg> ${plan.points}pt</div></div>`);
  }
  if (note) {
    rowsHtml.push(`<div class="detail-item"><div class="dl-label">備考</div><div class="dl-value dl-note">${esc(note)}</div></div>`);
  }

  document.getElementById('detail-content').innerHTML = rowsHtml.join('');
  document.getElementById('modal-detail').classList.add('open');
}

// ============================================================
//  ★ 詳細モーダル → 編集／削除モーダルへの連携
// ============================================================

/** 選択リスト(edit-list / del-list)の中から label が一致する項目を選択状態にする */
function selectPlanByLabel(label, mode) {
  const listId = mode === 'edit' ? 'edit-list' : 'del-list';
  const items = document.querySelectorAll(`#${listId} .sel-item`);
  for (const it of items) {
    if (it.dataset.label === label) {
      selectPlan(it, mode);
      it.scrollIntoView({ block: 'center', behavior: 'smooth' });
      break;
    }
  }
}

/** 詳細モーダルの「編集する」ボタン */
function editFromDetail() {
  if (!detailTarget) return;
  closeModal('detail');
  openModal('edit');
  selectPlanByLabel(detailTarget, 'edit');
}

/** 詳細モーダルの「削除する」ボタン */
function deleteFromDetail() {
  if (!detailTarget) return;
  closeModal('detail');
  openModal('delete');
  selectPlanByLabel(detailTarget, 'delete');
}

// ============================================================
//  ログ 描画
// ============================================================
const TYPE_LABEL = { add:'追加', edit:'編集', delete:'削除', cleanup:'自動削除' };

function renderLogs() {
  const el = document.getElementById('log-content');
  if (!logsData.length) {
    // ★ 追加：0件と取得失敗を区別して表示する（Plan.js本体の予定一覧と同じ考え方）。
    //   「ログ」タブはサーバー参加済みログインユーザー限定のため、ログインしていても
    //   対象サーバーのメンバーでない場合はguild_membership_requiredになる。
    if (logsLoadErrorCode === 'guild_membership_required') {
      el.innerHTML = '<div class="error-msg">対象サーバーに参加しているアカウントでログインすると見られます。</div>';
    } else if (logsLoadErrorCode === 'not_logged_in') {
      el.innerHTML = '<div class="error-msg">ログインすると見られます。</div>';
    } else if (logsLoadErrorCode) {
      el.innerHTML = '<div class="error-msg">読み込みに失敗しました。</div>'
        + '<button type="button" class="load-more-btn" onclick="loadLogs()">もう一度読み込む</button>';
    } else {
      el.innerHTML = '<div class="empty-msg">ログはありません</div>';
    }
    return;
  }
  const loadMoreHtml = logsHasMore
    ? `<button type="button" id="log-load-more-btn" class="load-more-btn" onclick="loadMoreLogs()">もっと読み込む</button>`
    : '';
  el.innerHTML = logsData.map(l => `
    <div class="tl-item">
      <div class="tl-dot dot-${esc(l.type)}"></div>
      <div class="tl-time">${esc(l.time)}</div>
      <div class="tl-card">
        <div class="tl-type type-${esc(l.type)}">${esc(TYPE_LABEL[l.type] || l.type)}</div>
        <div class="tl-detail">${esc(l.detail)}</div>
      </div>
    </div>`).join('') + loadMoreHtml;
}

// ============================================================
//  科目セレクト
// ============================================================
function renderChannelOptions() {
  const opts = channels.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  document.getElementById('add-subject').innerHTML  = opts || '<option value="">（なし）</option>';
  document.getElementById('edit-subject').innerHTML = '<option value="">— 変更しない —</option>' + opts;
}

// ============================================================
//  選択リスト（編集・削除）
// ============================================================
function renderSelectList(containerId, mode) {
  const el = document.getElementById(containerId);
  if (!plans.length) { el.innerHTML = '<div class="empty-msg">予定がありません</div>'; return; }
  el.innerHTML = plans.map(p => {
    const label = `${p.date}/${p.subject}${p.content}`;
    const { cat, text } = parsePlanContent(p.content);
    return `<div class="sel-item" data-label="${esc(label)}" onclick="selectPlan(this,'${mode}')">
      <span class="si-date">${esc(p.date)}</span>
      <span class="si-subject">${esc(p.subject)}</span>
      <span class="badge badge-${esc(cat)}">${esc(cat)}</span>
      <span class="si-content">${esc(text)}</span>
    </div>`;
  }).join('');
}

function selectPlan(el, mode) {
  el.closest('.sel-list').querySelectorAll('.sel-item').forEach(i => i.classList.remove('selected'));
  el.classList.add('selected');
  if (mode === 'edit') {
    editTarget = el.dataset.label;

    // ★ 選択した予定に既にポイントがあれば編集欄のヒントとして反映
    const label = el.dataset.label;
    const plan = plans.find(p => `${p.date}/${p.subject}${p.content}` === label);
    const ptsWrap  = document.getElementById('edit-points-wrap');
    if (plan) {
      const { cat, text, note } = parsePlanContent(plan.content);

      // ★ 内容・備考は現在の値を編集欄に入れておく（そのまま保存すれば変更なし）
      document.getElementById('edit-content').value = text;
      document.getElementById('edit-note').value = note;

      // ★ その他カテゴリでも任意でポイントを付けられるように、カテゴリを問わず表示する
      ptsWrap.style.display = 'block';
      // 既存のポイントが選択肢内にあればプリセット、なければ未選択のまま
      selectedPoints['edit'] = POINT_OPTIONS.includes(plan.points) ? plan.points : null;
      renderPointsChips('edit');
      const label = ptsWrap.querySelector('.pts-label');
      if (label) {
        const base = POINT_CATEGORIES.includes(cat) ? 'ポイント' : 'ポイント（任意）';
        label.textContent = (plan.points != null)
          ? `${base}（現在: ${plan.points}pt・変更しない場合は未選択のまま）`
          : `${base}（変更しない場合は未選択のまま）`;
      }
    }
  } else {
    delTarget = el.dataset.label;
    document.getElementById('del-label').textContent = el.dataset.label;
    document.getElementById('del-confirm').style.display = 'block';
  }
}

// ============================================================
//  FAB
// ============================================================
function toggleFab() {
  const open = !document.getElementById('fab-actions').classList.contains('open');
  document.getElementById('fab-actions').classList.toggle('open', open);
  document.getElementById('fab-main').classList.toggle('open', open);
  document.getElementById('fab-overlay').classList.toggle('open', open);
}
function closeFab() {
  document.getElementById('fab-actions').classList.remove('open');
  document.getElementById('fab-main').classList.remove('open');
  document.getElementById('fab-overlay').classList.remove('open');
}

function openModal(name) {
  closeFab();
  document.getElementById('modal-' + name).classList.add('open');
  if (name === 'add')    {
    initCal('add', false);
    selectedPoints['add'] = null;
    updatePointsVisibility('add');
  }
  if (name === 'edit')   {
    initCal('edit', true);
    editTarget = null;
    renderSelectList('edit-list', 'edit');
    selectedPoints['edit'] = null;
    document.getElementById('edit-points-wrap').style.display = 'none';
    document.getElementById('edit-content').value = '';
    document.getElementById('edit-note').value = '';
  }
  if (name === 'delete') { delTarget = null; renderSelectList('del-list', 'delete'); document.getElementById('del-confirm').style.display = 'none'; }
}
function closeModal(name) {
  document.getElementById('modal-' + name).classList.remove('open');
  document.querySelectorAll('.cal-pop').forEach(p => p.classList.remove('open'));
}
function onBgClick(e, name) {
  if (e.target === document.getElementById('modal-' + name)) closeModal(name);
}

// ============================================================
//  ★ ポイント入力欄の表示切り替え・選択肢描画
// ============================================================
function updatePointsVisibility(prefix) {
  const cat  = getCatValue(prefix);
  const wrap = document.getElementById(prefix + '-points-wrap');
  if (!wrap) return;
  // ★ カテゴリが「提出」「宿題」以外でも、カテゴリさえ決まっていれば
  //   任意でポイントを付けられるように表示する
  wrap.style.display = cat ? 'block' : 'none';
  if (cat) renderPointsChips(prefix);
}

/** ポイント選択チップ（3 / 5 / 10 / 15）を描画する */
function renderPointsChips(prefix) {
  const wrap = document.getElementById(prefix + '-points-wrap');
  if (!wrap) return;
  const cat      = getCatValue(prefix);
  const required = POINT_CATEGORIES.includes(cat);
  // ★ 必須カテゴリ（提出・宿題）で追加時は未選択なら5ptをデフォルトで選択状態にする
  //   それ以外のカテゴリは任意なので、明示的に選ぶまで未選択のまま
  if (prefix === 'add' && required && selectedPoints[prefix] == null) {
    selectedPoints[prefix] = 5;
  }
  const current = selectedPoints[prefix];
  const chips = POINT_OPTIONS.map(v =>
    `<button type="button" class="chip pts-chip${current === v ? ' chip-active' : ''}" data-pts="${v}" onclick="pickPoints('${prefix}', ${v})">${v}pt</button>`
  ).join('');
  const labelText = required ? 'ポイント' : 'ポイント（任意）';
  wrap.innerHTML = `
    <div class="pts-label">${labelText}</div>
    <div class="filter-chips pts-chips">${chips}</div>
  `;
}

/** ポイントチップがクリックされたとき */
function pickPoints(prefix, val) {
  const cat      = getCatValue(prefix);
  const required = POINT_CATEGORIES.includes(cat);
  // ★ 任意カテゴリは、選択中のチップをもう一度押すと選択解除できる（＝ポイントなし）
  if (!required && selectedPoints[prefix] === val) {
    selectedPoints[prefix] = null;
  } else {
    selectedPoints[prefix] = val;
  }
  renderPointsChips(prefix);
}

// ============================================================
//  API 送信
// ============================================================
async function submitAdd() {
  const session = requireLoginOrRedirect();
  if (!session) return;
  const date     = calState['add']?.selected;
  const subject  = document.getElementById('add-subject').value;
  const category = getCatValue('add');
  if (!category) { showErr('add-err', 'カテゴリを入力してください'); return; }
  const content  = document.getElementById('add-content').value.trim();
  if (!date || !subject || !content) { showErr('add-err', '日付・科目・内容は必須です'); return; }
  const note = document.getElementById('add-note').value.trim();
  const contentToSend = note ? `${content}${NOTE_SEP}${note}` : content;

  const body = { guild_id: GUILD_ID, session_token: session.session_token, date, subject, category, content: contentToSend, nickname: session.nickname };

  if (POINT_CATEGORIES.includes(category)) {
    const points = selectedPoints['add'];
    if (!points) { showErr('add-err', 'ポイントを選択してください'); return; }
    body.points = points;
  } else if (selectedPoints['add']) {
    // ★ その他カテゴリは任意。選択されていれば送る
    body.points = selectedPoints['add'];
  }

  const btn = document.querySelector('#modal-add .btn-primary');
  setLoading(btn, '登録中…');
  try {
    const res = await api('/add_schedule', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    resetLoading(btn, '追加する');
    if (res.ok) {
      showOk('add-ok');
      document.getElementById('add-content').value = '';
      document.getElementById('add-note').value = '';
      selectedPoints['add'] = null;
      document.getElementById('add-points-wrap').style.display = 'none';
      resetCal('add', '日付を選択');
      await loadPlans();
    } else {
      showErr('add-err', res.message || 'エラーが発生しました');
    }
  } catch(e) {
    resetLoading(btn, '追加する');
    showErr('add-err', 'サーバーに接続できませんでした');
  }
}

async function submitEdit() {
  const session = requireLoginOrRedirect();
  if (!session) return;
  if (!editTarget) { showErr('edit-err', '予定を選択してください'); return; }
  const body = { guild_id: GUILD_ID, session_token: session.session_token, target: editTarget, nickname: session.nickname };
  const d = calState['edit']?.selected; if (d) body.date = d;
  const s = document.getElementById('edit-subject').value;   if (s) body.subject = s;
  const c = getCatValue('edit'); if (c) body.category = c;
  const t = document.getElementById('edit-content').value.trim();
  const n = document.getElementById('edit-note').value.trim();
  if (t) body.content = n ? `${t}${NOTE_SEP}${n}` : t;

  if (selectedPoints['edit']) body.points = selectedPoints['edit'];

  const btn = document.querySelector('#modal-edit .btn-primary');
  setLoading(btn, '保存中…');
  try {
    const res = await api('/edit_schedule', { method: 'POST', body: JSON.stringify(body) });
    resetLoading(btn, '保存する');
    if (res.ok) {
      showOk('edit-ok');
      editTarget = null;
      document.getElementById('edit-content').value = '';
      document.getElementById('edit-note').value = '';
      document.getElementById('edit-category-sel').value = '';
      document.getElementById('edit-category-inp').style.display = 'none';
      document.getElementById('edit-subject').value = '';
      selectedPoints['edit'] = null;
      document.getElementById('edit-points-wrap').style.display = 'none';
      resetCal('edit', '変更しない場合は空欄');
      await loadPlans();
      renderSelectList('edit-list', 'edit');
    } else {
      showErr('edit-err', res.message || 'エラーが発生しました');
    }
  } catch(e) {
    resetLoading(btn, '保存する');
    showErr('edit-err', 'サーバーに接続できませんでした');
  }
}

async function submitDelete() {
  const session = requireLoginOrRedirect();
  if (!session) return;
  if (!delTarget) return;
  const btn = document.querySelector('#del-confirm .btn-danger');
  setLoading(btn, '削除中…', true);
  try {
    const res = await api('/delete_schedule', {
      method: 'POST', body: JSON.stringify({ guild_id: GUILD_ID, session_token: session.session_token, target: delTarget, nickname: session.nickname })
    });
    resetLoading(btn, '削除する');
    if (res.ok) {
      showOk('del-ok');
      document.getElementById('del-confirm').style.display = 'none';
      delTarget = null;
      await loadPlans();
      renderSelectList('del-list', 'delete');
    } else {
      showErr('del-err', res.message || 'エラーが発生しました');
    }
  } catch(e) {
    resetLoading(btn, '削除する');
    showErr('del-err', 'サーバーに接続できませんでした');
  }
}

// ============================================================
//  UI ヘルパー
// ============================================================
function setLoading(btn, label, dark = false) {
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner${dark ? ' spinner-dark' : ''}"></span>${label}`;
}
function resetLoading(btn, label) {
  btn.disabled = false;
  btn.textContent = label;
}
function showOk(id) {
  const el = document.getElementById(id);
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 3000);
}
function showErr(id, msg) {
  const el = document.getElementById(id);
  el.innerHTML = Icons.html('close', {size:14}) + ' ' + esc(msg);
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 4000);
}
function getCatValue(prefix) {
  const sel = document.getElementById(prefix + '-category-sel');
  if (sel.value === '__custom__') {
    return document.getElementById(prefix + '-category-inp').value.trim();
  }
  return sel.value;
}
function onCatSel(prefix) {
  const sel = document.getElementById(prefix + '-category-sel');
  const inp = document.getElementById(prefix + '-category-inp');
  if (sel.value === '__custom__') { inp.style.display = 'block'; inp.focus(); }
  else { inp.style.display = 'none'; }
  updatePointsVisibility(prefix);
}

// ============================================================
//  カスタムカレンダー
// ============================================================
const CAL_D = ['日','月','火','水','木','金','土'];

function initCal(id, allowPast) {
  const now = new Date();
  calState[id] = { year: now.getFullYear(), month: now.getMonth(), selected: null, allowPast };
  renderCal(id);
}
function resetCal(id, placeholder) {
  if (calState[id]) { calState[id].selected = null; renderCal(id); }
  const el = document.getElementById(id + '-date-text');
  if (el) { el.textContent = placeholder; el.style.color = 'var(--text-tertiary)'; }
}
function renderCal(id) {
  const s = calState[id]; if (!s) return;
  const el = document.getElementById('cal-' + id); if (!el) return;
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const firstDay = new Date(s.year, s.month, 1).getDay();
  const dim = new Date(s.year, s.month+1, 0).getDate();
  const CAL_M = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

  let html = `<div class="cal-head">
    <button class="cal-nav-btn" onclick="moveCal(event,'${id}',-1)">‹</button>
    <span>${s.year}年 ${CAL_M[s.month]}</span>
    <button class="cal-nav-btn" onclick="moveCal(event,'${id}',1)">›</button>
  </div><div class="cal-grid">`;
  CAL_D.forEach(d => { html += `<div class="cal-dow">${d}</div>`; });
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-day emp"></div>`;
  for (let d = 1; d <= dim; d++) {
    const ds = `${s.year}-${String(s.month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isPast = !s.allowPast && ds < todayStr;
    let cls = 'cal-day';
    if (isPast) cls += ' dis';
    if (ds === todayStr && ds !== s.selected) cls += ' tod';
    if (ds === s.selected) cls += ' sel';
    const click = isPast ? '' : `onclick="pickDate(event,'${id}','${ds}')"`;
    html += `<div class="${cls}" ${click}>${d}</div>`;
  }
  el.innerHTML = html + '</div>';
}
function moveCal(e, id, dir) {
  e.stopPropagation();
  const s = calState[id];
  s.month += dir;
  if (s.month < 0)  { s.month = 11; s.year--; }
  if (s.month > 11) { s.month = 0;  s.year++; }
  renderCal(id);
}
function pickDate(e, id, ds) {
  e.stopPropagation();
  calState[id].selected = ds;
  const [y, m, d] = ds.split('-');
  const el = document.getElementById(id + '-date-text');
  el.textContent = `${y}年${parseInt(m)}月${parseInt(d)}日`;
  el.style.color = 'var(--text)';
  document.getElementById('cal-' + id).classList.remove('open');
  renderCal(id);
}
function toggleCal(e, id) {
  e.stopPropagation();
  const el = document.getElementById('cal-' + id);
  const wasOpen = el.classList.contains('open');
  document.querySelectorAll('.cal-pop').forEach(p => p.classList.remove('open'));
  if (!wasOpen) {
    el.classList.add('open');
    setTimeout(() => {
      const rect  = el.getBoundingClientRect();
      const modal = el.closest('.modal');
      if (modal && rect.bottom > window.innerHeight - 20) {
        modal.scrollBy({ top: rect.bottom - window.innerHeight + 30, behavior: 'smooth' });
      }
    }, 30);
  }
}
document.addEventListener('click', e => {
  if (!e.target.closest('.date-wrap')) document.querySelectorAll('.cal-pop').forEach(p => p.classList.remove('open'));
});

// ============================================================
//  ドロワー
// ============================================================
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
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
    '/Timetable.js',
    '/Cardmaker.js', '/Cardmaker.css',
    '/StudyLog.js', '/StudyLog.css',
    '/Notice.js',
    '/ServiceInfo.js',
  ].forEach(href => {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = href;
    document.head.appendChild(link);
  });
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}

// ★ 追加：ドロワーのメニューをタップした瞬間に、読み込み中であることが
//   見た目にもすぐ伝わるよう、ページ遷移ローディングを即座に表示する
//   （実際のページ遷移はブラウザ標準の <a href> 遷移のまま。読み込みが
//   速いページならすぐ次のページに切り替わるので気づかない）。
document.querySelectorAll('.drawer-item[href]').forEach(a => {
  a.addEventListener('click', (e) => {
    // ★ 追加：今開いているページ自身の項目をタップした場合は、同じページへ
    //   わざわざ再遷移（リロード）せず、ドロワーを閉じるだけにする。
    if (a.classList.contains('active')) {
      e.preventDefault();
      closeDrawer();
      return;
    }
    const overlay = document.getElementById('page-nav-loading');
    if (overlay) overlay.classList.add('show');
  });
});
// ★ 追加：bfcache（ブラウザの「戻る」）で復元されたときに、遷移ローディングの
//   表示が残ったまま固まって見えないよう、表示のたびに必ず消しておく。
window.addEventListener('pageshow', () => {
  const overlay = document.getElementById('page-nav-loading');
  if (overlay) overlay.classList.remove('show');
});

// ============================================================
//  絞り込みバー 開閉
// ============================================================
function toggleFilterBar() {
  const bar = document.getElementById('filter-bar');
  const btn = document.getElementById('filter-toggle-btn');
  const isOpen = bar.classList.contains('open');
  bar.classList.toggle('open', !isOpen);
  btn.classList.toggle('filter-toggle-active', !isOpen);
}

// ===== JSON変更監視（予定 list_schedule のみ） =====
let lastScheduleHash = null;

// SHA-256 ハッシュ計算
async function digestMessage(message) {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// 予定JSONの変更チェック
// ★ 変更点：location.reload() をやめ、データだけ更新してその場で再描画する。
//   ・スクロール位置を保ったまま renderPlans() を再実行
//   ・編集／削除モーダルが開いていれば、その選択リストも最新化
//   ・入力中のフォーム（追加モーダルなど）やカレンダーの状態は一切触らない
// ★ さらに変更点：ここで list_schedule を無条件（全件）取得すると、
//   ページング導入の意味がなくなり10秒ごとに全件を読み直してしまうため、
//   監視対象は「これからの予定」（scope=future）だけに絞る。
//   新規追加・編集・削除はほぼ常に近い将来の予定に対して行われるため、
//   これで実用上十分。既に読み込み済みの過去分ページはそのまま維持し、
//   未来分だけを最新のものに差し替える。
async function checkScheduleUpdate() {
  try {
    const session = getLoginSession();
    const res = await fetch(`${API_BASE}list_schedule?guild_id=${GUILD_ID}&scope=future`, {
      cache: 'no-store',
      headers: (session && session.session_token) ? { "Authorization": "Bearer " + session.session_token } : {},
    });
    const txt = await res.text();
    const hash = await digestMessage(txt);

    // 初回は保存だけ
    if (lastScheduleHash === null) {
      lastScheduleHash = hash;
      return;
    }

    // ハッシュが変わっていなければ何もしない
    if (hash === lastScheduleHash) return;
    lastScheduleHash = hash;

    // 未来分だけ差し替える（読み込み済みの過去分ページはそのまま維持する）
    let data;
    try { data = JSON.parse(txt); } catch(e) { return; }
    if (!data.ok) return;
    const today = todayLocalStr();
    const pastLoaded = plans.filter(p => p.date < today);
    plans = dedupePlans(data.plans.concat(pastLoaded));

    // スクロール位置を保ったまま予定一覧を再描画
    const scrollY = window.scrollY;
    renderPlans();
    window.scrollTo(0, scrollY);

    // 編集／削除モーダルが開いていれば、その選択リストも最新化
    if (document.getElementById('modal-edit')?.classList.contains('open')) {
      renderSelectList('edit-list', 'edit');
    }
    if (document.getElementById('modal-delete')?.classList.contains('open')) {
      renderSelectList('del-list', 'delete');
    }
  } catch(e) {}
}

// ★ 以前は10秒おきのポーリングだけだったが、サーバーが実際に常時稼働している
//   ので、変更があった瞬間にpushしてもらい即座に反映する（Server-Sent Events）。
//   接続が切れた場合に備え、10秒間隔のフォールバックポーリングも残す。
function startRealtimeUpdates() {
  try {
    const es = new EventSource(`${API_BASE}events?guild_id=${GUILD_ID}`);
    es.onmessage = () => { checkScheduleUpdate(); };
  } catch (e) {
    // EventSource非対応環境などでも、下のフォールバックポーリングだけで動作を継続できる
  }
}
startRealtimeUpdates();
setInterval(checkScheduleUpdate, 10000);

// ★ ここまでエラーなく実行できた＝JSが生きている合図として、<body>先頭の
//   「読み込み中…」代替表示（js-fail-fallback、Icons.js参照）を消す。
hideLoadingFallback();
