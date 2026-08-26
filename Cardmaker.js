// ============================================================
//  Cardmaker.js — CardMaker専用スクリプト
//  Cardmaker.html から読み込む
// ============================================================

const API_BASE = "/api/";
// ★ 複数サーバー対応：以前は固定値だったが、ログイン（またはサーバーコード）で
//   この端末に覚えさせたサーバーをlocalStorageの"current_guild"から読む形にした
//   （Login.js参照）。まだ一度もサーバーが分かっていない端末はLogin.htmlへ誘導する。
const GUILD_ID = (function () {
  try {
    const g = JSON.parse(localStorage.getItem('current_guild'));
    return g && g.guild_id ? String(g.guild_id) : null;
  } catch (e) { return null; }
})();
if (!GUILD_ID) {
  try { sessionStorage.setItem('post_login_redirect', location.href); } catch (e) {}
  location.replace('/Login.html');
}

// ★ /nameコマンドでサーバーごとに設定された表示名（無ければ"学生勉強会web"）を、
//   ドロワーロゴに反映する。.app-nameはSVGアイコン+末尾テキストの構造なので、
//   末尾のテキストノードだけ書き換える。
(function () {
  try {
    const g = JSON.parse(localStorage.getItem('current_guild'));
    const name = (g && g.guild_name) ? g.guild_name : '学生勉強会web';
    document.querySelectorAll('.app-name').forEach(el => {
      for (let i = el.childNodes.length - 1; i >= 0; i--) {
        if (el.childNodes[i].nodeType === Node.TEXT_NODE) {
          el.childNodes[i].textContent = ' ' + name;
          return;
        }
      }
      el.appendChild(document.createTextNode(' ' + name));
    });
  } catch (e) {}
})();
const LOGIN_PATH = '/Login.html'; // ★ ログインページのパス（Login.jsのREDIRECT_PATHと同じ基準）

// ── ログインセッション（Login.js と共通） ──────
const SESSION_KEY = 'sl_session';
function getLoginSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

// ★ StudyLog.jsと同様、開いた瞬間に未ログイン（またはsession_tokenの無い
//   パスワード未対応の古い形式のセッション）ならログイン画面へ誘導する。
//   ログイン後にこの画面へ戻ってこられるよう、遷移先をsessionStorageに記憶しておく
//  （Login.js側の getRedirectTarget() が post_login_redirect を見て使う）。
(function() {
  var s = getLoginSession();
  if (!s || !s.session_token) {
    sessionStorage.setItem('post_login_redirect', location.href);
    location.replace(LOGIN_PATH);
  }
})();

// ── ヘッダーのアカウント情報表示 ──────────────
// StudyLog.jsのapplySession()と同じ考え方。ログイン時にLogin.jsが保存した
// nickname / color / text_color をそのまま使う（新たに問い合わせない）。
const STUDENT = (function() {
  var s = getLoginSession() || {};
  return {
    id:        s.student_id,
    nickname:  s.nickname,
    color:     s.color,
    textColor: s.text_color,
  };
})();

// ★ 追加：ドロワー下部に「だれとしてログインしているか」を表示する（2026/08/19）
//   StudyLog.jsのヘッダーアバターと同じ見た目（色付き丸アバター＋ニックネーム）。
//   タップでミニメニュー（アカウント設定／ログアウト）を開閉する。
function renderDrawerAccount() {
  const el = document.getElementById('drawer-account');
  if (!el) return;
  el.innerHTML = '';
  el.classList.remove('is-open');
  if (!STUDENT.nickname) {
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
  avatar.textContent = STUDENT.nickname.slice(0, 2).toUpperCase();
  if (STUDENT.color) avatar.style.background = STUDENT.color;
  if (STUDENT.textColor) avatar.style.color = STUDENT.textColor;
  btn.appendChild(avatar);

  const names = document.createElement('span');
  names.className = 'drawer-account-names';
  const nameEl = document.createElement('span');
  nameEl.className = 'drawer-account-name';
  nameEl.textContent = STUDENT.nickname;
  names.appendChild(nameEl);
  if (STUDENT.id) {
    const idEl = document.createElement('span');
    idEl.className = 'drawer-account-id';
    idEl.textContent = STUDENT.id;
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

  const settingsLink = document.createElement('a');
  settingsLink.className = 'drawer-account-menu-item';
  settingsLink.href = '/StudyLog.html?openAccount=1';
  settingsLink.innerHTML = Icons.html('settings', {size:16}) + ' アカウント設定（Discord連携・パスワード変更）';
  menu.appendChild(settingsLink);

  // ★ 複数サーバー対応：別のDiscordサーバーへ切り替える（ログアウトしてから
  //   再度ログインしてもらう＝どのサーバーへ行くかはログイン時にサーバー側が
  //   自動判定する。Login.js参照）。
  // ★ 修正：以前は「複数サーバーに参加している人だけに表示」していたが、
  //   その判定（multi_guild）は前回ログイン時点のスナップショットのため、
  //   ログイン後に別のサーバーへBotを追加しても反映されず、切り替える
  //   手段そのものが無くなってしまう不具合があった。常に表示する方式に変更。
  const switchBtn = document.createElement('button');
  switchBtn.type = 'button';
  switchBtn.className = 'drawer-account-menu-item';
  switchBtn.innerHTML = Icons.html('refresh', {size:16}) + ' サーバーを切り替える';
  switchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('current_guild');
    location.href = LOGIN_PATH;
  });
  menu.appendChild(switchBtn);

  const logoutBtn = document.createElement('button');
  logoutBtn.type = 'button';
  logoutBtn.className = 'drawer-account-menu-item is-danger';
  logoutBtn.innerHTML = Icons.html('logout', {size:16}) + ' ログアウト';
  logoutBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await showCmConfirm({ title: 'ログアウトしますか？', okLabel: 'ログアウト', okStyle: 'danger' });
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

// ★ 単位チェッカーは1I勉強会（豊田高専情報工学科向けのデータ）専用機能のため、
//   他サーバーではドロワーに表示しない。
if (GUILD_ID !== "1509880344806162544") {
  document.querySelectorAll('a.drawer-item[href="/TanCheck.html"]').forEach(el => el.remove());
}

function applyAccountHeader() {
  var avatarEl   = document.getElementById("header-avatar");
  var nicknameEl = document.getElementById("header-nickname");
  var idEl       = document.getElementById("header-id");
  if (!STUDENT.nickname) return; // ★ 通常はここに来る前にログイン画面へ飛んでいるはずだが念のため

  if (avatarEl) {
    avatarEl.textContent      = STUDENT.nickname.slice(0, 2).toUpperCase();
    avatarEl.style.background = STUDENT.color;
    avatarEl.style.color      = STUDENT.textColor;
  }
  if (nicknameEl) nicknameEl.textContent = STUDENT.nickname;
  if (idEl)       idEl.textContent       = STUDENT.id;

  // ★ 追加：右上のアカウント表示（アバター/ニックネーム/学籍番号）は
  //   以前は見た目だけで押せなかった。StudyLog.jsのヘッダー
  //   （attachAccountClickHandlers）・ドロワー下部のアカウント表示
  //   （renderDrawerAccount）と同じ「タップでアカウント設定を開く」に
  //   揃える。CardMaker自体はアカウント設定モーダルを持たないため、
  //   ドロワーの「⚙️ アカウント設定」と同じ遷移先（StudyLog.js側が
  //   ?openAccount=1を見て自動でモーダルを開く）に飛ばす。
  //   ここから開けば、共有中のデッキ共有リンクの一覧・取り消しにもたどり着ける。
  var headerAccountEl = document.querySelector('.header-account');
  if (headerAccountEl && !headerAccountEl.dataset.clickBound) {
    headerAccountEl.dataset.clickBound = '1';
    headerAccountEl.style.cursor = 'pointer';
    headerAccountEl.title = 'タップしてアカウント設定を開く';
    headerAccountEl.addEventListener('click', function() {
      location.href = '/StudyLog.html?openAccount=1';
    });
  }
}
applyAccountHeader();

// ★ 複数サーバー対応：以前はローカル下書き・並び順キャッシュ等がguildを
//   問わない共通のlocalStorageキーだったため、同じ端末で別サーバーに
//   切り替えても同じ下書きデッキが見えてしまっていた（非公開のはずの
//   デッキが他サーバーにも出てくる不具合）。キーにGUILD_IDを含める形に
//   変更し、旧キーにデータが残っていれば（＝これまで1サーバーだけで
//   使っていた既存ユーザー）現在のguildへ一度だけ引き継ぐ。
function migrateGuildScopedLocalKey(oldKey, newKey) {
  // ★ 修正（不具合修正、2026/08/26）：location.replace('/Login.html')は同期実行中の
  //   スクリプトを即座には止めない（ブラウザが実際にページを離れるまでの間、
  //   このファイルの残りの行はそのまま最後まで実行され続ける）。そのため
  //   GUILD_IDがまだ分からない端末（current_guild未設定）では、この関数が
  //   "cardmaker_decks_v1_null" のような壊れたキーへ向けて移行処理を実行して
  //   しまい、しかも移行元の元データ（oldKey）を消してしまっていた。
  //   ログイン後に本当のGUILD_IDで再度この関数が呼ばれる頃には移行元が
  //   既に無く、下書きデッキ等のローカルデータが"_null"キーの下に迷子になり、
  //   二度と読み込まれなくなる（＝実質的なデータ消失）不具合があった。
  //   GUILD_IDが未確定の間は何もしない（元データにも触らない）ようにする。
  if (!GUILD_ID) return;
  try {
    if (localStorage.getItem(newKey) === null && localStorage.getItem(oldKey) !== null) {
      localStorage.setItem(newKey, localStorage.getItem(oldKey));
      localStorage.removeItem(oldKey);
    }
  } catch (e) {}
}

const STORE_KEY = `cardmaker_decks_v1_${GUILD_ID}`;
migrateGuildScopedLocalKey('cardmaker_decks_v1', STORE_KEY);
function loadDecks() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; } }
function saveDecks(d) { localStorage.setItem(STORE_KEY, JSON.stringify(d)); }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

// ── フォルダ（最大3階層・みんなで共有） ──
// フォルダの本体はサーバー（GitHub上の folders.json）に保存され、全員で共有される。
// ローカルのキャッシュは「サーバーから取得できるまでの間、即座に表示するため」だけに使う。
const FOLDER_CACHE_KEY = `cardmaker_folders_cache_v1_${GUILD_ID}`;
migrateGuildScopedLocalKey('cardmaker_folders_cache_v1', FOLDER_CACHE_KEY);
function loadFoldersCache() { try { return JSON.parse(localStorage.getItem(FOLDER_CACHE_KEY)) || []; } catch { return []; } }
function saveFoldersCache(f) { localStorage.setItem(FOLDER_CACHE_KEY, JSON.stringify(f)); }
const MAX_FOLDER_DEPTH = 3;

// ★ 「クイズ過去問」フォルダ（クイズ由来の4択アーカイブ用・システムフォルダ）。
//   固定IDはbot.py側と同じ値。名前変更・削除・移動はできず、中身は
//   フォルダの中でなら自由に作成・移動・編集できるが、外へは出せない。
const QUIZ_ARCHIVE_FOLDER_ID = "quiz_archive_root";

let folders = loadFoldersCache(); // { id, name, parentId }
let currentFolderId = null; // null = ルート

// ── ★ 追加：クイズ用デッキ選択モード（Quiz.htmlの「デッキを選ぶ」から ?pick=quiz で来た場合） ──
//   通常のデッキ一覧をそのまま使い、デッキ／フォルダをタップすると選択のON/OFFになる。
//   フォルダを選ぶとその配下（サブフォルダ含む）の全デッキをまとめて選んだことになる。
let pickMode = null;               // null | 'quiz'
let pickReturnUrl = null;          // 決定・キャンセル時に戻る先
let pickedDeckIds = new Set();     // 個別に選んだデッキの id
let pickedFolderIds = new Set();   // 丸ごと選んだフォルダの id

// ── 一覧（ホーム画面）の並び順 ──────────────
//   フォルダ・公開済みデッキの並び順は、サーバー（GitHub上の list_order.json）に
//   保存され全員で共有される。folders.json と同じく「サーバーが正で、ローカルの
//   キャッシュは届くまでの間だけ即座に表示するために使う」という考え方。
//   ─ 一方、未公開（自分だけの下書き）デッキは他人からは見えないデータなので、
//     その並び順はサーバーへは送らず、この端末だけのローカル保存にとどめる。
const LIST_ORDER_KEY = `cardmaker_list_order_v1_${GUILD_ID}`;                 // この端末で最終的に表示する並び順（共有分＋自分の下書き分）
const SHARED_ORDER_CACHE_KEY = `cardmaker_shared_order_cache_v1_${GUILD_ID}`; // サーバーから取得した「みんなの並び順」のキャッシュ
migrateGuildScopedLocalKey('cardmaker_list_order_v1', LIST_ORDER_KEY);
migrateGuildScopedLocalKey('cardmaker_shared_order_cache_v1', SHARED_ORDER_CACHE_KEY);
function loadListOrderMap() { try { return JSON.parse(localStorage.getItem(LIST_ORDER_KEY)) || {}; } catch { return {}; } }
function saveListOrderMap(m) { localStorage.setItem(LIST_ORDER_KEY, JSON.stringify(m)); }
function loadSharedOrderCache() { try { return JSON.parse(localStorage.getItem(SHARED_ORDER_CACHE_KEY)) || {}; } catch { return {}; } }
function saveSharedOrderCache(m) { localStorage.setItem(SHARED_ORDER_CACHE_KEY, JSON.stringify(m)); }
function orderScopeKey(folderId) { return folderId || '__root__'; }

let sharedOrderCache = loadSharedOrderCache(); // { [scope]: [key, ...] } ← サーバーから取得したもの

// そのキーが「みんなで共有される項目（フォルダ／公開済みデッキ）」かどうか。
// 未公開デッキは data-key に "localdeck:" というプレフィックスを付けているので判別できる。
function isSharedOrderKey(key) {
  return key.startsWith('folder:') || key.startsWith('deck:');
}

// サーバー側の並び順（sharedOrder）を、この端末のローカル並び順（localOrder）に
// 「差し込む」形でマージする。
//   ・共有項目（フォルダ／公開済みデッキ）どうしの並びは、サーバー側を正として反映する
//     → 誰か他の人が並び替えても、ここでその結果を取り込める
//   ・自分だけの下書きデッキ（localdeck:）は、これまで通りこの端末での位置を保つ
//   ・localOrderにまだ無かった新しい共有項目は末尾に追加する
function mergeSharedOrderIntoLocal(localOrder, sharedOrder) {
  if (!sharedOrder || !sharedOrder.length) return localOrder || [];
  const base = localOrder || [];
  let si = 0;
  const result = base.map(k => {
    if (!isSharedOrderKey(k)) return k; // 自分だけの下書きはそのままの位置を保つ
    if (si < sharedOrder.length) return sharedOrder[si++];
    return k;
  });
  while (si < sharedOrder.length) result.push(sharedOrder[si++]); // 新しく増えた共有項目は末尾に
  return result;
}

function getSavedListOrder(folderId) {
  const scope = orderScopeKey(folderId);
  const map = loadListOrderMap();
  const local = map[scope] || null;
  const shared = sharedOrderCache[scope];
  if (shared && shared.length) {
    const merged = mergeSharedOrderIntoLocal(local, shared);
    map[scope] = merged; // 次回以降もすぐ使えるよう、マージ結果をこの端末にも保存しておく
    saveListOrderMap(map);
    return merged.length ? merged : null;
  }
  return local;
}
// この端末で確定した並び順（共有分＋下書き分）をまるごとローカルに保存する。
function saveListOrder(folderId, keys) {
  const map = loadListOrderMap();
  map[orderScopeKey(folderId)] = keys;
  saveListOrderMap(map);
}
// items: [{key, html}] の配列。保存済みの並び順があればそれを優先して並べ替え、
// まだ並び順に登場しない新しいフォルダ・デッキ（新規作成分など）は末尾に追加する。
function applySavedListOrder(items, folderId) {
  const saved = getSavedListOrder(folderId);
  if (!saved || !saved.length) return items;
  const byKey = new Map(items.map(it => [it.key, it]));
  const result = [];
  saved.forEach(k => { const it = byKey.get(k); if (it) { result.push(it); byKey.delete(k); } });
  items.forEach(it => { if (byKey.has(it.key)) result.push(it); });
  return result;
}
// ★ 長押しして並び替えた直後、そのままタップ扱いされてフォルダが開いてしまわないための
//   ガード。endDrag() 時にタイムスタンプを記録し、直後のクリックはopenFolder側で無視する。
let cmDragJustEndedAt = 0;
// ★ 追加：ホーム画面（フォルダ・デッキ一覧）を長押しドラッグで並び替え中かどうか。
//   ドラッグ中に renderDeckListUI() が呼ばれて #deck-grid の中身が丸ごと
//   作り直されると、掴んでいた要素が新しいDOMから浮いた状態になり、
//   その後の指の動きで古い要素が新しいgridに再挿入されて「同じ項目が
//   一時的に2つ表示される」不具合が起きるため、ドラッグ中は再描画を
//   スキップするためのガードに使う。
let cmListDragActive = false;

// ★ 修正（不具合修正、2026/08/26）：study_data側（fetchAndMergeStudyData／
//   pushStudyDataToServer）で見つかったのと同じ競合が、この「みんなの並び順」
//   にも存在した。pushSharedOrderToServerがサーバーへ届く前に、10秒おきの
//   checkOrderUpdate→fetchAndMergeOrderが割り込むと、まだ更新されていない
//   古い並び順でsharedOrderCacheを丸ごと上書きしてしまい、自分がドラッグで
//   決めた並びが一瞬で元に戻って見える（＝「わからないマークが消えて見える」
//   のと同じ原因・同じ直し方）。送信中のPromiseを覚えておき、
//   fetchAndMergeOrder側でそれらの完了を待ってから取得する。
let _pendingOrderPushes = [];

// ★ サーバーから「みんなの並び順」を取得してキャッシュに反映する
async function fetchAndMergeOrder() {
  if (_pendingOrderPushes.length) {
    await Promise.allSettled(_pendingOrderPushes);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const session = getLoginSession();
  const res = await fetch(`${API_BASE}list_order?guild_id=${GUILD_ID}`, {
    signal: controller.signal, cache: 'no-store',
    headers: session?.session_token ? { 'Authorization': 'Bearer ' + session.session_token } : {},
  });
  clearTimeout(timer);
  const data = await res.json();
  if (!data.ok) return false;
  // ★ 追加：通信中に新しい並び替えが始まっていたら、この応答は古いかもしれない
  //   ので上書きせずに諦める（fetchAndMergeStudyDataと同じ考え方）。
  if (_pendingOrderPushes.length) return false;
  sharedOrderCache = data.order || {};
  saveSharedOrderCache(sharedOrderCache);
  return true;
}

// ★ この端末でドラッグして決めた並び順のうち「みんなで共有される部分」だけを
//   サーバーへ反映する（自分だけの下書きデッキの並びは送らない）。
async function pushSharedOrderToServer(folderId, keys) {
  const promise = _pushSharedOrderToServerImpl(folderId, keys);
  _pendingOrderPushes.push(promise);
  try {
    return await promise;
  } finally {
    _pendingOrderPushes = _pendingOrderPushes.filter(p => p !== promise);
  }
}
async function _pushSharedOrderToServerImpl(folderId, keys) {
  const sharedKeys = keys.filter(isSharedOrderKey);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    // ★ 複数サーバー対応でsave_orderがログイン必須になったのに合わせ、
    //   他の変更系APIと同じくguild_id/session_tokenを送るようにした
    //   （以前は認証チェック自体が無く送っていなかった）。
    const res = await fetch(`${API_BASE}save_order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guild_id: GUILD_ID,
        session_token: getLoginSession()?.session_token,
        scope: orderScopeKey(folderId),
        keys: sharedKeys,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    if (data.ok) {
      sharedOrderCache[orderScopeKey(folderId)] = sharedKeys;
      saveSharedOrderCache(sharedOrderCache);
    }
    return !!data.ok;
  } catch (e) {
    return false;
  }
}

// ★ サーバーからフォルダ一覧を取得してキャッシュに反映する
async function fetchAndMergeFolders() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  // ★ cache: 'no-store' を追加：Chromeなどが list_folders のレスポンスを
  //   ディスクキャッシュから返してしまい、他端末で作成したフォルダが
  //   即座に反映されない不具合を防ぐため、常にサーバーへ問い合わせる。
  const session = getLoginSession();
  const res = await fetch(`${API_BASE}list_folders?guild_id=${GUILD_ID}`, {
    signal: controller.signal, cache: 'no-store',
    headers: session?.session_token ? { 'Authorization': 'Bearer ' + session.session_token } : {},
  });
  clearTimeout(timer);
  const data = await res.json();
  if (!data.ok) return false;
  folders = (data.folders || []).map(f => ({ id: f.id, name: f.name, parentId: f.parent_id ?? null }));
  saveFoldersCache(folders);
  return true;
}

function folderLevel(id) {
  let lvl = 0, cur = folders.find(f => f.id === id);
  while (cur) { lvl++; cur = folders.find(f => f.id === cur.parentId); }
  return lvl;
}
function folderChildren(parentId) {
  return folders.filter(f => f.parentId === parentId)
    .slice().sort((a,b) => a.name.localeCompare(b.name, 'ja'));
}
function folderDescendants(id) {
  const direct = folders.filter(f => f.parentId === id);
  let all = [...direct];
  direct.forEach(f => { all = all.concat(folderDescendants(f.id)); });
  return all;
}
function maxLevelInSubtree(id) {
  const desc = folderDescendants(id);
  return Math.max(folderLevel(id), ...desc.map(f => folderLevel(f.id)));
}
function canMoveFolderTo(folderId, newParentId) {
  if (folderId === newParentId) return false;
  // ★「クイズ過去問」フォルダ自身は移動できない（システムフォルダ）
  if (folderId === QUIZ_ARCHIVE_FOLDER_ID) return false;
  const descIds = folderDescendants(folderId).map(f => f.id);
  if (newParentId && descIds.includes(newParentId)) return false;
  const oldLevel = folderLevel(folderId);
  const newLevel = folderLevel(newParentId) + 1;
  const shift = newLevel - oldLevel;
  if ((maxLevelInSubtree(folderId) + shift) > MAX_FOLDER_DEPTH) return false;
  // ★「クイズ過去問」フォルダの中身は、その外へ移動できない
  if (isFolderInFolderScope(folderId, QUIZ_ARCHIVE_FOLDER_ID) && !isFolderInFolderScope(newParentId, QUIZ_ARCHIVE_FOLDER_ID)) {
    return false;
  }
  return true;
}
function countDecksRecursive(folderId) {
  const direct = decks.filter(d => (d.folderId || null) === folderId).length;
  const subCount = folderChildren(folderId).reduce((sum, f) => sum + countDecksRecursive(f.id), 0);
  return direct + subCount;
}
// フォルダ配下（サブフォルダ含む）の合計カード数
function countCardsRecursive(folderId) {
  const direct = decks
    .filter(d => (d.folderId || null) === folderId)
    .reduce((sum, d) => sum + (d.filename ? (d.count ?? d.cards.length) : d.cards.length), 0);
  const subCount = folderChildren(folderId).reduce((sum, f) => sum + countCardsRecursive(f.id), 0);
  return direct + subCount;
}
// フォルダ配下（サブフォルダ含む）の「わからない」カード数の合計
// ※ カード本体が未読み込み（cardsLoaded === false）のデッキは
//    unsureセットと突き合わせる術がないので、そのデッキ分は数えない
//    （一覧を開いたときに一部のデッキがまだ未読み込みでも壊れないようにするため）
function countUnsureRecursive(folderId) {
  return collectDecksInFolder(folderId).reduce((sum, d) => {
    if (d.cardsLoaded === false) return sum;
    const unsure = getUnsureSet(d.id);
    return sum + d.cards.filter(c => unsure.has(cardKey(c))).length;
  }, 0);
}

// フォルダ配下（サブフォルダ含む）の全デッキを集める
function collectDecksInFolder(folderId) {
  const direct = decks.filter(d => (d.folderId || null) === folderId);
  const subDecks = folderChildren(folderId).reduce((arr, f) => arr.concat(collectDecksInFolder(f.id)), []);
  return [...direct, ...subDecks];
}

// ★ 追加：あるデッキ／フォルダが、指定フォルダの範囲内（サブフォルダ含む）に含まれるかどうか
//   ・folderId が null の場合は「ホーム」＝アプリ全体なので、常に範囲内とみなす
function isDeckInFolderScope(deckId, folderId) {
  if (folderId === null) return true;
  return collectDecksInFolder(folderId).some(d => d.id === deckId);
}
function isFolderInFolderScope(fid, folderId) {
  if (folderId === null) return true;
  if (fid === folderId) return true;
  return folderDescendants(folderId).some(f => f.id === fid);
}

// ★ デッキ版の canMoveFolderTo。フォルダのような階層数制限はデッキには
//   存在しない。
//   ★ 以前は「クイズ過去問フォルダの中にあるデッキは、その外へ移動できない」
//   という制限があったが、2026/08/21にユーザーの要望で撤廃した（クイズ過去問
//   デッキも他のフォルダへ移動できる。代わりに「問題の編集はできない」という
//   別の制限を設けている。openDeckMenu/save_cards参照）。
//   ★ 2026/08/25追加：逆方向の制限を新設。「クイズ過去問」フォルダ（またはその
//   配下）には、みんなでクイズの結果から自動保存されたデッキ（quizArchive）
//   以外を入れられないようにする（サーバー側 save_cards にも同じ制限を追加済み。
//   ここでの制限はUI上で選ばせない／グレーアウトさせるためのもので、直接APIを
//   叩かれた場合の最終防衛はサーバー側が担う）。
function canMoveDeckTo(deckId, targetFolderId) {
  if (isFolderInFolderScope(targetFolderId, QUIZ_ARCHIVE_FOLDER_ID)) {
    const d = decks.find(x => x.id === deckId);
    if (!d || !d.quizArchive) return false;
  }
  return true;
}

// ============================================================
//  ★ 追加：クイズ用デッキ選択モード（pickMode）
//  ─────────────────────────────────────────────
//  Quiz.html「クイズを作る」から「デッキを選ぶ」で ?pick=quiz 付きで開かれると、
//  通常のデッキ一覧の見た目のまま、デッキ／フォルダをタップして複数選択できる
//  ようになる。フォルダを選ぶと、そのフォルダ配下（サブフォルダ含む）の
//  全デッキをまとめて選んだことになる（renderDeckListUI 側の分岐で表示を切り替える）。
// ============================================================

// クイズの4択自動生成に使えるデッキかどうか（公開済み・作成中でない・カードが1枚以上ある）
function isDeckQuizPickable(d) {
  if (!d || !d.filename) return false; // 非公開（ローカル限定）デッキはサーバー側で読めないため対象外
  const isInProgress = d.notYetPublished !== false;
  if (isInProgress) return false;
  const questionCount = d.count ?? d.cards.length;
  return questionCount > 0;
}

// 指定フォルダの祖先（自分自身は含まない）に、選択済みのフォルダがあるかどうか。
// あれば「上位フォルダの選択に含まれて自動的に選ばれている」状態とみなす。
function pickFolderAncestorSelected(folderId) {
  let cur = folderId ? folders.find(f => f.id === folderId) : null;
  while (cur) {
    if (pickedFolderIds.has(cur.id)) return true;
    cur = cur.parentId ? folders.find(f => f.id === cur.parentId) : null;
  }
  return false;
}
function togglePickDeck(deckId, ev) {
  if (ev) ev.stopPropagation();
  const d = decks.find(x => x.id === deckId);
  if (!d || !isDeckQuizPickable(d)) return;
  if (pickFolderAncestorSelected(d.folderId || null)) return; // 上位フォルダ選択で自動的に含まれている
  if (pickedDeckIds.has(deckId)) pickedDeckIds.delete(deckId); else pickedDeckIds.add(deckId);
  renderDeckListUI();
}

function togglePickFolder(folderId, ev) {
  if (ev) ev.stopPropagation();
  const f = folders.find(x => x.id === folderId);
  if (!f) return;
  if (pickFolderAncestorSelected(f.parentId || null)) return; // 上位フォルダ選択で自動的に含まれている
  const hasEligibleDeck = collectDecksInFolder(folderId).some(isDeckQuizPickable);
  if (!hasEligibleDeck) return;
  if (pickedFolderIds.has(folderId)) {
    pickedFolderIds.delete(folderId);
  } else {
    pickedFolderIds.add(folderId);
    // ★ フォルダを選んだら、その配下の個別選択（デッキ・子孫フォルダ）は
    //   フォルダ選択に包含されて冗長になるので整理しておく
    collectDecksInFolder(folderId).forEach(d => pickedDeckIds.delete(d.id));
    folderDescendants(folderId).forEach(sf => pickedFolderIds.delete(sf.id));
  }
  renderDeckListUI();
}

// 現在の選択内容を、実際にクイズへ渡す「デッキ filename の一覧」に展開する
// （フォルダ選択は配下の対象デッキへ、個別選択とあわせて重複なく1つのリストにする）。
function computePickedDecks() {
  const filenameSet = new Set();
  const result = [];
  const add = d => {
    if (!isDeckQuizPickable(d) || filenameSet.has(d.filename)) return;
    filenameSet.add(d.filename);
    result.push({ filename: d.filename, name: d.name });
  };
  pickedFolderIds.forEach(fid => collectDecksInFolder(fid).forEach(add));
  pickedDeckIds.forEach(id => { const d = decks.find(x => x.id === id); if (d) add(d); });
  return result;
}

function updatePickBar() {
  const countEl = document.getElementById('pick-mode-count');
  const confirmBtn = document.getElementById('pick-mode-confirm-btn');
  if (!countEl) return;
  const picked = computePickedDecks();
  countEl.textContent = picked.length ? `${picked.length}件のデッキを選択中` : 'デッキを選んでください';
  if (confirmBtn) confirmBtn.disabled = picked.length === 0;
}

function pickModeCancel() {
  location.href = pickReturnUrl || 'Quiz.html';
}

async function pickModeConfirm() {
  const picked = computePickedDecks();
  if (!picked.length) return;
  sessionStorage.setItem('quizDeckPicker', JSON.stringify(picked));
  location.href = pickReturnUrl || 'Quiz.html?mode=host&fromPicker=1';
}

// URLの ?pick=quiz を見て選択モードを開始する（renderDeckList() で最新の
// decks/folders を取得し終えた後に呼ぶこと）
function initPickModeFromUrl() {
  const params = new URLSearchParams(location.search);
  if (params.get('pick') !== 'quiz') return;
  pickMode = 'quiz';
  pickReturnUrl = 'Quiz.html?mode=host&fromPicker=1';
  history.replaceState(null, '', location.pathname + location.hash);
  document.body.classList.add('pick-mode-active');
  document.getElementById('pick-mode-banner').style.display = 'block';
  document.getElementById('pick-mode-bar').style.display = 'flex';
  currentFolderId = null; // ホームから選び始める
  renderDeckListUI();
}

// ★ ドラッグ&ドロップの data-key（"deck:<filename>" または "localdeck:<id>"）から
//   実際のデッキidを引く共通ヘルパー（autoOpenFolderDuringDrag と同じ規則）。
function resolveDeckIdFromDragKey(key) {
  const d = key.startsWith('deck:')
    ? decks.find(x => x.filename === key.slice('deck:'.length))
    : decks.find(x => x.id === key.slice('localdeck:'.length));
  return d ? d.id : null;
}

// ★ カードをサーバー送信用のプレーンなオブジェクトに変換する共通ヘルパー。
//   announceNewDeckToServer / syncDeckToServer の両方で使う。
//   choices/correct_indices（選択式デッキのカード）が存在する場合はそれも含めて送る。
//   これを含めずに固定7フィールドだけ送ってしまうと、選択式デッキを1回でも
//   同期した瞬間に選択肢データがサーバー側から失われてしまう。
function cardToServerPayload(c) {
  const base = {
    id: c.id, question: c.question, answer: c.answer, explanation: c.explanation || '',
    imgs_q: c.imgs_q || [], imgs_a: c.imgs_a || [], imgs_e: c.imgs_e || [],
  };
  if (Array.isArray(c.choices)) {
    base.choices = c.choices;
    base.correct_indices = Array.isArray(c.correct_indices) ? c.correct_indices : [];
  }
  return base;
}

// ============================================================
//  ★ 選択式デッキ共通の「選択肢入力欄」ウィジェット
//  ─────────────────────────────────────────────
//  カード新規作成フォーム（ta-choice-rows）・カード編集モーダル
//  （modal-edit-choice-rows）の両方から、同じ prefix ベースの
//  関数群で使い回す。選択肢は2〜5個。
//  ★ 単一正解/複数正解はデッキ単位やカード単位のモード切り替えを持たず、
//    常にチェックボックスで正解を選ばせ、チェックした個数だけで自動的に
//    決まる（1個＝択一問題、2個以上＝複数回答問題）。これにより「この問題は
//    複数回答にする」という設定を問題ごとに個別に意識せずに済む。
// ============================================================
const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E'];
const CHOICE_MIN = 2;
const CHOICE_MAX = 5;

// 今 #${prefix}-rows に入力されている内容を読み出す
function readChoiceEditorState(prefix) {
  const rows = document.querySelectorAll(`#${prefix}-rows .modal-choice-row`);
  const choices = [];
  const correct = [];
  rows.forEach((row, i) => {
    choices.push(document.getElementById(`${prefix}-choice-${i}`).value);
    const inp = document.getElementById(`${prefix}-correct-${i}`);
    if (inp && inp.checked) correct.push(i);
  });
  return { choices, correct };
}

// choices/correctIdx の内容で #${prefix}-rows を描き直す
function renderChoiceEditorRows(prefix, choices, correctIdx) {
  const n = choices.length;
  const rowsHtml = choices.map((val, i) => `
    <div class="modal-choice-row" data-idx="${i}">
      <input type="checkbox" id="${prefix}-correct-${i}" value="${i}">
      <input type="text" class="modal-input" id="${prefix}-choice-${i}" placeholder="選択肢 ${CHOICE_LETTERS[i] || ''}" maxlength="80" style="margin-bottom:0">
      ${n > CHOICE_MIN ? `<button type="button" class="choice-remove-btn" data-ridx="${i}" title="この選択肢を削除">${Icons.html('close', {size:14})}</button>` : ''}
    </div>`).join('');
  const addBtnHtml = n < CHOICE_MAX
    ? `<button type="button" class="block-action-btn" id="${prefix}-add-btn" style="margin-top:.25rem">＋ 選択肢を追加</button>` : '';
  const container = document.getElementById(`${prefix}-rows`);
  container.innerHTML = rowsHtml + addBtnHtml;

  // ★ value属性への直接埋め込みはエスケープ事故（クォート等）の元になるため、
  //   空要素を描画してから .value / .checked をJSで設定する
  choices.forEach((val, i) => { document.getElementById(`${prefix}-choice-${i}`).value = val; });
  correctIdx.forEach(i => { const el = document.getElementById(`${prefix}-correct-${i}`); if (el) el.checked = true; });

  const addBtn = document.getElementById(`${prefix}-add-btn`);
  if (addBtn) addBtn.onclick = () => addChoiceRow(prefix);
  container.querySelectorAll('.choice-remove-btn').forEach(btn => {
    btn.onclick = () => removeChoiceRow(prefix, Number(btn.dataset.ridx));
  });
}

function addChoiceRow(prefix) {
  const { choices, correct } = readChoiceEditorState(prefix);
  if (choices.length >= CHOICE_MAX) return;
  choices.push('');
  renderChoiceEditorRows(prefix, choices, correct);
  document.getElementById(`${prefix}-choice-${choices.length - 1}`).focus();
}

function removeChoiceRow(prefix, idx) {
  const { choices, correct } = readChoiceEditorState(prefix);
  if (choices.length <= CHOICE_MIN) return;
  choices.splice(idx, 1);
  const newCorrect = correct.filter(i => i !== idx).map(i => i > idx ? i - 1 : i);
  renderChoiceEditorRows(prefix, choices, newCorrect);
}

// ── ログインセッション ─────────────────────
//   SESSION_KEY / getLoginSession はファイル冒頭（強制ログインチェックの
//   ところ）に定義済みなのでここでは何もしない。

let decks = loadDecks();
let currentDeckId  = null;
let menuTargetId   = null;
let imgBuf = { q:[], a:[], e:[] };
let studyCards = [], studyIdx = 0;
let studyReverse = false; // ★ 追加：問題と解答を逆にするモードかどうか
let studyAutoGrade = false; // ★ 追加：解答入力欄で自動採点するモードかどうか（反転モード時は常にfalse）
let studyMode = 'all'; // ★ 追加：'all' | 'unsure'（続きから再開時に同じ絞り込みを再現するため）
// ★ 追加：自動採点＋「4択にする」モード（みんなでクイズと同じ形式で解答する）。
//   studyChoicesMap は cardKey → {choices:[4件], correctIndex, shortlist} で、
//   デッキの解答の種類が3種類未満などで4択にできないカードは登録されない
//   （renderStudyCardがその場合だけ通常の解答入力欄にフォールバックする）。
let studyFourChoice = false;
let studyChoicesMap = new Map();
let studyChoiceAnswered = false;
let _fourChoiceAiRunToken = 0; // ★ 学習をやり直した際、古いAI問い合わせの結果が新しいセッションに混ざらないようにする

// ── 安定したカードキー生成（並び替え・サーバー同期に強い） ──
// id が無いカード（例：公開後にサーバーから取り込まれたカード）でも
// 配列のインデックスに依存せず、内容から一意なキーを作る。
function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}
function cardKey(c) {
  return c.id || ('h_' + hashStr((c.question || '') + '||' + (c.answer || '')));
}

// ============================================================
//  ★ 追加：カード保存時の重複／自己矛盾チェック
//  ─────────────────────────────────────────────
//  ・同じデッキ内に「問題文・解答」が両方とも完全一致するカードが
//    既にある場合に警告する（コピペミスなどによる二重登録の防止）。
//  ・「解答」が「問題文」や「解説」と一字一句同じ場合も、入力ミスの
//    可能性が高いので警告する。
//  ・いずれも「間違った入力を強制的にブロックする」のではなく、
//    自前の確認ダイアログ（showCmConfirm）でユーザーに知らせた上で、
//    意図的なものであればそのまま保存を続行できるようにする。
// ============================================================

// 比較用に前後の空白だけを取り除いた文字列を返す（大小文字・全半角などは変えない＝「完全一致」の判定を厳密にするため）
function normalizeForDupCheck(s) {
  return (s || '').trim();
}

// deck.cards の中に「問題文・解答」が両方とも完全一致するカードが無いか調べる。
// excludeIdx を指定すると、そのインデックスのカード自身は比較対象から除外する（編集時用）。
function findDuplicateCardIndex(deck, q, a, excludeIdx = -1) {
  if (!deck || !Array.isArray(deck.cards)) return -1;
  const nq = normalizeForDupCheck(q), na = normalizeForDupCheck(a);
  return deck.cards.findIndex((c, i) =>
    i !== excludeIdx &&
    normalizeForDupCheck(c.question) === nq &&
    normalizeForDupCheck(c.answer)   === na
  );
}

// 保存前に呼び出す：問題があれば確認ダイアログを出し、
// ユーザーが「やめる」を選んだ場合は true（＝保存を中断すべき）を返す。
async function warnIfDuplicateOrSameCard(deck, q, a, e, excludeIdx = -1) {
  const nq = normalizeForDupCheck(q), na = normalizeForDupCheck(a), ne = normalizeForDupCheck(e);

  // ① 同じ問題・答えの組み合わせが既にある
  const dupIdx = findDuplicateCardIndex(deck, q, a, excludeIdx);
  if (dupIdx !== -1) {
    const proceed = await showCmConfirm({
      title: '同じ問題と答えのカードが既にあります',
      desc: `このデッキの${dupIdx + 1}枚目と、問題文・解答が完全に一致しています。\n重複登録の可能性があります。このまま保存しますか？`,
      okLabel: 'このまま保存する', cancelLabel: '内容を確認する', okStyle: 'danger',
    });
    if (!proceed) return true;
  }

  // ② 解答が問題文と完全一致
  if (na && nq && na === nq) {
    const proceed = await showCmConfirm({
      title: '解答が問題文と完全に同じです',
      desc: '解答欄の内容が問題文と一字一句同じになっています。\n入力ミスの可能性があります。このまま保存しますか？',
      okLabel: 'このまま保存する', cancelLabel: '内容を確認する', okStyle: 'danger',
    });
    if (!proceed) return true;
  }

  // ③ 解答が解説と完全一致
  if (na && ne && na === ne) {
    const proceed = await showCmConfirm({
      title: '解答が解説と完全に同じです',
      desc: '解答欄の内容が解説欄と一字一句同じになっています。\n入力ミスの可能性があります。このまま保存しますか？',
      okLabel: 'このまま保存する', cancelLabel: '内容を確認する', okStyle: 'danger',
    });
    if (!proceed) return true;
  }

  return false;
}

// ============================================================
//  自前のダイアログUI（デバイスのOS/ブラウザ標準の confirm() を使わない）
//  ─────────────────────────────────────────────
//  Cardmaker.css の既存クラス（.modal-overlay / .modal-sheet / .modal-handle /
//  .modal-title / .modal-btns / .btn-* / .play-mode-item など）をそのまま
//  流用して動的にモーダルを生成するので、新規CSSを追加せずに他のモーダルと
//  完全に同じ見た目・アニメーションになる。端末やブラウザに依存しない。
// ============================================================

// 選択肢が2つの確認ダイアログ（キャンセル + 実行）。confirm()の代替。
// okStyle: 'blue' | 'danger' | 'outline'（既存のbtnクラスに対応）
function showCmConfirm({ title, desc = '', okLabel = 'OK', cancelLabel = 'キャンセル', okStyle = 'blue' }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-handle"></div>
        <div class="modal-title">${esc(title)}</div>
        ${desc ? `<div style="font-size:13px;color:var(--text-secondary);margin:-.5rem 0 1rem;line-height:1.6;white-space:pre-line">${esc(desc)}</div>` : ''}
        <div class="modal-btns">
          <button type="button" class="btn btn-ghost" data-val="0">${esc(cancelLabel)}</button>
          <button type="button" class="btn btn-${okStyle}" data-val="1">${esc(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    function finish(value) {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 180);
      resolve(value);
    }
    overlay.querySelectorAll('[data-val]').forEach(btn => {
      btn.addEventListener('click', () => finish(btn.dataset.val === '1'));
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) finish(false); });
  });
}

// ボタン1つだけの通知ダイアログ。alert()の代替。
function showCmAlert({ title, desc = '', okLabel = '閉じる' }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-handle"></div>
        <div class="modal-title">${esc(title)}</div>
        ${desc ? `<div style="font-size:13px;color:var(--text-secondary);margin:-.5rem 0 1rem;line-height:1.6;white-space:pre-line">${esc(desc)}</div>` : ''}
        <div class="modal-btns">
          <button type="button" class="btn btn-blue" data-val="1" style="flex:1">${esc(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    function finish() {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 180);
      resolve(true);
    }
    overlay.querySelector('[data-val]').addEventListener('click', finish);
    overlay.addEventListener('click', e => { if (e.target === overlay) finish(); });
  });
}

// 3つ以上の選択肢から選ぶダイアログ（modal-play-mode と同じ見た目）。
// choices: [{ icon, label, sub, value }]。キャンセル時は null を返す。
function showCmChoiceDialog({ title, desc = '', choices, cancelLabel = 'キャンセル' }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-handle"></div>
        <div class="modal-title">${esc(title)}</div>
        ${desc ? `<div style="font-size:13px;color:var(--text-secondary);margin:-.5rem 0 1rem;line-height:1.6;white-space:pre-line">${esc(desc)}</div>` : ''}
        ${choices.map((c, i) => `
          <div class="play-mode-item" data-idx="${i}">
            <span class="play-mode-icon">${c.icon || ''}</span>
            <div>
              <div>${esc(c.label)}</div>
              ${c.sub ? `<div class="play-mode-sub">${esc(c.sub)}</div>` : ''}
            </div>
          </div>`).join('')}
        <div class="modal-btns" style="margin-top:.5rem">
          <button type="button" class="btn btn-ghost" data-cancel style="flex:1">${esc(cancelLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    function finish(value) {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 180);
      resolve(value);
    }
    overlay.querySelectorAll('[data-idx]').forEach(el => {
      el.addEventListener('click', () => finish(choices[+el.dataset.idx].value));
    });
    overlay.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
    overlay.addEventListener('click', e => { if (e.target === overlay) finish(null); });
  });
}

// ── ルーター ──────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  window.scrollTo(0, 0);
  if (id === 'list') {
    decks = loadDecks();
    folders = loadFoldersCache();
    sharedOrderCache = loadSharedOrderCache();
    renderDeckListUI();
    setTimeout(() => renderDeckList(), 0);
  }
}

// ── デッキ一覧 ────────────────────────
function renderDeckListUI() {
  // ★ 追加：フォルダ/デッキを長押しドラッグ中は #deck-grid を再生成しない。
  //   （バックグラウンドポーリングなどからここが呼ばれてDOMが作り直されると、
  //   ドラッグ中の要素が新しいDOMから浮いてしまい、その後の指の動きで
  //   古い要素が再挿入されて項目が2つ表示されてしまうため）
  //   ドラッグ終了後、次のポーリング（最大10秒後）で最新状態に更新される。
  if (cmListDragActive) return;
  // 表示中のフォルダが（他端末での削除などで）無くなっていたらルートに戻す
  if (currentFolderId && !folders.find(f => f.id === currentFolderId)) currentFolderId = null;

  renderBreadcrumb();
  renderInProgressUI(); // ★ 追加：ホームにプレイ中（続きから再開できる）デッキ・フォルダを表示

  // ★ 追加：初回描画が終わったので、JS読み込み前用の静的スケルトンを消す
  const skeleton = document.getElementById('deck-skeleton');
  if (skeleton) skeleton.style.display = 'none';

  const grid  = document.getElementById('deck-grid');
  const empty = document.getElementById('deck-list-empty');

  const childFolders = folderChildren(currentFolderId);
  const childDecks   = decks.filter(d => (d.folderId || null) === currentFolderId);

  if (!childFolders.length && !childDecks.length) {
    grid.style.display='none'; empty.style.display='block';
    document.getElementById('deck-list-empty-text').textContent =
      currentFolderId ? 'このフォルダにはまだ何もありません' : 'まだデッキがありません';
    if (pickMode) updatePickBar();
    return;
  }
  empty.style.display='none'; grid.style.display='flex';

  const folderItems = childFolders.map(f => {
  const cnt = countDecksRecursive(f.id);
  const totalCards = countCardsRecursive(f.id);
  const unsureCount = countUnsureRecursive(f.id);              // ★ 追加
  const isLoadingThisFolder = loadingFolderIds.has(f.id);
  const folderPlayDisabled = totalCards === 0 || isLoadingThisFolder;
  const folderUnsureBadge = unsureCount > 0                     // ★ 追加
    ? `<span class="unsure-badge">${Icons.cmHtml('bookmark', {size:13})} ${unsureCount}</span>` : '';

  // ★ 追加：クイズ用デッキ選択モードでは、通常のプレイ/メニューボタンの代わりに
  //   チェックボックスを出す。フォルダ本体をタップすれば中を見に行けるのはそのまま。
  if (pickMode) {
    const eligibleCount = collectDecksInFolder(f.id).filter(isDeckQuizPickable).length;
    const impliedByAncestor = pickFolderAncestorSelected(f.parentId || null);
    const disabled = eligibleCount === 0 || impliedByAncestor;
    const checked = pickedFolderIds.has(f.id) || impliedByAncestor;
    const cbClass = disabled ? 'pick-checkbox disabled' : checked
      ? (pickedFolderIds.has(f.id) ? 'pick-checkbox checked' : 'pick-checkbox implied') : 'pick-checkbox';
    return { key: `folder:${f.id}`, html: `
  <div class="deck-card folder-card${disabled && !checked ? ' pick-disabled' : ''}" data-key="folder:${f.id}" onclick="openFolder('${f.id}')">
    <div class="${cbClass}" onclick="togglePickFolder('${f.id}', event)">${checked ? Icons.html('check', {size:12}) : ''}</div>
    <div class="deck-card-info">
      <div class="deck-card-title">${Icons.cmHtml('folder', {size:15})} ${esc(f.name)}</div>
      <div class="deck-card-meta">${eligibleCount > 0 ? `${eligibleCount} デッキが対象` : '対象にできるデッキがありません'}${folderUnsureBadge}</div>
    </div>
  </div>` };
  }

  return { key: `folder:${f.id}`, html: `
  <div class="deck-card folder-card" data-key="folder:${f.id}" onclick="openFolder('${f.id}')">
    <div class="deck-card-info">
      <div class="deck-card-title">${Icons.cmHtml('folder', {size:15})} ${esc(f.name)}</div>
      <div class="deck-card-meta">${cnt} デッキ・${totalCards} 問${folderUnsureBadge}</div>
    </div>
    <div class="deck-card-actions">
      <button class="btn btn-blue btn-sm" onclick="event.stopPropagation();openFolderPlayMode('${f.id}')"
        ${folderPlayDisabled?'disabled':''}>${isLoadingThisFolder ? '読み込み中…' : '▶ プレイ'}</button>
      <button class="icon-btn" onclick="event.stopPropagation();openFolderMenu('${f.id}')" title="メニュー">${Icons.html('edit', {size:14})}</button>
    </div>
  </div>` };
});
  // ★ 非公開・公開のグループ位置はそのまま、各グループ内だけ新しい順（下が古い）に反転
  //   （※ ユーザーが手で並び替えた後は、下の applySavedListOrder() がこの初期順を上書きする）
  const unpublished = childDecks.filter(d => !d.filename).slice().reverse();
  const published    = childDecks.filter(d =>  d.filename).slice().reverse();
  const orderedDecks = [...unpublished, ...published];

  const deckItems = orderedDecks.map(d => {
    // ★ カード本体を未読み込みのデッキ（公開デッキで cardsLoaded=false）は
    //   d.cards が空のままなので、「わからない」バッジは読み込み後にしか出せない。
    //   ここでは読み込み済みの場合だけ計算する。
    let unsureBadge = '';
    if (d.cardsLoaded !== false) {
      const unsureSet   = getUnsureSet(d.id);
      const unsureCount = d.cards.filter(c => unsureSet.has(cardKey(c))).length;
      unsureBadge = unsureCount > 0 ? `<span class="unsure-badge">${Icons.cmHtml('bookmark', {size:13})} ${unsureCount}</span>` : '';
    }
    // ★ 問題数は常にサーバー側の count（軽量メタ情報）を優先して表示する。
    //   d.cards はカード本体が未読み込みの間は空配列なので、そちらを見てはいけない。
    //   （pubBadge の判定でも使うため、先に計算しておく）
    const questionCount = d.filename ? (d.count ?? d.cards.length) : d.cards.length;
    // ★ 公開状態バッジ：作成中／非公開／公開済み／未完成 のいずれか1つだけを表示する。
    //   （以前は「公開済み」と「未完成」を別々のバッジとして両方表示していたが、
    //   分かりにくいので同じ場所に1つだけ出すよう統合した）
    //   ★ 修正：以前は「サーバー登録済み・カード0枚」の場合だけを「作成中」と判定していたため、
    //     まだ一度も「公開して保存」（＝完成／未完成の選択）を経ていないデッキでも、
    //     ただの「保存」ボタンでカードを追加しただけで questionCount>0 になった途端に
    //     「未完成」バッジへ変わってしまっていた（＝「保存しただけなのに未完成と表示される」不具合）。
    //     ここでは d.notYetPublished（＝一度も明示的な「公開して保存」を経ていないかどうか）を
    //     カード枚数に関係なく最優先で判定し、以下の3段階に整理する。
    //     ・「保存」ボタンを押しただけ（公開フローを一度も経ていない）　　　　→ 常に「作成中」
    //     ・「公開して保存」で「未完成として公開する」を選んだことがある　　　→ 「未完成」
    //     ・「公開して保存」で「完成として公開する」を選んだ（その後の状態） → 「公開済み」
    const pubBadge = !d.filename
      ? (d.planPublish !== false
          ? `<span class="pub-badge inprogress">${Icons.html('dot', {size:13})} 作成中</span>`
          : `<span class="pub-badge local">${Icons.html('dot', {size:13})} 非公開</span>`)
      : (d.notYetPublished !== false)
        ? `<span class="pub-badge inprogress">${Icons.html('dot', {size:13})} 作成中${d.published_by ? `（${esc(d.published_by)}）` : ''}</span>`
        : d.incomplete
          ? `<span class="pub-badge draft">${Icons.html('dot', {size:13})} 未完成${d.published_by ? `（${esc(d.published_by)}）` : ''}</span>`
          : `<span class="pub-badge published">${Icons.html('dot', {size:13})} 公開済み${d.published_by ? `（${esc(d.published_by)}）` : ''}</span>`;
    // ★ クイズ過去問デッキだと分かるようにバッジを付ける（プレイ時の挙動が通常の
    //   フラッシュカードと違う＝一人用選択式モードになるため。編集もできない）。
    //   ★ 修正（2026/08/21）：以前はフォルダの位置（isDeckInFolderScope）で判定して
    //   いたが、他のフォルダへ移動できるようにしたのに合わせ、デッキ自身が持つ
    //   quizArchiveフラグ（フォルダを移動しても消えない）で判定するよう変更した。
    //   バッジの文言も「過去問」→「クイズ過去問」に変更（フォルダ名と揃えた）。
    const quizArchiveBadge = d.quizArchive
      ? `<span class="pub-badge archive">${Icons.html('dot', {size:13})} クイズ過去問</span>` : '';
    // ★ 追加：多肢選択デッキ（choiceMode有り）にも、同じ理由で分かるようにバッジを付ける
    //   （「クイズ過去問」フォルダの中でなくてもプレイ時は一人用選択式モードになるため）
    //   ★ quizArchiveBadge と意味が重複するため、そちらが出る場合はこちらは出さない。
    //   ★ 単一/複数は問題ごとに違いうるためデッキ単位では区別せず、常に「選択式」とだけ表示する。
    const choiceModeBadge = (!quizArchiveBadge && d.choiceMode)
      ? `<span class="pub-badge archive">${Icons.html('dot', {size:13})} 選択式</span>` : '';
    // ★ カード本体が未読み込みの間、プレイ／編集ボタンを押した瞬間に
    //   ネットワーク取得が走ることをユーザーに知らせるためのローディング表示。
    const isLoadingThis = loadingDeckIds.has(d.id);
    // ★ 追加：「作成中」（＝まだ一度も公開して保存していない）状態のデッキはプレイできないようにする。
    //   編集（openEditDeck / openDeckMenu）はこのフラグを見ないので、作成中でも引き続き編集は可能。
    const isInProgress = !d.filename ? (d.planPublish !== false) : (d.notYetPublished !== false);
    const playDisabled = questionCount === 0 || isLoadingThis || isInProgress;
    // ★ 科目名をタイトルの上に小さく表示する。表示名側に重複しないよう、
    //   デッキ名の先頭に「科目名 」が含まれる場合はそれを取り除いて表示する。
    const subjectLabel = d.subject
      ? `<div class="deck-card-subject">${esc(d.subject)}</div>` : '';
    const displayName = (d.subject && d.name.startsWith(d.subject + ' '))
      ? d.name.slice(d.subject.length + 1) : d.name;
    // ★ 並び順のキー：公開済みデッキは全員が同じ filename を持つので、それを共有キーにする。
    //   未公開（自分だけの下書き）デッキは他人には見えないデータなので、他の端末とは
    //   絶対に一致しないローカル専用キー（localdeck:）にし、サーバーには送らない。
    const orderKey = d.filename ? `deck:${d.filename}` : `localdeck:${d.id}`;

    // ★ 追加：クイズ用デッキ選択モードでは、プレイ/メニューボタンの代わりに
    //   カード全体をタップして選択できるチェックボックスUIにする。
    if (pickMode) {
      const eligible = isDeckQuizPickable(d);
      const impliedByAncestor = pickFolderAncestorSelected(d.folderId || null);
      const disabled = !eligible || impliedByAncestor;
      const checked = pickedDeckIds.has(d.id) || impliedByAncestor;
      const cbClass = disabled ? 'pick-checkbox disabled' : (checked ? 'pick-checkbox checked' : 'pick-checkbox');
      const ineligibleNote = !eligible
        ? `<div class="deck-card-note-ineligible">クイズには使えません（非公開・作成中のデッキ）</div>` : '';
      return { key: orderKey, html: `
    <div class="deck-card${disabled && !checked ? ' pick-disabled' : ''}" data-key="${orderKey}" onclick="togglePickDeck('${d.id}', event)">
      <div class="${cbClass}">${checked ? Icons.html('check', {size:12}) : ''}</div>
      <div class="deck-card-info">
        ${subjectLabel}
        <div class="deck-card-title">${esc(displayName)}</div>
        <div class="deck-card-meta">
          ${questionCount} 問
          ${pubBadge}
          ${quizArchiveBadge}
          ${choiceModeBadge}
          ${unsureBadge}
        </div>
        ${ineligibleNote}
      </div>
    </div>` };
    }

    return { key: orderKey, html: `
    <div class="deck-card" data-key="${orderKey}">
      <div class="deck-card-info">
        ${subjectLabel}
        <div class="deck-card-title">${esc(displayName)}</div>
        <div class="deck-card-meta">
          ${questionCount} 問
          ${pubBadge}
          ${quizArchiveBadge}
          ${choiceModeBadge}
          ${unsureBadge}
        </div>
      </div>
      <div class="deck-card-actions">
        <button class="btn btn-blue btn-sm" onclick="openPlayMode('${d.id}')"
          ${playDisabled?'disabled':''}>${isLoadingThis ? '読み込み中…' : '▶ プレイ'}</button>
        <button class="icon-btn" onclick="openDeckMenu('${d.id}')" title="メニュー" ${isLoadingThis?'disabled':''}>${Icons.html('edit', {size:14})}</button>
      </div>
    </div>` };
  });

  // ★ フォルダ・デッキを合わせ、保存済みの並び順（ユーザーがドラッグして決めた順）があれば適用する
  const combinedItems = applySavedListOrder([...folderItems, ...deckItems], currentFolderId);
  // ★ 追加：最終防御として、万一同じキー（＝同じデッキ／フォルダ）が
  //   何らかの理由で2件並んでしまっていても、ここで必ず1件だけに絞ってから描画する。
  //   （並び順マージ処理などに未知の不具合があっても、画面上の「見た目の複製」だけは常に防げるようにする）
  const seenKeys = new Set();
  const dedupedItems = combinedItems.filter(it => {
    if (seenKeys.has(it.key)) return false;
    seenKeys.add(it.key);
    return true;
  });
  grid.innerHTML = dedupedItems.map(it => it.html).join('');
  if (pickMode) updatePickBar();
}

// ── パンくずリスト ────────────────────
function renderBreadcrumb() {
  const bar = document.getElementById('folder-breadcrumb');
  if (!currentFolderId) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  const chain = [];
  let cur = folders.find(f => f.id === currentFolderId);
  while (cur) { chain.unshift(cur); cur = folders.find(f => f.id === cur.parentId); }
  bar.style.display = 'flex';
  bar.innerHTML = `<span class="crumb" onclick="openFolder(null)">${Icons.html('home', {size:14})} ホーム</span>` +
    chain.map(f => `<span class="crumb-sep">/</span><span class="crumb" onclick="openFolder('${f.id}')">${esc(f.name)}</span>`).join('');
}

// ★ フォルダの通し名（パンくずと同じ辿り方）を「/」区切りの文字列にして返す。
//   検索画面で「今どこを検索しているか」を表示するのに使う。null＝ホーム全体。
function folderPathLabel(folderId) {
  if (!folderId) return null;
  const chain = [];
  let cur = folders.find(f => f.id === folderId);
  while (cur) { chain.unshift(cur); cur = folders.find(f => f.id === cur.parentId); }
  return chain.map(f => f.name).join(' / ');
}

// ============================================================
//  ★ 単語検索（screen-search）は Cardmaker-search.js に分離した
//  ─────────────────────────────────────────────
//  一覧の初期表示には不要な機能なので、実体は別ファイルに移し、
//  loadChunksInBackground()（後述）が初期表示後にバックグラウンドで
//  読み込む。ここに残す openSearchScreen / onSearchInput は、HTML側の
//  onclick/oninput から直接呼ばれる入口（Cardmaker.html）が、万一まだ
//  読み込みが間に合っていないタイミングで呼ばれても壊れないための
//  薄いプロキシ。チャンク読み込みが終わると同名の本物の関数で
//  上書きされるので、これらのプロキシは実質「読み込みを待つだけ」になる。
async function openSearchScreen() {
  await loadChunkWithFeedback('search', '/Cardmaker-search.js');
  return openSearchScreen(); // ★ この時点では本物の実装に差し替わっている
}
function onSearchInput() {
  loadChunk('search', '/Cardmaker-search.js').then(() => onSearchInput());
}

// ── プレイ中（続きから再開できる）デッキ・フォルダ ────────────────────
//   ★ 追加：localStorage に保存されている学習進捗（cm_progress_deck_ / cm_progress_folder_）を
//     すべて拾い出し、まだ存在するデッキ・フォルダに紐づくものだけを表示する。
//   scopeFolderId: 表示範囲。null ならホーム（アプリ全体）、フォルダidならそのフォルダ配下（サブフォルダ含む）のみ。
function getInProgressItems(scopeFolderId) {
  const items = [];
  for (const key of Object.keys(studyDataCache.progress)) {
    let isFolder, id;
    if (key.startsWith('deck:'))        { isFolder = false; id = key.slice('deck:'.length); }
    else if (key.startsWith('folder:')) { isFolder = true;  id = key.slice('folder:'.length); }
    else continue;

    const data = loadStudyProgress(isFolder, id);
    if (!data) continue; // 壊れている・空のデータは無視

    if (isFolder) {
      const folder = folders.find(f => f.id === id);
      if (!folder) continue; // フォルダが削除済みなら無視
      if (!isFolderInFolderScope(id, scopeFolderId)) continue; // ★ 表示範囲外なら除外
      items.push({ isFolder: true, id, name: folder.name, subject: '', icon: Icons.cmHtml('folder', {size:16}),
        idx: data.idx, total: data.order.length, updatedAt: data.updatedAt || 0 });
    } else {
      const deck = decks.find(d => d.id === id);
      if (!deck) continue; // デッキが削除済みなら無視
      if (!isDeckInFolderScope(id, scopeFolderId)) continue; // ★ 表示範囲外なら除外
      // ★ デッキ一覧のカードと同じく、科目名をタイトルの上に分けて表示する
      const displayName = (deck.subject && deck.name.startsWith(deck.subject + ' '))
        ? deck.name.slice(deck.subject.length + 1) : deck.name;
      items.push({ isFolder: false, id, name: displayName, subject: deck.subject || '', icon: Icons.html('cardmaker', {size:16}),
        idx: data.idx, total: data.order.length, updatedAt: data.updatedAt || 0 });
    }
  }
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const recentItems = items.filter(it => (now - it.updatedAt) <= ONE_WEEK_MS); // ★ 追加：直近1週間以内にプレイしたものだけに絞る
  recentItems.sort((a, b) => b.updatedAt - a.updatedAt); // 新しく学習していた順
  return recentItems;
}

function renderInProgressUI() {
  const section = document.getElementById('inprogress-section');
  const scroll  = document.getElementById('inprogress-scroll');
  if (section && scroll) {
    // ★ ホームでは全体、フォルダ内ではそのフォルダ配下（サブフォルダ含む）だけに絞って表示する
    const items = getInProgressItems(currentFolderId);
    if (!items.length) {
      section.style.display = 'none'; scroll.innerHTML = '';
    } else {
      section.style.display = 'block';
      scroll.innerHTML = items.map(it => {
        const pct = Math.max(0, Math.min(100, Math.round(((it.idx) / it.total) * 100)));
        return `
        <div class="inprogress-card" onclick="resumeFromHome(${it.isFolder}, '${it.id}')">
          ${it.subject ? `<div class="inprogress-subject">${esc(it.subject)}</div>` : ''}
          <div class="inprogress-title">${it.icon} ${esc(it.name)}</div>
          <div class="inprogress-meta">${it.idx + 1} / ${it.total} 問</div>
          <div class="inprogress-bar-track"><div class="inprogress-bar-fill" style="width:${pct}%"></div></div>
          <div class="inprogress-resume-btn">▶️ 続きから</div>
        </div>`;
      }).join('');
    }
  }
  renderCompletedUI(); // ★ 追加：プレイ済み（完了）欄も同時に更新する
}

// ── プレイ済み（完了した）デッキ・フォルダ ────────────────────
//   ★ 追加：localStorage に保存されている完了記録（cm_completed_deck_ / cm_completed_folder_）を
//     すべて拾い出し、まだ存在するデッキ・フォルダに紐づく直近1週間以内のものだけを表示する。
//   scopeFolderId: 表示範囲。null ならホーム（アプリ全体）、フォルダidならそのフォルダ配下（サブフォルダ含む）のみ。
function getCompletedItems(scopeFolderId) {
  const items = [];
  for (const key of Object.keys(studyDataCache.completed)) {
    let isFolder, id;
    if (key.startsWith('deck:'))        { isFolder = false; id = key.slice('deck:'.length); }
    else if (key.startsWith('folder:')) { isFolder = true;  id = key.slice('folder:'.length); }
    else continue;

    const data = loadCompletionRecord(isFolder, id);
    if (!data) continue; // 壊れている・空のデータは無視

    if (isFolder) {
      const folder = folders.find(f => f.id === id);
      if (!folder) continue; // フォルダが削除済みなら無視
      if (!isFolderInFolderScope(id, scopeFolderId)) continue; // ★ 表示範囲外なら除外
      items.push({ isFolder: true, id, name: folder.name, subject: '', icon: Icons.cmHtml('folder', {size:16}),
        total: data.total, completedAt: data.completedAt });
    } else {
      const deck = decks.find(d => d.id === id);
      if (!deck) continue; // デッキが削除済みなら無視
      if (!isDeckInFolderScope(id, scopeFolderId)) continue; // ★ 表示範囲外なら除外
      // ★ デッキ一覧のカードと同じく、科目名をタイトルの上に分けて表示する
      const displayName = (deck.subject && deck.name.startsWith(deck.subject + ' '))
        ? deck.name.slice(deck.subject.length + 1) : deck.name;
      items.push({ isFolder: false, id, name: displayName, subject: deck.subject || '', icon: Icons.html('cardmaker', {size:16}),
        total: data.total, completedAt: data.completedAt });
    }
  }
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const recentItems = items.filter(it => (now - it.completedAt) <= ONE_WEEK_MS); // ★ 直近1週間以内に完了したものだけ
  recentItems.sort((a, b) => b.completedAt - a.completedAt); // 新しく完了した順
  return recentItems;
}

function renderCompletedUI() {
  const section = document.getElementById('completed-section');
  const scroll  = document.getElementById('completed-scroll');
  if (!section || !scroll) return;

  // ★ ホームでは全体、フォルダ内ではそのフォルダ配下（サブフォルダ含む）だけに絞って表示する
  const items = getCompletedItems(currentFolderId);
  if (!items.length) { section.style.display = 'none'; scroll.innerHTML = ''; return; }

  section.style.display = 'block';
  scroll.innerHTML = items.map(it => `
    <div class="completed-card" onclick="replayFromHome(${it.isFolder}, '${it.id}')">
      ${it.subject ? `<div class="completed-subject">${esc(it.subject)}</div>` : ''}
      <div class="completed-title">${it.icon} ${esc(it.name)}</div>
      <div class="completed-meta">${Icons.html('checkCircle', {size:14})} ${it.total} 問 完了</div>
      <div class="completed-replay-btn">${Icons.html('refresh', {size:14})} もう一度プレイ</div>
    </div>`).join('');
}

// ★ 追加：ホーム画面の「プレイ済み」カードをタップしたときに、
//   完了済みなので「続きから」ではなく、通常のプレイモード選択（すべて／わからないだけ等）を開く。
async function replayFromHome(isFolder, id) {
  if (isFolder) {
    await openFolderPlayMode(id);
  } else {
    await openPlayMode(id);
  }
}

// ★ 追加：ホーム画面の「プレイ中のデッキ」カードをタップしたときに、
//   プレイモード選択（すべて／わからないだけ／続きから）を経由せず、
//   直接「続きから」の状態でそのまま学習画面を開く。
async function resumeFromHome(isFolder, id) {
  if (isFolder) {
    const folder = folders.find(f => f.id === id);
    const targetDecks = collectDecksInFolder(id)
      .filter(d => (d.filename ? (d.count ?? d.cards.length) : d.cards.length) > 0);
    if (!targetDecks.length) return;

    loadingFolderIds.add(id);
    renderDeckListUI();
    // ★ プレイ開始時は毎回サーバーの最新カードを取りに行く（force=true）。
    //   キャッシュ済み（cardsLoaded=true）のまま開くと、他の人が直した最新の
    //   修正内容がプレイ画面に反映されない＝「もう直っていたのに気づかず
    //   重複して編集してしまう」事故につながるため。
    // ★ 修正：保留中のサーバー同期を待たずに強制リロードすると、同期前の
    //   古い内容（最悪カード0枚）で上書きされてしまうため、先に待ち合わせる。
    await Promise.all(targetDecks.map(d => waitForPendingSync(d.id)));
    const results = await Promise.all(targetDecks.map(d => ensureDeckCardsLoaded(d.id, true)));
    loadingFolderIds.delete(id);
    renderDeckListUI();

    if (results.some(r => !r.ok)) {
      await showCmAlert({ title: '読み込みに失敗しました', desc: '通信環境を確認してもう一度お試しください。' });
      return;
    }
    folderPlayDecks = targetDecks;
    studyIsFolder = true;
    studyFolderId = id;
    studyDeckId = null;
  } else {
    const deck = decks.find(d => d.id === id);
    if (!deck) return;

    loadingDeckIds.add(id);
    renderDeckListUI();
    // ★ プレイ開始時は毎回サーバーの最新カードを取りに行く（force=true）。理由は上と同じ。
    // ★ 修正：保留中のサーバー同期を待たずに強制リロードすると、同期前の
    //   古い内容（最悪カード0枚）で上書きされてしまうため、先に待ち合わせる。
    await waitForPendingSync(id);
    const result = await ensureDeckCardsLoaded(id, true);
    loadingDeckIds.delete(id);
    renderDeckListUI();

    if (!result.ok) {
      await showCmAlert({ title: '読み込みに失敗しました', desc: '通信環境を確認してもう一度お試しください。' });
      return;
    }
    studyIsFolder = false;
    studyDeckId = id;
  }
  startStudyMode('resume');
}

// ── フォルダ間の移動 ──────────────────
function openFolder(id) {
  // ★ 一覧の並び替え（長押しドラッグ）を終えた直後のタップは無視する
  //   （指を離した瞬間に発生するクリックで、意図せずフォルダが開いてしまうのを防ぐ）
  if (Date.now() - cmDragJustEndedAt < 300) return;
  currentFolderId = id;
  renderDeckListUI();
  const body = document.querySelector('#screen-list .cm-scroll-body');
  if (body) body.scrollTop = 0;
}

// ── 追加（デッキ / フォルダ）の選択 ─────
function openAddChoice() { openModal('modal-add-choice'); }
function chooseNewDeck() { closeModal('modal-add-choice'); openNewSet(); }
async function chooseNewFolder() {
  closeModal('modal-add-choice');
  if (folderLevel(currentFolderId) >= MAX_FOLDER_DEPTH) {
    await showCmAlert({
      title: 'フォルダを作成できません',
      desc: `フォルダは${MAX_FOLDER_DEPTH}階層までしか作成できません。`,
    });
    return;
  }
  openFolderNameModal('create', null);
}

// ── フォルダ名の入力（新規作成 / 名前変更） ─
let folderNameMode = 'create'; // 'create' | 'rename'
let folderNameTargetId = null;

function openFolderNameModal(mode, folderId) {
  folderNameMode = mode;
  folderNameTargetId = folderId;
  const input = document.getElementById('folder-name-input');
  document.getElementById('folder-name-modal-title').textContent =
    mode === 'rename' ? 'フォルダ名を変更' : '新しいフォルダ';
  input.value = mode === 'rename' ? (folders.find(f => f.id === folderId)?.name || '') : '';
  openModal('modal-folder-name');
  setTimeout(() => input.focus(), 150);
}

async function saveFolderName() {
  const input = document.getElementById('folder-name-input');
  const name = input.value.trim();
  if (!name) { shake('folder-name-input'); return; }
  if (await warnIfBugChars(name, 'folder-name-input')) return;

  const btn = document.querySelector('#modal-folder-name .btn-blue');
  const targetFolder = folderNameMode === 'rename' ? folders.find(f => f.id === folderNameTargetId) : null;
  const body = {
    guild_id: GUILD_ID,
    session_token: getLoginSession()?.session_token, // ★ 追加：変更にはログイン必須
    name,
    parent_id: folderNameMode === 'rename' ? (targetFolder ? targetFolder.parentId : null) : currentFolderId,
    nickname: getLoginSession()?.nickname, // ★ 追加：運用ログの実行者表示用
  };
  if (folderNameMode === 'rename') body.id = folderNameTargetId;

  setBtnLoading(btn, true, '保存中…'); // ★ 修正：単なるdisabledだけでなくスピナーで「処理中」を明示する
  try {
    const res = await fetch(`${API_BASE}save_folder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '不明なエラー');
    await fetchAndMergeFolders();
    closeModal('modal-folder-name');
    renderDeckListUI();
  } catch(e) {
    await showCmAlert({ title: 'フォルダの保存に失敗しました', desc: e.message });
  } finally {
    setBtnLoading(btn, false);
  }
}

// ── フォルダメニュー ───────────────────
let folderMenuTargetId = null;
function openFolderMenu(id) {
  folderMenuTargetId = id;
  const f = folders.find(x => x.id === id);
  document.getElementById('folder-menu-name').textContent = f ? f.name : '';
  // ★「クイズ過去問」フォルダ自身はシステムフォルダなので、改名・移動・削除の
  //   操作項目を隠し、代わりに説明だけ表示する（中身の操作は制限しない）。
  const isLocked = id === QUIZ_ARCHIVE_FOLDER_ID;
  document.getElementById('folder-menu-locked-note').style.display = isLocked ? '' : 'none';
  document.getElementById('folder-menu-rename-item').style.display = isLocked ? 'none' : '';
  document.getElementById('folder-menu-move-item').style.display   = isLocked ? 'none' : '';
  document.getElementById('folder-menu-delete-item').style.display = isLocked ? 'none' : '';
  openModal('modal-folder-menu');
}
function folderMenuRename() { closeModal('modal-folder-menu'); openFolderNameModal('rename', folderMenuTargetId); }
function folderMenuMove()   { closeModal('modal-folder-menu'); openMovePicker('folder', folderMenuTargetId); }

async function folderMenuDelete() {
  closeModal('modal-folder-menu');
  const folder = folders.find(f => f.id === folderMenuTargetId);
  if (!folder) return;

  const descIds = folderDescendants(folder.id).map(f => f.id);
  const allFolderIds = [folder.id, ...descIds];
  const targetDecks = decks.filter(d => allFolderIds.includes(d.folderId || null));

  const desc = (targetDecks.length || descIds.length)
    ? `「${folder.name}」を削除すると、中にあるサブフォルダ ${descIds.length} 個とデッキ ${targetDecks.length} 個もすべて削除されます。`
    : `「${folder.name}」を削除しますか？`;
  const ok = await showCmConfirm({
    title: 'フォルダを削除しますか？', desc, okLabel: '削除する', okStyle: 'danger',
  });
  if (!ok) return;

  // 公開済みデッキはサーバー側からも削除する。ただし作成者本人以外の
  // デッキが混ざっている場合、そのデッキだけはサーバー側でブロックされる
  // （creator_approval_required）。以前はこのレスポンスを見ずに常に
  // フォルダ本体まで削除してしまい、「フォルダは消えたのに中の他人の
  // デッキだけ孤立して残る」という不整合が起きていた。1つでもブロック
  // されたら、フォルダ自体の削除も含めて中断する（既に削除できた分だけは
  // ローカルにも反映する）。
  const deletedDecks = [];
  const blockedDecks = [];
  for (const d of targetDecks) {
    if (!d.filename) { deletedDecks.push(d); continue; } // 非公開（ローカルのみの下書き）はそのまま対象
    try {
      const res = await fetch(`${API_BASE}delete_cards`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_id: GUILD_ID, session_token: getLoginSession()?.session_token, filename: d.filename, nickname: getLoginSession()?.nickname }),
      });
      const data = await res.json();
      if (data.ok) deletedDecks.push(d);
      else blockedDecks.push({ deck: d, error: data.error });
    } catch(e) {
      blockedDecks.push({ deck: d, error: e.message });
    }
  }

  if (deletedDecks.length) {
    const removedIds = new Set(deletedDecks.map(d => d.id));
    decks = decks.filter(d => !removedIds.has(d.id));
    saveDecks(decks);
  }

  if (blockedDecks.length) {
    const notOwned = blockedDecks.filter(b => b.error === 'creator_approval_required');
    if (notOwned.length) {
      const names = notOwned.map(b => `「${b.deck.name}」`).join('、');
      await showCmAlert({
        title: 'フォルダを削除できませんでした',
        desc: `${names} は他の人が作成したデッキのため、フォルダごとは削除できません。個別にデッキメニューの「デッキを削除する」から削除を依頼してください。`,
      });
    } else {
      await showCmAlert({ title: '一部のデッキの削除に失敗しました', desc: 'フォルダの削除を中断しました。もう一度お試しください。' });
    }
    renderDeckListUI();
    return;
  }

  // フォルダ自体もサーバー（みんなで共有）から削除
  try {
    const res = await fetch(`${API_BASE}delete_folder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guild_id: GUILD_ID, session_token: getLoginSession()?.session_token, id: folder.id, nickname: getLoginSession()?.nickname }), signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '不明なエラー');
  } catch(e) {
    await showCmAlert({ title: 'サーバーからのフォルダ削除に失敗しました', desc: e.message });
    return;
  }

  if (allFolderIds.includes(currentFolderId)) currentFolderId = folder.parentId || null;
  await fetchAndMergeFolders();
  renderDeckListUI();
}

// ── 移動先の選択（デッキ / フォルダ 共通） ─
let movePickerKind = null;   // 'deck' | 'folder'
let movePickerTargetId = null;

function openMovePicker(kind, id) {
  movePickerKind = kind;
  movePickerTargetId = id;
  document.getElementById('move-picker-title').textContent =
    kind === 'folder' ? 'フォルダの移動先' : 'デッキの移動先';
  renderMovePickerList();
  openModal('modal-move-picker');
}

function renderMovePickerList() {
  const list = document.getElementById('move-picker-list');
  const currentParent = movePickerKind === 'deck'
    ? (decks.find(d => d.id === movePickerTargetId)?.folderId || null)
    : (folders.find(f => f.id === movePickerTargetId)?.parentId || null);

  // ★ 移動可否の判定は種類ごとに分ける（フォルダは階層数チェック＋「クイズ過去問
  //   フォルダの外へは出せない」を含む canMoveFolderTo、デッキは今のところ
  //   制限の無い canMoveDeckTo）。
  const canMoveTo = movePickerKind === 'folder'
    ? (targetId) => canMoveFolderTo(movePickerTargetId, targetId)
    : (targetId) => canMoveDeckTo(movePickerTargetId, targetId);

  const rows = [];
  // ★ アイコン（固定HTML）とラベル（フォルダ名＝ユーザー入力）を分けて持たせ、
  //   ラベル側だけをesc()に通す（icon側を一緒にesc()すると<svg>タグ自体が
  //   文字列としてエスケープされてしまい描画できなくなるため）。
  rows.push({ id: null, icon: Icons.html('home', {size:14}), label: 'ルート', level: 0, disabled: !canMoveTo(null) });

  function walk(parentId, level) {
    folderChildren(parentId).forEach(f => {
      const disabled = !canMoveTo(f.id);
      rows.push({ id: f.id, icon: Icons.cmHtml('folder', {size:14}), label: f.name, level, disabled });
      walk(f.id, level + 1);
    });
  }
  walk(null, 1);

  list.innerHTML = rows.map(r => {
    const isCurrent = r.id === currentParent;
    const cls = 'move-picker-row'
      + (r.disabled ? ' disabled' : '')
      + (isCurrent ? ' current' : '');
    const idAttr = r.id === null ? 'null' : `'${r.id}'`;
    const clickAttr = r.disabled ? '' : ` onclick="selectMoveTarget(${idAttr})"`;
    return `<div class="${cls}" style="padding-left:${8 + r.level * 18}px"${clickAttr}>${r.icon} ${esc(r.label)}${isCurrent ? ' <span class="move-picker-current-tag">現在</span>' : ''}</div>`;
  }).join('');
}

async function selectMoveTarget(targetId) {
  closeModal('modal-move-picker');

  if (movePickerKind === 'deck') {
    const d = decks.find(x => x.id === movePickerTargetId);
    if (!d || !canMoveDeckTo(d.id, targetId)) return;

    // ★ 修正：公開済みデッキを移動する前に、必ずサーバーから最新のカード本体を
    //   取り直す。失敗時は loadDeckCardsWithRecovery が再試行・強制続行の
    //   選択肢を提示するので、移動できないまま詰むことはない。
    if (d.filename) {
      const loaded = await loadDeckCardsWithRecovery(d.id);
      if (!loaded) return; // ユーザーが「やめる」を選んだ場合は移動しない
    }

    d.folderId = targetId;
    saveDecks(decks);
    renderDeckListUI();
    // ★ 公開済みデッキはサーバー側（みんなの共有フォルダ情報）にも反映する
    if (d.filename) {
      const ok = await queueSyncDeckToServer(d);
      if (!ok) showBanner('サーバーへの移動の反映に失敗しました（ローカルには保存済み）', '#fffbeb', '#92400e', Icons.html('warning', {size:15}));
    }
    return;
  }

  // フォルダの移動（みんなで共有）
  const f = folders.find(x => x.id === movePickerTargetId);
  if (!f || !canMoveFolderTo(f.id, targetId)) return;
  try {
    const res = await fetch(`${API_BASE}save_folder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guild_id: GUILD_ID, session_token: getLoginSession()?.session_token, id: f.id, name: f.name, parent_id: targetId, nickname: getLoginSession()?.nickname }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '不明なエラー');
    await fetchAndMergeFolders();
    renderDeckListUI();
  } catch(e) {
    await showCmAlert({ title: 'フォルダの移動に失敗しました', desc: e.message });
  }
}

// ★ list_cards（軽量メタ情報のみ）を取得して decks にマージする共通処理（画面描画はしない）
//   ─────────────────────────────────────────────
//   以前はここで全デッキの cards 本体（画像含む）を丸ごと取得していたため、
//   デッキ数や画像が増えるほど一覧表示が遅くなっていた。
//   現在の list_cards はカード本体を含まない軽量なメタ情報（name/count/subject/
//   folder_id/published_by/incomplete など）だけを返すので、一覧表示はすぐに終わる。
//   カード本体は、デッキを実際に開く（プレイ／編集）ときに
//   ensureDeckCardsLoaded() で個別に取得する。
async function fetchAndMergeDecks() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  // ★ cache: 'no-store' を追加：これが無いと、Chromeなどのブラウザが
  //   list_cards のレスポンスをキャッシュしてしまい、新規作成・公開した
  //   カードが自分の端末の一覧にすぐ反映されないことがあるため。
  const session = getLoginSession();
  const res  = await fetch(`${API_BASE}list_cards?guild_id=${GUILD_ID}`, {
    signal: controller.signal, cache: 'no-store',
    headers: session?.session_token ? { 'Authorization': 'Bearer ' + session.session_token } : {},
  });
  clearTimeout(timer);
  const txt = await res.text();
  const data = JSON.parse(txt);
  if (!data.ok) return { changed: false, txt };
  const fetched = data.sets.map(s => {
    const existing = decks.find(d => d.filename === s.filename);
    // ★ この端末で既にカード本体を読み込み済みなら、それを引き継いで再取得を省く。
    //   未読み込みなら空配列のままにし、開いたときに取得する。
    // ★ 修正：ただし、サーバー側の最新枚数（s.count）がこの端末にキャッシュ済みの
    //   枚数より減っている場合は引き継がない。他の人がデッキを編集して枚数を
    //   減らした後、この端末でキャッシュ（多い方の枚数）を持ち越し続けると、
    //   ensureDeckCardsLoaded() の件数不一致セーフティ（減っていたら異常とみなす）が
    //   「一度読み込んだ枚数」を基準にしたまま二度と満たされなくなり、
    //   そのデッキが（本当は正常なのに）永久に開けなくなってしまう。
    //   減っていた場合は未読み込み扱いに戻し、次に開いたときに必ずサーバーから
    //   最新を取り直させることで、この「詰み」を防ぐ。
    const cachedIsStale = existing && existing.cardsLoaded
      && typeof s.count === 'number' && s.count < existing.cards.length;
    const keepLoadedCards = existing && existing.cardsLoaded && !cachedIsStale;
    return {
      id: existing ? existing.id : genId(),
      name: s.name,
      cards: keepLoadedCards ? existing.cards : [],
      cardsLoaded: !!keepLoadedCards,
      filename: s.filename,
      count: s.count,
      choiceMode: s.choice_mode || null, // ★ 多肢選択デッキかどうか（旧データの互換のため "single"/"multi" 文字列も truthy として扱う）
      // ★ 追加（2026/08/21）：クイズ過去問デッキかどうか。以前はフォルダの位置
      //   （isDeckInFolderScope）だけで判定していたが、外のフォルダへ移動できる
      //   ようにしたため、デッキ自身が持つこのフラグ（サーバー側で維持される。
      //   save_cards参照）で判定する。
      quizArchive: !!s.quiz_archive,
      subject: s.subject || (existing && existing.subject) || null,
      published_by: s.published_by || (existing && existing.published_by) || null,
      // ★ 未完成フラグはサーバー側の索引（list_cards）にも保存されるようになったため、
      //   他人の端末でも同じ表示になるようサーバー値を信頼する。
      incomplete: !!s.incomplete,
      // ★ 追加：「作成中」（＝一度も公開して保存を経ていない）かどうかは、サーバー側には
      //   保存されていないローカル限定の状態なので、この端末に記録が残っていればそれを
      //   引き継ぐ。記録が無い（＝他人の端末で初めて見るデッキ）場合は、サーバー登録直後の
      //   カード0枚のまま（旧来の判定基準）だけを「作成中」とみなし、それ以外は
      //   既に公開済みとして扱う（誤って永久に「未完成」表示から動けなくなるのを防ぐため）。
      notYetPublished: existing && typeof existing.notYetPublished === 'boolean'
        ? existing.notYetPublished
        : (s.count === 0 && !!s.incomplete),
      // ★ フォルダ所属はサーバー側が正（みんなで共有）。
      //   has_folder_id が true の場合は、folder_id が null（＝ルート）であっても
      //   それをそのまま信頼する（＝ルートへ移動されたことを正しく反映する）。
      //   has_folder_id が false の場合だけ、まだこの機能に未対応の古いデータなので
      //   ローカルに残っている値をフォールバックとして使う。
      folderId: s.has_folder_id
        ? (s.folder_id || null)
        : (existing ? (existing.folderId || null) : null),
    };
  });
  const publishedNames = new Set(fetched.map(f => f.name));
  // ★ ローカル限定デッキ（未公開）は常にカード本体を持っているので cardsLoaded=true 扱い
  const localOnly = decks.filter(d => !d.filename && !publishedNames.has(d.name))
    .map(d => ({ ...d, cardsLoaded: true }));
  decks = [...localOnly, ...fetched];
  saveDecks(decks);
  return { changed: true, txt };
}

// ★ 公開済みデッキのカード本体（問題・解答・画像など）を、必要になった時点で取得する。
//   ・ローカル限定（未公開）デッキは常にカードを保持しているので何もしない。
//   ・既に読み込み済み（cardsLoaded=true）でも、force=true が指定された場合は
//     必ずサーバーから最新を取り直す（他の人が後から編集・移動している可能性があるため）。
//   ・取得中は loadingDeckIds に id を入れて一覧を再描画し、「読み込み中…」を表示する。
let loadingDeckIds = new Set();
// ★ 戻り値を { ok: true } | { ok: false, reason: 'network' | 'mismatch' | 'not_found', ... } に変更。
//   単純な true/false ではなく「なぜ失敗したか」を区別できるようにし、
//   呼び出し側で「再試行」「強制的に空のまま開く」などの回復手段を提示できるようにする。
// ★ 修正：デッキを開く際のタイムアウトを防ぐための調整。
//   ・画像を多く含む大きなデッキや、通信環境が悪い状況では、以前の8秒という
//     タイムアウト時間だと正常に取得できているのに間に合わず「読み込みに
//     失敗しました」と表示されてしまうことがあった。
//   ・タイムアウト時間を余裕を持たせつつ、さらに一度だけ自動で（ユーザーに
//     気づかれないよう静かに）再試行してから失敗として扱うようにすることで、
//     一時的な通信の遅延・瞬断だけでは失敗扱いにならないようにする。
//   ★ さらに修正：それでもカード枚数がとても多いデッキだけ、20秒固定では
//     間に合わず読み込みに失敗することがあったため、固定値ではなく
//     「カード枚数が多いデッキほどタイムアウトを延ばす」方式にする
//     （list_cards のメタ情報で分かっている枚数を基準にする。枚数が
//     不明なとき・少ないときは従来通り基本値のまま）。青天井にはせず、
//     上限（DECK_LOAD_MAX_TIMEOUT_MS）を設けて壊れたデッキ等で
//     いつまでも待たされ続けることは防ぐ。
const DECK_LOAD_BASE_TIMEOUT_MS = 20000; // 8秒 → 20秒に延長（基本値）
const DECK_LOAD_PER_CARD_MS     = 150;   // カード1枚につき+150ms延長
const DECK_LOAD_MAX_TIMEOUT_MS  = 90000; // 上限90秒

function deckLoadTimeoutMs(expectedCount) {
  if (!expectedCount || expectedCount <= 0) return DECK_LOAD_BASE_TIMEOUT_MS;
  const extended = DECK_LOAD_BASE_TIMEOUT_MS + expectedCount * DECK_LOAD_PER_CARD_MS;
  return Math.min(DECK_LOAD_MAX_TIMEOUT_MS, extended);
}

async function fetchCardSetOnce(filename, timeoutMs = DECK_LOAD_BASE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const session = getLoginSession();
    const res = await fetch(`${API_BASE}get_card_set?guild_id=${GUILD_ID}&filename=${encodeURIComponent(filename)}`, {
      signal: controller.signal, cache: 'no-store',
      headers: session?.session_token ? { 'Authorization': 'Bearer ' + session.session_token } : {},
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '不明なエラー');
    return data;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function ensureDeckCardsLoaded(deckId, force = false) {
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return { ok: false, reason: 'not_found' };
  if (!deck.filename) { deck.cardsLoaded = true; return { ok: true }; }
  if (deck.cardsLoaded && !force) return { ok: true };

  // ★ 直前まで一覧（list_cardsのメタ情報）で分かっていた問題数を控えておく。
  //   これと比べて、実際に取得できたカード数が不自然に少なければ
  //   「サーバーはok:trueを返したが、実は異常な状態だった」とみなして
  //   失敗扱いにする（＝空データでdeck.cardsを上書きしない）ための安全策。
  //   ★ 修正：deck.count（サーバー由来のメタ情報）だけでなく、この端末に
  //     既に読み込み済みのカード実数（deck.cards.length）も比較対象に含める。
  //     何らかの理由でサーバーへの同期がまだ済んでいない状態でも、
  //     「今ローカルにある枚数より減っている」場合は同じく異常とみなし、
  //     せっかく手元にあるカードを空／少ない件数で上書きしないようにする。
  const knownCount = deck.cardsLoaded ? deck.cards.length : 0;
  const metaCount = typeof deck.count === 'number' ? deck.count : 0;
  const expectedCount = Math.max(knownCount, metaCount) || null;
  // ★ カード枚数が多い（＝データ量が大きい）デッキほどタイムアウトを延ばす
  const timeoutMs = deckLoadTimeoutMs(expectedCount);

  loadingDeckIds.add(deckId);
  if (document.querySelector('.screen.active')?.id === 'screen-list') renderDeckListUI();

  try {
    // ★ 修正：まず1回試し、タイムアウトも含むネットワークエラーの場合だけ、
    //   間を置いて（500ms）もう一度だけ静かに自動再試行する。
    //   これにより、一時的な遅延・瞬断だけでユーザーに失敗を見せてしまうことを防ぐ。
    let data;
    try {
      data = await fetchCardSetOnce(deck.filename, timeoutMs);
    } catch (firstErr) {
      await new Promise(r => setTimeout(r, 500));
      data = await fetchCardSetOnce(deck.filename, timeoutMs);
    }
    const fetchedCards = data.cards || [];

    // ★ 安全策：サーバーが ok:true を返していても、直前まで分かっていた問題数
    //   （または、この端末に既に読み込み済みだった実際の枚数）より
    //   取得できたカード数が少ない場合は、通信は成功していても内容としては
    //   信用できないので「失敗」として扱う。
    //   これにより、編集画面が空／一部欠けた状態で開いてしまい、そのまま公開して
    //   サーバー側（または手元）の本物のカードを少ないデータで上書きしてしまう事故を防ぐ。
    if (expectedCount !== null && expectedCount > 0 && fetchedCards.length < expectedCount) {
      console.warn(`[cardmaker] get_card_set が${fetchedCards.length}件しか返しませんでしたが、${expectedCount}件のはずです。 filename=${deck.filename}`);
      return { ok: false, reason: 'mismatch', expectedCount, fetchedCount: fetchedCards.length };
    }

    deck.cards = fetchedCards;
    deck.cardsLoaded = true;
    deck.count = deck.cards.length;
    // ★ カード本体取得時にもサーバー側の未完成フラグを取り込んでおく（念のため）
    if ('incomplete' in data) deck.incomplete = !!data.incomplete;
    saveDecks(decks);
    return { ok: true };
  } catch(e) {
    return { ok: false, reason: 'network' };
  } finally {
    loadingDeckIds.delete(deckId);
    if (document.querySelector('.screen.active')?.id === 'screen-list') renderDeckListUI();
  }
}

// ★ ensureDeckCardsLoaded を呼び出した上で、失敗した場合に
//   「行き止まりのアラートで終わらせず」ユーザーに回復手段を提示する共通処理。
//   ─────────────────────────────────────────────
//   ・reason: 'mismatch'（件数不一致）の場合は、まず必ず最新のメタ情報
//     （list_cards）を取り直してから再判定する。ローカルに残っている古い
//     件数のせいで「本当は0件が正しい」デッキまで誤って詰んでしまうのを防ぐため。
//   ・それでも不一致が解消しない場合は「もう一度試す」「空のまま開く（上級者向け）」
//     の2択を提示し、ユーザーの意思で先に進めるようにする（＝二度と開けなくなる、
//     という事態を避ける）。
//   ・reason: 'network' の場合は、単純に「もう一度試す」か「やめる」かを聞く。
async function loadDeckCardsWithRecovery(deckId) {
  while (true) {
    const result = await ensureDeckCardsLoaded(deckId, true);
    if (result.ok) return true;

    if (result.reason === 'mismatch') {
      // ★ 判定前に最新のメタ情報を取り直す（ローカルの古いcountによる誤判定を防ぐ）
      try { await fetchAndMergeDecks(); } catch(e) {}
      const deck = decks.find(d => d.id === deckId);
      if (!deck) return false;

      // メタ情報を更新した結果、期待件数が0（＝本当に空が正解）になっていれば、
      // ここで改めて通常読み込みすれば矛盾なく成功するはず
      if (deck.count === 0) continue;

      const choice = await showCmChoiceDialog({
        title: '問題データの読み込みに不整合があります',
        desc: `一覧では${result.expectedCount}問のはずですが、サーバーから0問しか取得できませんでした。\nこのまま開いて保存すると、サーバー側のデータが消える可能性があります。`,
        choices: [
          { icon: Icons.html('refresh', {size:20}), label: 'もう一度試す', sub: 'まずはこちらをおすすめします', value: 'retry' },
          { icon: Icons.html('warning', {size:20}), label: '空のまま開く（上級者向け）', sub: '保存すると中身が消える可能性があります', value: 'force' },
        ],
        cancelLabel: 'やめる',
      });
      if (choice === 'retry') continue;
      if (choice === 'force') {
        const d = decks.find(x => x.id === deckId);
        if (d) { d.cards = []; d.cardsLoaded = true; saveDecks(decks); }
        return true;
      }
      return false; // やめる
    }

    // ネットワークエラー・その他の場合
    const retry = await showCmConfirm({
      title: '読み込みに失敗しました',
      desc: '通信環境を確認してもう一度お試しください。',
      okLabel: 'もう一度試す', cancelLabel: 'やめる',
    });
    if (!retry) return false;
    // ループして再試行
  }
}

async function renderDeckList() {
  decks = loadDecks();
  folders = loadFoldersCache();
  renderDeckListUI();
  try {
    await Promise.all([fetchAndMergeDecks(), fetchAndMergeFolders(), fetchAndMergeOrder(), fetchAndMergeStudyData()]);
    renderDeckListUI();
    preloadUnsureBadges();
  } catch(e) {}
}

// ★ 追加：一覧の「わからない」バッジ（🔖）は、そのデッキのカード本体が
//   読み込み済み（cardsLoaded=true）でないと計算できない（804行目付近）。
//   Safariなど長く使っている端末では過去にデッキを開いたときのキャッシュが
//   残っているため気づきにくいが、Discordの内蔵ブラウザのようにストレージが
//   毎回まっさらな環境だと、一覧を開いた直後はバッジが一件も出ないままになる。
//   「わからない」の記録（studyDataCache.unsure）自体はカード本体と無関係に
//   サーバー同期済みなので、記録があるデッキだけバックグラウンドでカード本体を
//   読み込み直し、バッジを後から反映させる。
//   ★ ensureDeckCardsLoaded() は完了時に list 画面なら自動で再描画するので、
//     ここでは呼び出すだけでよい（await不要＝一覧の表示はブロックしない）。
function preloadUnsureBadges() {
  const targets = decks.filter(d =>
    d.filename && d.cardsLoaded === false && (studyDataCache.unsure[d.filename] || []).length > 0
  );
  targets.forEach(d => ensureDeckCardsLoaded(d.id));
}

// ── デッキメニュー ─────────────────────
function openDeckMenu(id) {
  menuTargetId = id;
  const deck = decks.find(d => d.id === id);
  document.getElementById('menu-deck-name').textContent = deck.name;
  document.getElementById('menu-unpublish-item').style.display = deck.filename ? '' : 'none';
  // ★ 追加：共有リンクはサーバー上のファイル（filename）が無いと発行できない
  //   （非公開＝ローカルのみのデッキには対象が無いため）。
  document.getElementById('menu-share-item').style.display = deck.filename ? '' : 'none';
  // ★ 追加（2026/08/21）：クイズ過去問デッキは問題を編集できない
  //   （フォルダ移動・デッキ名の変更・非公開に戻す・削除は引き続き可能）。
  //   サーバー側（save_cards）でも強制しているが、そもそもメニューに
  //   出さないことで迷わせない。
  document.getElementById('menu-edit-item').style.display = deck.quizArchive ? 'none' : '';
  document.getElementById('menu-quiz-archive-note').style.display = deck.quizArchive ? '' : 'none';
  openModal('modal-deck-menu');
}

// ★ 「みんなでクイズを始める」は✏️メニューではなく「▶ プレイ」を押した先の
//   モーダル（modal-play-mode）から呼ぶ。closeModal + startQuizFromDeck で、
//   今プレイしようとしているデッキ（studyDeckId）をそのままクイズに渡す。
function startQuizFromPlayMode() {
  closeModal('modal-play-mode');
  startQuizFromDeck(studyDeckId);
}

// ★ デッキ一覧から、そのデッキを元にした「みんなでクイズ」のホスト作成画面
//   （Quiz.html）へ遷移する。
function startQuizFromDeck(deckId) {
  const deck = decks.find(d => d.id === deckId);
  if (!deck || !deck.filename) {
    showCmAlert({ title: 'クイズを始められません', desc: '公開済みのデッキだけ「みんなでクイズ」を始められます。先に公開してください。' });
    return;
  }
  const url = `Quiz.html?mode=host&deck=${encodeURIComponent(deck.filename)}&name=${encodeURIComponent(deck.name)}`;
  location.href = url;
}
async function menuEdit()   { closeModal('modal-deck-menu'); await openEditDeck(menuTargetId); }
function menuRename() { closeModal('modal-deck-menu'); openRename(menuTargetId); }
function menuMove()   { closeModal('modal-deck-menu'); openMovePicker('deck', menuTargetId); }

async function menuUnpublish() {
  closeModal('modal-deck-menu');
  const deck = decks.find(d => d.id === menuTargetId);
  if (!deck || !deck.filename) return;
  const ok = await showCmConfirm({
    title: '非公開に戻しますか？',
    desc: `「${deck.name}」をGitHubから削除して非公開に戻します。`,
    okLabel: '非公開に戻す', okStyle: 'danger',
  });
  if (!ok) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${API_BASE}delete_cards`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guild_id: GUILD_ID, session_token: getLoginSession()?.session_token, filename: deck.filename, nickname: getLoginSession()?.nickname }), signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!data.ok) {
      // ★ 追加：作成者本人以外は直接削除できない（サーバー側の作成者確認機能）。
      //   ローカルからは何も消さず、代わりに作成者への削除依頼フォームを開く。
      if (data.error === 'creator_approval_required') {
        openRequestDeleteModal('deck', deck.filename, deck.name, data.owner_nickname);
        return;
      }
      throw new Error(data.error || '削除失敗');
    }
    deck.filename = null; deck.count = undefined; deck.published_by = null; deck.incomplete = false;
    deck.planPublish = false; // ★ 追加：明示的に非公開へ戻した場合は「作成中」ではなく「非公開」表示にする
    deck.notYetPublished = true; // ★ 追加：再度公開する場合は改めて「公開して保存」を経る必要がある状態に戻す
    saveDecks(decks); renderDeckListUI();
    showBanner('非公開に戻しました', '#f1f5f9', '#334155', Icons.cmHtml('unpublish', {size:15}));
  } catch(e) {
    await showCmAlert({ title: 'GitHubからの削除に失敗しました', desc: e.message });
  }
}

// ── 共有リンク（ログインしていない人にもデッキ1件だけ閲覧専用で見せる） ──
// ★ 追加（2026/08/24）：デッキメニューの「共有リンクを作る」から開く。
//   見せるのはこのデッキの中身だけ・変更権は一切与えない・1日3件までの
//   仕組みはすべてサーバー側（create_deck_share等）で強制している。
let deckShareCtx = null; // { filename, deckId }

async function menuShare() {
  closeModal('modal-deck-menu');
  const deck = decks.find(d => d.id === menuTargetId);
  if (!deck || !deck.filename) return;
  deckShareCtx = { filename: deck.filename, deckId: deck.id };
  document.getElementById('deck-share-err').style.display = 'none';
  document.getElementById('deck-share-quota').textContent = '';
  document.getElementById('deck-share-list').innerHTML = '';
  openModal('modal-deck-share');
  await loadDeckShareList();
}

async function loadDeckShareList() {
  if (!deckShareCtx) return;
  try {
    const session = getLoginSession();
    const qs = new URLSearchParams({ guild_id: GUILD_ID, filename: deckShareCtx.filename });
    const res = await fetch(`${API_BASE}list_deck_shares?${qs.toString()}`, {
      cache: 'no-store',
      headers: session?.session_token ? { 'Authorization': 'Bearer ' + session.session_token } : {},
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '取得に失敗しました');
    document.getElementById('deck-share-quota').textContent = `本日あと${data.remaining_today}件作成できます（1日3件まで）`;
    renderDeckShareList(data.shares || []);
  } catch (e) {
    document.getElementById('deck-share-quota').textContent = '';
  }
}

function renderDeckShareList(shares) {
  const wrap = document.getElementById('deck-share-list');
  wrap.innerHTML = '';
  // ★ 発行済みのリンクが無いときは見出しごと隠す（「取り消しボタンが
  //   見当たらない」という混乱は、リンクが1件も無い状態でも起きていた）。
  document.getElementById('deck-share-list-label').style.display = shares.length ? '' : 'none';
  if (!shares.length) return;
  shares.forEach(s => {
    const row = document.createElement('div');
    row.style.cssText = 'background:var(--bg);border-radius:var(--r-md);padding:10px 12px;margin-bottom:8px';

    const urlRow = document.createElement('div');
    urlRow.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px';
    const urlBox = document.createElement('div');
    urlBox.style.cssText = 'flex:1;min-width:0;font-size:12px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    urlBox.textContent = s.url;
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-ghost btn-sm';
    copyBtn.textContent = 'コピー';
    copyBtn.addEventListener('click', () => copyShareLink(s.url, copyBtn));
    urlRow.appendChild(urlBox);
    urlRow.appendChild(copyBtn);
    row.appendChild(urlRow);

    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:11.5px;color:var(--text-tertiary);margin-bottom:6px';
    const expiresStr = new Date(s.expires_at * 1000).toLocaleDateString('ja-JP');
    meta.textContent = `${s.created_by_nickname || '（不明）'}さんが作成・${expiresStr}まで有効`;
    row.appendChild(meta);

    // ★ 修正：以前は他と見分けにくい薄いテキストボタンだったため、
    //   「取り消しボタンがどこにあるか分からない」という指摘を受けて、
    //   アイコン付き・全幅の危険色ボタン（btn-danger）にして目立たせた。
    const revokeBtn = document.createElement('button');
    revokeBtn.type = 'button';
    revokeBtn.className = 'btn btn-danger btn-sm';
    revokeBtn.style.width = '100%';
    revokeBtn.innerHTML = Icons.html('trash', {size:14}) + ' このリンクを取り消す';
    revokeBtn.addEventListener('click', () => revokeDeckShare(s.token));
    row.appendChild(revokeBtn);

    wrap.appendChild(row);
  });
}

async function copyShareLink(url, btn) {
  try {
    await navigator.clipboard.writeText(url);
    if (btn) { const orig = btn.textContent; btn.textContent = 'コピーしました'; setTimeout(() => btn.textContent = orig, 1500); }
  } catch (e) {
    await showCmAlert({ title: 'コピーできませんでした', desc: 'リンクを長押し（選択）してコピーしてください。' });
  }
}

async function createDeckShareLink() {
  if (!deckShareCtx) return;
  const errEl = document.getElementById('deck-share-err');
  errEl.style.display = 'none';
  const btn = document.getElementById('deck-share-create-btn');
  setBtnLoading(btn, true, '作成中…');
  try {
    const session = getLoginSession();
    const res = await fetch(`${API_BASE}create_deck_share`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guild_id: GUILD_ID, session_token: session?.session_token, filename: deckShareCtx.filename }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    setBtnLoading(btn, false);
    if (!data.ok) {
      if (data.error === 'creator_approval_required') {
        const deck = decks.find(d => d.filename === deckShareCtx.filename);
        closeModal('modal-deck-share');
        openRequestShareModal(deckShareCtx.filename, deck ? deck.name : deckShareCtx.filename, data.owner_nickname);
        return;
      }
      if (data.error === 'share_limit_reached') {
        errEl.textContent = '本日の共有作成上限（3件）に達しています。明日また作成できます。';
        errEl.style.display = '';
        return;
      }
      throw new Error(data.error || '作成に失敗しました');
    }
    await loadDeckShareList();
    showBanner('共有リンクを作成しました', '#dcfce7', '#166534', Icons.cmHtml('globe', {size:15}));
    copyShareLink(data.url);
  } catch (e) {
    setBtnLoading(btn, false);
    errEl.textContent = e.message || '通信環境を確認してもう一度お試しください。';
    errEl.style.display = '';
  }
}

async function revokeDeckShare(token) {
  const ok = await showCmConfirm({
    title: 'このリンクを取り消しますか？',
    desc: 'このリンクを持っている人は、以後このデッキを見られなくなります。',
    okLabel: '取り消す', okStyle: 'danger',
  });
  if (!ok) return;
  try {
    const session = getLoginSession();
    const res = await fetch(`${API_BASE}revoke_deck_share`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guild_id: GUILD_ID, session_token: session?.session_token, token }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '取り消しに失敗しました');
    await loadDeckShareList();
  } catch (e) {
    await showCmAlert({ title: '取り消しに失敗しました', desc: e.message });
  }
}

// ── 共有の確認依頼（作成者本人以外が共有リンクを作りたいとき） ──
// menuShare→createDeckShareLink() がサーバーから creator_approval_required を
// 受け取ったときに呼ばれる。ここでは何も発行せず、理由を添えて
// /request_deck_share を叩き、作成者にDiscordで確認してもらうだけ。
let requestShareCtx = null; // { filename, deckName }

function openRequestShareModal(filename, deckName, ownerNickname) {
  requestShareCtx = { filename, deckName };
  document.getElementById('request-share-desc').textContent =
    `「${deckName}」の作成者（${ownerNickname || '作成者'}さん）に共有の確認が必要です。理由を書いて送信すると、作成者にDiscordで確認が届きます。承諾されたら、もう一度「共有リンクを作る」を押すと発行できます。`;
  document.getElementById('request-share-reason').value = '';
  document.getElementById('request-share-err').style.display = 'none';
  const btn = document.getElementById('request-share-submit-btn');
  btn.disabled = false; btn.textContent = '送信する';
  openModal('modal-request-share');
}

async function submitRequestShare() {
  if (!requestShareCtx) return;
  const reason = document.getElementById('request-share-reason').value.trim();
  const errEl = document.getElementById('request-share-err');
  errEl.style.display = 'none';
  if (!reason) {
    errEl.textContent = '理由を入力してください';
    errEl.style.display = '';
    return;
  }
  const btn = document.getElementById('request-share-submit-btn');
  btn.disabled = true; btn.textContent = '送信中…';
  try {
    const session = getLoginSession();
    const res = await fetch(`${API_BASE}request_deck_share`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guild_id: GUILD_ID, session_token: session?.session_token,
        filename: requestShareCtx.filename, reason,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '送信に失敗しました');
    closeModal('modal-request-share');
    const via = data.notified_via === 'web_pending'
      ? '作成者がDiscord未連携のため、次回サイトを開いたときに確認されます。'
      : '作成者にDiscordで確認を送りました。承認されたら、もう一度「共有リンクを作る」を押すと発行できます。';
    showBanner(via, '#dcfce7', '#166534', Icons.html('mailSent', {size:15}));
  } catch (e) {
    btn.disabled = false; btn.textContent = '送信する';
    errEl.textContent = e.message;
    errEl.style.display = '';
  }
}

// ── 削除の確認依頼（作成者本人以外が削除／非公開に戻そうとしたとき） ──
// サーバーが creator_approval_required を返したときに menuDelete()/
// menuUnpublish() から呼ばれる。ここでは何も削除せず、理由を添えて
// /request_delete を叩き、作成者にDiscordで確認してもらうだけ。
let requestDeleteCtx = null; // { category, filename, targetName }

function openRequestDeleteModal(category, filename, targetName, ownerNickname) {
  requestDeleteCtx = { category, filename, targetName };
  document.getElementById('request-delete-desc').textContent =
    `「${targetName}」の作成者（${ownerNickname || '作成者'}さん）に削除の確認が必要です。理由を書いて送信すると、作成者にDiscordで確認が届きます。`;
  document.getElementById('request-delete-reason').value = '';
  document.getElementById('request-delete-err').style.display = 'none';
  const btn = document.getElementById('request-delete-submit-btn');
  btn.disabled = false; btn.textContent = '送信する';
  openModal('modal-request-delete');
}

async function submitRequestDelete() {
  if (!requestDeleteCtx) return;
  const reason = document.getElementById('request-delete-reason').value.trim();
  const errEl = document.getElementById('request-delete-err');
  errEl.style.display = 'none';
  if (!reason) {
    errEl.textContent = '理由を入力してください';
    errEl.style.display = '';
    return;
  }
  const btn = document.getElementById('request-delete-submit-btn');
  btn.disabled = true; btn.textContent = '送信中…';
  try {
    const session = getLoginSession();
    const res = await fetch(`${API_BASE}request_delete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guild_id: GUILD_ID, session_token: session?.session_token,
        category: requestDeleteCtx.category, filename: requestDeleteCtx.filename, reason,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '送信に失敗しました');
    closeModal('modal-request-delete');
    const via = data.notified_via === 'web_pending'
      ? '作成者がDiscord未連携のため、次回サイトを開いたときに確認されます。'
      : '作成者にDiscordで確認を送りました。承認されると削除されます。';
    showBanner(via, '#dcfce7', '#166534', Icons.html('mailSent', {size:15}));
  } catch (e) {
    btn.disabled = false; btn.textContent = '送信する';
    errEl.textContent = e.message;
    errEl.style.display = '';
  }
}

async function menuDelete() {
  closeModal('modal-deck-menu');
  const okDelete = await showCmConfirm({
    title: 'このデッキを削除しますか？', desc: 'この操作は取り消せません。',
    okLabel: '削除する', okStyle: 'danger',
  });
  if (!okDelete) return;
  const deck = decks.find(d => d.id === menuTargetId);
  if (deck && deck.filename) {
    try {
      const res = await fetch(`${API_BASE}delete_cards`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_id: GUILD_ID, session_token: getLoginSession()?.session_token, filename: deck.filename, nickname: getLoginSession()?.nickname }),
      });
      // ★ 修正：以前はレスポンスの中身（data.ok）を見ておらず、サーバー側が
      //   削除に失敗（{ok:false}）しても例外にはならないため気付かず、
      //   下のdecks.filter()でローカルの一覧からだけ消えてしまっていた
      //   （サーバー上には残ったまま＝他の端末には残り続ける不整合）。
      const data = await res.json();
      if (!data.ok) {
        // ★ 追加：作成者本人以外は直接削除できない（サーバー側の作成者確認機能）。
        //   ローカルからは何も消さず、代わりに作成者への削除依頼フォームを開く。
        if (data.error === 'creator_approval_required') {
          openRequestDeleteModal('deck', deck.filename, deck.name, data.owner_nickname);
          return;
        }
        throw new Error(data.error || '削除失敗');
      }
    } catch(e) {
      const localOnly = await showCmConfirm({
        title: 'GitHubからの削除に失敗しました',
        desc: 'ローカルからだけ削除しますか？',
        okLabel: 'ローカルから削除', okStyle: 'danger',
      });
      if (!localOnly) return;
    }
  }
  decks = decks.filter(d => d.id !== menuTargetId);
  saveDecks(decks); renderDeckList();
}

// ── 新規作成 ──────────────────────────
function openNewSet() {
  document.getElementById('new-set-name').value = '';
  document.getElementById('new-plan-publish').checked = true; // ★ 追加：毎回デフォルトで「公開予定」に戻す
  // ★ 追加：多肢選択デッキのトグルも毎回OFFへ戻す
  document.getElementById('new-choice-mode-enabled').checked = false;
  showScreen('new');
  loadSubjects();
  setTimeout(() => document.getElementById('new-set-name').focus(), 200);
}

async function loadSubjects() {
  const sel = document.getElementById('new-subject');
  sel.innerHTML = '<option value="">読み込み中…</option>';
  try {
    // ★ cache: 'no-store' を追加：科目（チャンネル）一覧が古いまま
    //   表示され続けることを防ぐため。
    const res  = await fetch(`${API_BASE}channels?guild_id=${GUILD_ID}`, { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok || !data.channels.length) throw new Error();
    sel.innerHTML = '<option value="">科目を選択（任意）</option>' +
      data.channels.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  } catch(e) {
    sel.innerHTML = '<option value="">（科目を取得できませんでした）</option>';
  }
}

async function startEdit() {
  const subject = document.getElementById('new-subject').value;
  const input   = document.getElementById('new-set-name').value.trim();
  if (!input) { shake('new-set-name'); return; }
  if (await warnIfBugChars(input, 'new-set-name')) return;
  // ★ 追加：サーバーへの登録待ち（announceNewDeckToServer）の間、
  //   ボタンが押せた／今処理中だと分かるようスピナー表示に切り替える。
  const btn = document.getElementById('btn-create-deck');
  setBtnLoading(btn, true, '作成中…');
  const name = subject ? `${subject} ${input}` : input;
  // ★ 追加：このデッキを公開予定として作成するかどうか（デフォルトtrue＝公開予定）
  const planPublish = document.getElementById('new-plan-publish').checked;
  // ★ 追加：多肢選択デッキにするか（null=通常のフラッシュカードデッキ / true=選択式デッキ）。
  //   単一正解/複数正解はデッキ単位では決めず、問題ごとに正解チェックの数で自動的に決まる。
  const choiceMode = document.getElementById('new-choice-mode-enabled').checked ? true : null;
  // ★ notYetPublished: まだ一度も「公開して保存」（完成／未完成の選択）を経ていないことを表す。
  //   これが true の間は、カードが何枚あっても常に「作成中」バッジとして扱う（プレイ不可・編集は可）。
  const deck = { id: genId(), name, subject, cards: [], cardsLoaded: true, folderId: currentFolderId, planPublish, notYetPublished: true, choiceMode };
  decks.push(deck); saveDecks(decks);
  // ★ 追加：公開予定なら、この時点（作成ボタンを押した直後）でサーバーにも
  //   「まだ中身は空・作成中」として登録し、他の人の一覧にもすぐ表示されるようにする。
  //   （失敗しても致命的ではないので、その場合はこれまで通りこの端末だけの
  //     下書きとして続行する＝一覧のバッジは「作成中」のまま変わらない）
  if (planPublish) {
    await announceNewDeckToServer(deck.id);
  }
  setBtnLoading(btn, false); // ★ 追加：この後すぐ画面遷移するが、念のため元に戻しておく
  openEditDeck(deck.id);
}

// ★ 追加：デッキ作成直後、公開予定なら中身が空の状態でもサーバーに登録して
//   「🟠 作成中」として他の人の一覧にも表示されるようにする処理。
//   ・save_cards は既存のAPIをそのまま利用する（cards: [] ・ incomplete: true ・ silent: true）。
//   ・カード枚数が0件のまま incomplete=true のデッキは「作成中」バッジとして
//     区別して表示する（renderDeckListUI 側のロジックを参照）。
//   ・Discordへの通知は送らない（silent:true）。
async function announceNewDeckToServer(deckId) {
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return;
  const session = getLoginSession();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    // ★ 修正：以前はここで常に cards: [] を送ってしまっていたため、
    //   （例：デッキ名編集モーダルで「公開予定」を後からONにした場合など）
    //   既にローカルで作成済みのカードが無視され、サーバー側は「0枚」として
    //   登録されてしまっていた。その結果、次に編集画面を開いた際に強制的な
    //   最新化（force reload）でローカルのカードがサーバー側の0枚で
    //   上書きされて消えてしまう、という重大な不具合につながっていた。
    //   ここでは必ず「今ローカルにある実際のカード」をそのまま送る
    //   （まだ1枚も無ければ結果的に空配列になるだけで、これまで通り）。
    const cards = deck.cards.map(cardToServerPayload);
    const res = await fetch(`${API_BASE}save_cards`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: deck.name,
        cards,
        guild_id: GUILD_ID,
        session_token: session ? session.session_token : undefined,
        subject: deck.subject || null,
        folder_id: deck.folderId || null,
        publisher_id: session ? session.student_id : null,
        publisher_nickname: session ? session.nickname : '匿名',
        silent: true,      // ★ 作成しただけなのでDiscord通知はしない
        incomplete: true,  // ★ まだ「保存して公開」を経ていないので「未完成（作成中）」扱いにする
        choice_mode: deck.choiceMode || null, // ★ 多肢選択デッキかどうか
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '不明なエラー');
    // ★ POST完了までの間に他の同期処理でdecks配列が入れ替わっている可能性があるため、
    //   必ずこの時点で最新のdecksからidで探し直してから更新・保存する。
    decks = loadDecks();
    const target = decks.find(d => d.id === deckId);
    if (target) {
      target.filename = data.filename;
      target.count = cards.length; // ★ 修正：実際に送ったカード数を反映する（常に0にしない）
      target.cardsLoaded = true;
      target.published_by = session ? session.nickname : '匿名';
      target.incomplete = true;
      target.notYetPublished = true; // ★ まだ「公開して保存」を経ていないので「作成中」のまま
      saveDecks(decks);
    }
  } catch (e) {
    // ★ サーバー登録に失敗した場合は、これまで通りこの端末だけの下書き
    //   （filenameなし）として続行する。次にカードを保存して公開すれば
    //   その時にサーバーへ反映される。
  }
}

// ── カード編集画面 ────────────────────
// ★ 公開済みデッキはカード本体が未読み込みの可能性があるので、
//   編集画面を開く前に ensureDeckCardsLoaded() で取得しておく。
async function openEditDeck(deckId) {
  currentDeckId = deckId;
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return;

  // ★ 編集は「サーバー全体を丸ごと上書き保存」につながる操作なので、
  //   キャッシュ済みでも必ず最新のカードを取り直す。失敗した場合は
  //   loadDeckCardsWithRecovery が「もう一度試す／空のまま開く」を
  //   ユーザーに選ばせるので、行き止まりにならない。
  // ★ 修正：直前の操作（カード追加/削除など）のサーバー同期がまだ完了していない
  //   場合に備え、強制リロードの前に必ずその完了を待つ（データ消失防止）。
  await waitForPendingSync(deckId);
  const ok = await loadDeckCardsWithRecovery(deckId);
  if (!ok) return; // ユーザーが「やめる」を選んだ場合は編集画面を開かない

  document.getElementById('edit-deck-title').textContent = deck.name;
  // ★ 修正：以前は「サーバー登録済み（公開予定／作成中を含む）」なら
  //   「保存」（ローカルのみ保存して戻る）ボタンを隠し、常に完全な
  //   「公開して保存」（ログイン確認・完成/未完成の選択・Discord通知）を
  //   通らないと編集を中断できなかった。
  //   単に作業を保存していったん戻りたいだけのときにも毎回この確認を
  //   挟まれるのは不便なため、「保存」ボタンは常に表示するようにする。
  //   （saveCard() 側で、filenameがあるデッキの「保存」は通知なしで
  //     静かにサーバーへも反映するよう修正済み）
  document.getElementById('btn-save-local').style.display = '';
  document.getElementById('btn-done').textContent = deck.filename ? '公開して保存' : '保存して公開';
  // ★ 追加：多肢選択デッキかどうかで「解答/解説」欄と「選択肢」欄を出し分ける
  applyCardFormChoiceMode(deck.choiceMode);
  clearEditor(); renderCreatedList(); showScreen('edit');
  setTimeout(() => document.getElementById('ta-q').focus(), 200);
}

// ★ 追加：カード新規作成フォームを、通常デッキ用（解答/解説）と
//   多肢選択デッキ用（選択肢）のどちらの見た目にするか切り替える。
//   CSV読み込みも「問題,解答,解説」形式専用なので選択式デッキでは隠す。
function applyCardFormChoiceMode(choiceMode) {
  const isChoice = !!choiceMode;
  document.getElementById('qa-csv-block').style.display         = isChoice ? 'none' : '';
  document.getElementById('qa-choice-csv-block').style.display  = isChoice ? '' : 'none';
  document.getElementById('qa-answer-block').style.display      = isChoice ? 'none' : '';
  document.getElementById('qa-explanation-block').style.display = isChoice ? 'none' : '';
  document.getElementById('qa-choices-block').style.display     = isChoice ? '' : 'none';
  if (isChoice) {
    renderChoiceEditorRows('ta-choice', ['', ''], []);
  }
}

function clearEditor() {
  ['q','a','e'].forEach(k => {
    const el = document.getElementById('ta-'+k);
    el.value = '';
    autoResize(el);
    el.dispatchEvent(new Event('input', { bubbles: true })); // ★ 数式プレビューもクリアする
    imgBuf[k] = [];
    document.getElementById('imgs-'+k).innerHTML = '';
  });
  // ★ 追加：多肢選択デッキの選択肢入力欄も、カードを1枚保存するたびに空へ戻す
  const deck = decks.find(d => d.id === currentDeckId);
  if (deck && deck.choiceMode) {
    renderChoiceEditorRows('ta-choice', ['', ''], []);
  }
}

// ============================================================
//  ★ CSVから一括読み込み（編集画面）は Cardmaker-csvimport.js に分離した
//  ─────────────────────────────────────────────
//  実体は別ファイルに移し、loadChunksInBackground() が背景で読み込む。
//  ここに残す2つは、編集画面のファイル選択（Cardmaker.htmlのonchange）
//  から呼ばれる入口。チャンク読み込み完了後は同名の本物の実装に
//  上書きされる。
async function handleCsvImport(event) {
  await loadChunkWithFeedback('csvimport', '/Cardmaker-csvimport.js');
  return handleCsvImport(event); // ★ この時点では本物の実装に差し替わっている
}
async function handleChoiceCsvImport(event) {
  await loadChunkWithFeedback('csvimport', '/Cardmaker-csvimport.js');
  return handleChoiceCsvImport(event);
}

// ★ 追加：多肢選択デッキの「カードを追加」フォーム（ta-choice-rows）から1枚追加する。
//   通常デッキの inline 追加（saveCard内、ta-a/ta-e使用）と役割は同じ。
//   戻り値：'added'（追加した）／'skip'（何も入力されておらず何もしなかった。
//   通常デッキと同じく空のまま「次へ／保存」を押した場合はこれ）／'invalid'（入力不備で中断）。
async function addChoiceCardFromForm(deck, q) {
  const { choices: rawChoices, correct } = readChoiceEditorState('ta-choice');
  const choices = rawChoices.map(c => c.trim());
  const anyInput = !!q || choices.some(c => c);
  if (!anyInput) return 'skip';

  if (!q) { shake('ta-q'); return 'invalid'; }
  const emptyIdx = choices.findIndex(c => !c);
  if (emptyIdx !== -1) { shake(`ta-choice-choice-${emptyIdx}`); return 'invalid'; }
  // ★ 単一/複数正解は問題ごとに正解チェックの数で自動的に決まる（1個＝択一、2個以上＝複数回答）。
  //   ここでは「1つも選ばれていない」ことだけをエラーにする。
  if (correct.length === 0) {
    await showCmAlert({ title: '正解を1つ以上選んでください', desc: '選択肢の左のチェックボックスで、正解を選んでください。1つだけ選べば択一問題、2つ以上選べば複数回答問題になります。' });
    return 'invalid';
  }
  if (await warnIfBugChars(q, 'ta-q')) return 'invalid';
  for (let i = 0; i < choices.length; i++) {
    if (await warnIfBugChars(choices[i], `ta-choice-choice-${i}`)) return 'invalid';
  }

  // ★ answer は正解の選択肢文言をまとめたもの。単語検索・一覧表示など
  //   「answerは文字列である」という前提の既存コードをそのまま動かすため。
  const answerText = correct.map(i => choices[i]).join(' / ');
  if (await warnIfDuplicateOrSameCard(deck, q, answerText, '')) return 'invalid';

  deck.cards.push({
    id: genId(), question: q, answer: answerText, explanation: '',
    choices, correct_indices: correct.slice().sort((x, y) => x - y),
    imgs_q: [...imgBuf.q], imgs_a: [], imgs_e: [],
  });
  saveDecks(decks);
  document.getElementById('edit-counter').textContent = deck.cards.length + '枚';
  if (deck.filename) queueSyncDeckToServer(deck);
  return 'added';
}

async function saveCard(mode) {
  const q = document.getElementById('ta-q').value.trim();
  const deck = decks.find(d => d.id === currentDeckId);
  const isChoiceDeck = deck && !!deck.choiceMode;

  if (isChoiceDeck) {
    const added = await addChoiceCardFromForm(deck, q);
    if (added === 'invalid') return; // 入力不備。編集を続けさせる
  } else {
    const a = document.getElementById('ta-a').value.trim();
    const e = document.getElementById('ta-e').value.trim();
    if (q || a) {
      if (!q || !a) { shake(!q ? 'ta-q' : 'ta-a'); return; }
      if (await warnIfBugChars(q, 'ta-q')) return;
      if (await warnIfBugChars(a, 'ta-a')) return;
      if (await warnIfBugChars(e, 'ta-e')) return;
      if (await warnIfDuplicateOrSameCard(deck, q, a, e)) return;
      deck.cards.push({ id:genId(), question:q, answer:a,
        explanation: e,
        imgs_q:[...imgBuf.q], imgs_a:[...imgBuf.a], imgs_e:[...imgBuf.e] });
      saveDecks(decks);
      document.getElementById('edit-counter').textContent = deck.cards.length + '枚';
      // ★ 修正：サーバー登録済み（filenameあり＝「作成中」含む）のデッキは、
      //   カードを1枚追加するたびに必ずサーバーへも反映しておく。
      //   ここで反映しないと、編集画面を出てもう一度開いたときの強制リロード
      //   （openEditDeck → loadDeckCardsWithRecovery）でサーバー側の
      //   古い（まだこのカードを知らない）データに上書きされ、
      //   せっかく追加したカードがローカルごと消えてしまう不具合があった。
      if (deck.filename) queueSyncDeckToServer(deck);
    }
  }
  if (mode === 'publish') {
    // ★ 未ログインチェック（公開ボタンを押した時だけ）／自前UIで確認する
    if (!getLoginSession()) {
      const proceedAnon = await showCmConfirm({
        title: 'ログインしていません',
        desc: 'このまま公開すると「匿名」として公開されます。',
        cancelLabel: 'ログイン画面へ',
        okLabel: '匿名のまま公開する',
        okStyle: 'blue',
      });
      if (!proceedAnon) {
        sessionStorage.setItem('post_login_redirect', location.href); // ログイン後に戻ってくる先を記憶
        location.href = LOGIN_PATH;
        return;
      }
    }
    // ★ 完成／未完成を選択してもらう（自前UI）。未完成なら通知なし（silent）で公開する
    const choice = await showCmChoiceDialog({
      title: 'このデッキは完成していますか？',
      desc: '未完成として公開すると、Discordへの通知は送られません。\nあとから編集して完成にできます。',
      choices: [
        { icon: Icons.html('checkCircle', {size:20}), label: '完成として公開する',   sub: '通知が送信されます',   value: 'complete' },
        { icon: Icons.html('dot', {size:26, color:'#eab308'}), label: '未完成として公開する', sub: '通知は送信されません', value: 'draft' },
      ],
    });
    if (!choice) return; // キャンセル
    // ★ deck.id だけを渡し、publishDeck 側で常に最新のdecks配列から探し直す
    //   （画面遷移で decks 配列が入れ替わっても更新が失われないようにするため）
    publishDeck(deck.id, choice === 'complete');
  } else if (mode === 'local') {
    saveDecks(decks);
    // ★ 修正：サーバー登録済み（公開予定／作成中を含む）のデッキは、
    //   「保存」ボタンでも公開確認は挟まずに、通知なし（silent）で
    //   静かにサーバーへ反映してから一覧に戻る。
    //   ここで反映しておかないと、いったん一覧に戻って次に編集画面を
    //   開き直したときの強制リロードで、まだサーバーに届いていない
    //   直前の変更が消えてしまう（以前あった不具合と同じ原因）。
    if (deck.filename) {
      // ★ 追加：サーバー反映を待つ間、押した感が分かるようスピナー表示にする
      const saveBtn = document.getElementById('btn-save-local');
      setBtnLoading(saveBtn, true, '保存中…');
      const ok = await queueSyncDeckToServer(deck);
      setBtnLoading(saveBtn, false);
      if (!ok) showBanner('サーバーへの保存に失敗しました（ローカルには保存済み）', '#fffbeb', '#92400e', Icons.html('warning', {size:15}));
    }
    showScreen('list');
  } else {
    clearEditor(); renderCreatedList();
    document.getElementById('edit-scroll').scrollTo(0,0);
    document.getElementById('ta-q').focus();
  }
}

// ★ deckId で受け取り、サーバーへの保存が完了するたびに毎回「最新のdecks配列」から
//   対象を探し直して更新する。
//   ─────────────────────────────────────────────
//   以前は deck オブジェクトへの参照を直接書き換えていたが、この関数の冒頭で
//   showScreen('list') を呼ぶと内部で decks = loadDecks() が実行され、
//   decks 配列全体が新しいオブジェクト群に入れ替わってしまう。
//   その結果、渡された deck オブジェクトは新しい decks 配列に含まれない
//   「孤立した参照」になり、公開完了後の filename 更新が保存されず
//   一覧表示がいつまでも「非公開」のままになる不具合があった。
async function publishDeck(deckId, isComplete = true) {
  saveDecks(decks); showScreen('list');

  // showScreen('list') 実行後の最新の decks から対象デッキを取得する
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return;

  const session = getLoginSession();
  // ★ 修正：choices/correct_indices（多肢選択デッキのカード）も含めて送るよう、
  //   他の同期経路と同じ cardToServerPayload を使う。以前はここだけ独自に
  //   固定6フィールドへ詰め替えていたため、多肢選択デッキを初めて
  //   「公開して保存」した瞬間に選択肢データが失われてしまっていた。
  const cards = deck.cards.map(cardToServerPayload);
  // ★ 追加：サーバー側の is_update（＝filenameが既に存在するか）だけでは、
  //   「作成中（作成時にannounceNewDeckToServerで登録済み）」のデッキが
  //   初めて『公開して保存』されたときも filename が既に存在するため
  //   「更新」と判定されてしまい、通知が「新規公開」ではなく「更新されました」
  //   という誤った文言になってしまっていた。
  //   ここでは「一度でも実際に『公開して保存』を経たことがあるか」
  //   （＝deck.notYetPublished）を見て、まだなら「これが初めての公開」として
  //   サーバーへ明示的に伝える。
  const isFirstPublish = deck.notYetPublished !== false;
  const body = {
    name: deck.name,
    cards,
    guild_id: GUILD_ID,
    session_token: session ? session.session_token : undefined,
    subject: deck.subject || null,                       // ★ 科目ごとのチャンネル振り分け用
    folder_id: deck.folderId || null,                     // ★ フォルダ所属（みんなで共有）
    publisher_id: session ? session.student_id : null,     // ★ 公開者の学籍番号
    publisher_nickname: session ? session.nickname : '匿名', // ★ 公開者のニックネーム
    silent: !isComplete, // ★ 未完成として公開する場合は通知しない
    incomplete: !isComplete, // ★ 未完成フラグをサーバーに保存し、他の人の端末にも表示させる
    first_publish: isFirstPublish, // ★ 追加：通知文言を「公開」/「更新」どちらにするか判定するためのヒント
    choice_mode: deck.choiceMode || null, // ★ 追加：多肢選択デッキかどうか
  };
  if (deck.filename) body.filename = deck.filename;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res  = await fetch(`${API_BASE}save_cards`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '不明なエラー');

    // ★ ここが重要：POST完了までの間にバックグラウンド同期（10秒ごとのポーリング等）
    //   で decks 配列が再び入れ替わっている可能性があるため、必ずこの時点で
    //   もう一度 loadDecks() し、id で探し直してから更新・保存する。
    decks = loadDecks();
    const target = decks.find(d => d.id === deckId);
    if (target) {
      target.filename = data.filename;
      target.count = target.cards.length;
      target.cardsLoaded = true; // ★ 今まさに公開したデッキなのでカード本体は既にこの端末にある
      target.published_by = session ? session.nickname : '匿名';
      target.incomplete = !isComplete; // ★ 一覧の未完成バッジ表示用に保持（サーバーにも保存済み）
      target.notYetPublished = false; // ★ 追加：「公開して保存」を実際に経たので、以降は未完成／公開済みで判定する
      saveDecks(decks);
    }
    renderDeckListUI();
    showBanner(
      isComplete ? '保存して公開しました！' : '未完成として公開しました（通知なし）',
      isComplete ? '#dcfce7' : '#fef9c3',
      isComplete ? '#166534' : '#854d0e',
      isComplete ? Icons.html('checkCircle', {size:15}) : Icons.html('dot', {size:15})
    );
  } catch(e) {
    showBanner('ローカルに保存しました（GitHub同期失敗）', '#fffbeb', '#92400e', Icons.html('save', {size:15}));
  }
}

// ★ 作成済みカード一覧の描画。各行にドラッグハンドル（⠿）を付け、
//   data-key にカードの安定キー（cardKey）を持たせておく。
//   ドラッグ処理側はこの data-key を使って最終的な並び順を復元する。
function renderCreatedList() {
  const deck = decks.find(d => d.id === currentDeckId);
  const section = document.getElementById('created-section');
  const list    = document.getElementById('created-list');
  if (!deck||!deck.cards.length) { section.style.display='none'; return; }
  section.style.display='block';
  list.innerHTML = deck.cards.map((c,i) => `
    <div class="created-item" data-key="${esc(cardKey(c))}">
      <span class="drag-handle" title="ドラッグして並び替え">⠿</span>
      <div class="created-item-num">${i+1}</div>
      <div class="created-item-body">
        <div class="created-item-q">${esc(mathToPlainText(c.question))}</div>
        <div class="created-item-a">${esc(mathToPlainText(c.answer))}</div>
      </div>
      <div class="created-item-btns">
        <button class="btn btn-ghost btn-sm" onclick="openCardEditModal(${i})">編集</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCardFromDeck(${i})">削除</button>
      </div>
    </div>`).join('');
}

// ============================================================
//  ★ 作成済みカードのドラッグ並び替えは Cardmaker-cardreorder.js に分離した
//  ─────────────────────────────────────────────
//  実体は別ファイルに移し、loadChunksInBackground() が背景で読み込む。
//  イベント委任のセットアップだけなので、こちらには呼び出し入口（プロキシ）
//  は不要。チャンクが読み込まれた時点で自動的にリスナーが登録される
//  （一覧の初期表示より後に読み込まれるが、編集画面を開いてカードを
//  ドラッグするまでには十分間に合う）。
// ============================================================

// ============================================================
//  ★ 追加：ホーム画面（デッキ・フォルダ一覧）の並び替え
//  ─────────────────────────────────────────────
//  ・スマホは横幅に余裕がないため、編集画面のような専用ハンドル（⠿）は
//    追加しない。代わりにカード本体（ボタン部分を除く）を長押しすると
//    そのまま並び替えモードに入る、という編集画面と同じ「掴んで動かす」
//    操作感をボタン無しで実現する。
//  ・短いタップはこれまで通り（フォルダを開く／何もしない）。
//    長押し＋移動、または長押しだけでも「ドラッグ扱い」とし、
//    指を離した瞬間に発生するクリックは openFolder 側で無視する
//    （cmDragJustEndedAt によるガード。冒頭のstate変数として定義済み）。
//  ・並び順はフォルダ・デッキ共通の data-key（例: "folder:xxx" / "deck:yyy"）で
//    保存し、フォルダ／デッキが混在したまま自由に並び替えられる。
//  ・renderDeckListUI() は毎回 #deck-grid の中身を丸ごと再生成するので、
//    要素ごとにリスナーを付けず、#deck-grid自体に1回だけイベント委任する。
// ============================================================
(function setupListDragReorder() {
  const grid = document.getElementById('deck-grid');
  if (!grid) return;

  const LONG_PRESS_MS  = 380; // これだけ指を止めたままにすると並び替えモードに入る
  const MOVE_CANCEL_PX = 10;  // 判定前にこれ以上動いたら「スクロール」とみなし長押しをキャンセル
  // ★ 修正：タッチ開始と同時に touch-action:none にしていたのをやめ、
  //   この時間（ms）だけ「様子見」してからtouch-action:noneを適用するようにする。
  //   詳細は onPointerDown 内のコメント参照。
  const TOUCH_ACTION_DELAY_MS = 60;

  // ★ 修正：grid の touch-action は 'pan-y'（縦スクロールはブラウザのネイティブ処理に任せる）にする。
  //   以前は常に 'none' にして、その代わりJSで手動スクロール（慣性込み）を
  //   再現していたが、ネイティブのスクロール感（滑らかさ・慣性・ラバーバンド等）
  //   には及ばず「うまくスクロールできない」原因になっていた。
  //   ─────────────────────────────────────────
  //   'pan-y' にしておくと、指を動かした瞬間にブラウザ側がそれを
  //   「スクロールしたいのだ」と判断してネイティブスクロールを開始してくれる
  //   （その際 pointercancel が飛んでくるので、下の onPointerUp 側で
  //   長押し判定を自動的にキャンセルできる）。
  //   一方、指を止めたまま LONG_PRESS_MS 経過すれば、その時点ではまだ
  //   ネイティブスクロールは始まっていないので、こちらで安全にドラッグ
  //   （並び替え）モードへ移行できる。
  grid.style.touchAction = 'pan-y';

  let pressTimer = null;
  let pressItem = null;
  let pressPointerId = null;
  let pressStartX = 0, pressStartY = 0;

  let dragEl = null;
  let startY = 0;
  let lastClientY = 0;
  let lastClientX = 0; // ★ 追加：フォルダの上に重なっているか判定するためX座標も保持する
  let autoScrollRAF = null;
  let scrollParent = null;

  // ★ 追加：デッキ／フォルダをドラッグ中、フォルダの上にしばらく重ねたままにしていると
  //   自動的にそのフォルダを開く（iOSのホーム画面でアプリをフォルダの上に重ねる操作と同様）。
  //   開くと同時に、掴んでいる項目も実際にそのフォルダの中へ移動させる
  //   （見た目だけ開いて中身のデータは元のフォルダのまま…という不整合を避けるため）。
  //   ★ 追加：逆に、間違えてフォルダに入ってしまった時のために、ドラッグしたまま画面上部の
  //     パンくず付近まで持ち上げると同じ仕組みで親フォルダへ戻れるようにしている
  //     （autoOpenFolderDuringDrag は「どこへ移動して開くか」を汎用的に扱うので、
  //     戻り先（親フォルダ）を渡せば「出る」動作もそのまま実現できる）。
  const HOVER_OPEN_MS = 650; // これだけ同じ場所（フォルダ／パンくず付近）で止めておくと自動的に反応する
  let hoverFolderEl = null;
  let hoverFolderTimer = null;
  let hoverOpenInProgress = false; // ★ フォルダ自動オープンの処理中に二重発火しないようにする
  // ★ バグ修正：デッキ／フォルダを掴んだ位置がたまたま画面の上端／下端付近
  //   （例：スクロールしてすぐ見えている一番上の項目を掴んだ場合など）だと、
  //   指を全く動かしていないのに自動スクロールが始まり、そのまま一番上／
  //   一番下まで一瞬で並び替わってしまう不具合があった。
  //   これを防ぐため「掴んだ位置（dragOriginY）からその方向へ実際に
  //   指を動かした」場合にだけ自動スクロールを有効にする。
  let dragOriginY = 0;
  const EDGE_ARM_PX = 24; // これだけ掴んだ位置から動かして初めて自動スクロールが有効になる

  // ★ touch-action:noneは「指がほとんど動かないまま少し待った後」にだけ適用する
  //   （＝TOUCH_ACTION_DELAY_MS。詳細はonPointerDown内のコメント参照）。
  //   これにより、普通のスワイプ操作はtouch-actionに一切触れられることなく
  //   ネイティブスクロールがそのまま働く。万一、猶予時間内に既にtouch-action:none
  //   が適用された直後に指が動いてしまった場合（レアなタイミングのケース）だけ、
  //   ネイティブスクロールはもう使えないのでJSの手動スクロールで代わりに動かす。
  let touchActionItem = null;   // touch-actionをnoneにした対象（後で元に戻すため）
  let touchActionTimer = null;  // ★ 追加：touch-action:noneを適用するまでの「様子見」タイマー
  let manualScrollActive = false;
  let manualScrollParent = null;
  let manualScrollLastY = 0;
  let manualScrollPointerId = null; // ★ cancelPress()でpressPointerIdがnullになった後も
                                     //   同じ指の動きを追跡し続けるための専用ID
  // ★ 追加：長押し判定中（またはtouch-action:noneの間）にスワイプへ切り替わった際の
  //   「手動スクロール」が、touchmoveのたびにscrollTopを直接書き換えていたため、
  //   ネイティブスクロールの滑らかさ・慣性に比べて「がくがく」して見えていた。
  //   ─────────────────────────────────────────
  //   毎フレーム（requestAnimationFrame）でまとめて1回だけscrollTopを反映するように
  //   バッチ化し、体感の滑らかさをネイティブスクロールに近づける。
  let manualScrollPendingDelta = 0;
  let manualScrollRAF = null;

  function getItems() {
    return Array.from(grid.querySelectorAll(':scope > .deck-card'));
  }

  // ★ HTML構造に依存せず、実際にスクロールしている祖先要素を探す
  //   （このページの実際のスクロール領域は .cm-scroll-body だが、
  //   将来レイアウトが変わっても壊れないように動的に探す）
  function findScrollParent(el) {
    let node = el.parentElement;
    while (node) {
      const style = getComputedStyle(node);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
        return node;
      }
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function autoScrollTick() {
    if (!dragEl || !scrollParent) { autoScrollRAF = null; return; }
    const rect = scrollParent.getBoundingClientRect();
    const edge = 60, maxSpeed = 14;
    let speed = 0;
    // ★ 修正：端に近いだけでなく、掴んだ位置からその方向へ実際に
    //   EDGE_ARM_PX 以上動かしていることも条件に加える。
    if (lastClientY < rect.top + edge && lastClientY < dragOriginY - EDGE_ARM_PX) {
      speed = -maxSpeed * Math.min(1, (rect.top + edge - lastClientY) / edge);
    } else if (lastClientY > rect.bottom - edge && lastClientY > dragOriginY + EDGE_ARM_PX) {
      speed = maxSpeed * Math.min(1, (lastClientY - (rect.bottom - edge)) / edge);
    }
    if (speed !== 0) {
      const before = scrollParent.scrollTop;
      scrollParent.scrollTop += speed;
      const actualDelta = scrollParent.scrollTop - before;
      if (actualDelta !== 0) { startY -= actualDelta; moveDrag(lastClientX, lastClientY); }
    }
    autoScrollRAF = requestAnimationFrame(autoScrollTick);
  }

  function beginDrag(item, clientY, initialDy) {
    initialDy = initialDy || 0; // ★ 追加：フォルダ切り替え直後の再開時、指の位置とカードの見た目を
                                 //   一致させるための初期オフセット（通常の掴み始めは0でよい）
    dragEl = item;
    cmListDragActive = true; // ★ ドラッグ中は renderDeckListUI() 側で再描画をスキップさせる
    startY = clientY - initialDy;
    lastClientY = clientY;
    dragOriginY = clientY; // ★ 追加：自動スクロール発動判定の基準点
    scrollParent = findScrollParent(grid);
    dragEl.classList.add('dragging');
    dragEl.style.position = 'relative';
    dragEl.style.zIndex = '10';
    dragEl.style.boxShadow = '0 6px 18px rgba(0,0,0,.20)';
    dragEl.style.opacity = '0.92';
    dragEl.style.touchAction = 'none';
    dragEl.style.transform = `translateY(${initialDy}px) scale(1.02)`;
    if (navigator.vibrate) navigator.vibrate(12); // ★ つかんだ瞬間に軽い振動でフィードバック（対応端末のみ）
    if (autoScrollRAF === null) autoScrollRAF = requestAnimationFrame(autoScrollTick);
  }

  function moveDrag(clientX, clientY) {
    if (!dragEl) return;
    lastClientY = clientY;
    lastClientX = clientX;
    const dy = clientY - startY;
    dragEl.style.transform = `translateY(${dy}px) scale(1.02)`;

    const dragRect = dragEl.getBoundingClientRect();
    const dragCenter = dragRect.top + dragRect.height / 2;

    const items = getItems();
    for (const other of items) {
      if (other === dragEl) continue;
      const r = other.getBoundingClientRect();
      const otherCenter = r.top + r.height / 2;
      const otherIsAfter = !!(dragEl.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (otherIsAfter && dragCenter > otherCenter) {
        grid.insertBefore(dragEl, other.nextSibling);
        startY = clientY;
        dragEl.style.transform = 'translateY(0px) scale(1.02)';
        break;
      } else if (!otherIsAfter && dragCenter < otherCenter) {
        grid.insertBefore(dragEl, other);
        startY = clientY;
        dragEl.style.transform = 'translateY(0px) scale(1.02)';
        break;
      }
    }

    // ★ 追加：フォルダの上に重なっているかどうかをチェックし、重なっていれば
    //   一定時間後に自動的にそのフォルダを開く
    checkHoverFolder(clientX, clientY);
  }

  // ★ 追加：指（ポインタ）の真下にあるフォルダカード、または画面上部のパンくず付近を調べ、
  //   少しの間そこに留まっていたら自動的に「フォルダの中へ入る」／「親フォルダへ戻る」を行う。
  //   ドラッグ中の要素自身は判定対象から除外する。
  function checkHoverFolder(clientX, clientY) {
    if (!dragEl || hoverOpenInProgress) return;

    // ① まず「パンくず付近まで持ち上げたら親フォルダへ戻る」ゾーンを判定する
    //   （フォルダの中にいる時だけ。ルート表示中は戻り先が無いので対象外）
    const exitZone = getExitZoneRect();
    if (exitZone && clientY <= exitZone.bottom) {
      const parentFolder = folders.find(f => f.id === currentFolderId);
      const parentId = parentFolder ? (parentFolder.parentId ?? null) : null;
      const dragKey = dragEl.dataset.key;
      let ok = true;
      if (dragKey.startsWith('folder:')) {
        ok = canMoveFolderTo(dragKey.slice('folder:'.length), parentId);
      } else {
        const deckId = resolveDeckIdFromDragKey(dragKey);
        ok = deckId ? canMoveDeckTo(deckId, parentId) : true;
      }
      if (ok) {
        applyHoverTarget(exitZone.el, parentId);
        return;
      }
    }

    // dragEl自身が指の真下にあるとelementFromPointがそれを拾ってしまうため、
    // 判定中だけ一時的にpointer-eventsを外して「透明」にする
    const prevPE = dragEl.style.pointerEvents;
    dragEl.style.pointerEvents = 'none';
    const under = document.elementFromPoint(clientX, clientY);
    dragEl.style.pointerEvents = prevPE;

    const folderCard = under ? under.closest('.folder-card') : null;
    let targetFolderId = null;

    if (folderCard && folderCard.parentElement === grid && folderCard !== dragEl) {
      const fid = folderCard.dataset.key.slice('folder:'.length);
      const dragKey = dragEl.dataset.key;
      // 掴んでいるのがフォルダで、その移動先が自分自身／自分の子孫フォルダの場合は
      // 開けない（無限ループ・不正な階層構造の防止。canMoveFolderToで判定）
      if (dragKey.startsWith('folder:')) {
        const draggedFolderId = dragKey.slice('folder:'.length);
        if (canMoveFolderTo(draggedFolderId, fid)) targetFolderId = fid;
      } else {
        const deckId = resolveDeckIdFromDragKey(dragKey);
        if (!deckId || canMoveDeckTo(deckId, fid)) targetFolderId = fid;
      }
    }

    if (targetFolderId) {
      applyHoverTarget(folderCard, targetFolderId);
    } else {
      clearHoverFolder();
    }
  }

  // ★ 追加：② のゾーン判定用。画面上部のパンくずバー付近（少し余白を持たせた範囲）を返す。
  //   ルート表示中（パンくず非表示）は戻り先が無いのでnullを返す。
  function getExitZoneRect() {
    if (!currentFolderId) return null;
    const bar = document.getElementById('folder-breadcrumb');
    if (!bar || getComputedStyle(bar).display === 'none') return null;
    const r = bar.getBoundingClientRect();
    const PAD = 16; // パンくずの少し上・下まで含めて「持ち上げたら戻る」を反応しやすくする
    return { top: r.top - PAD, bottom: r.bottom + PAD, el: bar };
  }

  // ★ 追加：ホバー対象（フォルダカード or パンくず）が確定した際の共通処理。
  //   同じ対象に留まり続けている間だけタイマーを進め、離れたらリセットする。
  function applyHoverTarget(el, targetFolderId) {
    if (hoverFolderEl === el) return; // 既に同じ対象を計測中
    clearHoverFolder();
    hoverFolderEl = el;
    // ★ 重ねている間、見た目でも分かるようにハイライトする
    hoverFolderEl.style.outline = '3px solid #3b82f6';
    hoverFolderEl.style.outlineOffset = '-3px';
    hoverFolderTimer = setTimeout(() => {
      hoverFolderTimer = null;
      autoOpenFolderDuringDrag(targetFolderId);
    }, HOVER_OPEN_MS);
  }

  function clearHoverFolder() {
    if (hoverFolderTimer) { clearTimeout(hoverFolderTimer); hoverFolderTimer = null; }
    if (hoverFolderEl) {
      hoverFolderEl.style.outline = '';
      hoverFolderEl.style.outlineOffset = '';
      hoverFolderEl = null;
    }
  }

  // ★ 追加：ドラッグ中の項目を、指を重ねていたフォルダの中へ実際に移動させたうえで、
  //   そのフォルダを自動的に開く。開いた後も同じ項目のドラッグをそのまま継続できるようにする。
  async function autoOpenFolderDuringDrag(targetFolderId) {
    if (!dragEl) return;
    hoverOpenInProgress = true;
    clearHoverFolder();

    const key = dragEl.dataset.key;

    try {
      if (key.startsWith('folder:')) {
        const fid = key.slice('folder:'.length);
        const f = folders.find(x => x.id === fid);
        if (!f) return;
        f.parentId = targetFolderId; // 楽観的にローカルへ反映
        saveFoldersCache(folders);
        fetch(`${API_BASE}save_folder`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: f.id, name: f.name, parent_id: targetFolderId, nickname: getLoginSession()?.nickname }),
          signal: AbortSignal.timeout(8000),
        }).then(res => res.json()).then(data => {
          if (!data.ok) showBanner('フォルダ移動のサーバー反映に失敗しました', '#fffbeb', '#92400e', Icons.html('warning', {size:15}));
          else fetchAndMergeFolders();
        }).catch(() => showBanner('フォルダ移動のサーバー反映に失敗しました（この端末には保存済み）', '#fffbeb', '#92400e', Icons.html('warning', {size:15})));
      } else {
        const d = key.startsWith('deck:')
          ? decks.find(x => x.filename === key.slice('deck:'.length))
          : decks.find(x => x.id === key.slice('localdeck:'.length));
        if (!d) return;
        if (d.filename) {
          const loaded = await loadDeckCardsWithRecovery(d.id);
          if (!loaded || !dragEl) return; // ユーザーが「やめる」を選んだ／その間にドラッグが終了した場合は中断
        }
        d.folderId = targetFolderId;
        saveDecks(decks);
        if (d.filename) {
          queueSyncDeckToServer(d).then(ok => {
            if (!ok) showBanner('サーバーへの移動の反映に失敗しました（ローカルには保存済み）', '#fffbeb', '#92400e', Icons.html('warning', {size:15}));
          });
        }
      }

      if (!dragEl) return; // 上のawait中に指が離された場合はここで終了

      // ★ 追加：フォルダを切り替える直前の「見た目の位置」と、その時点の最新の指の位置を
      //   ここで（＝各種await完了後の最新の状態で）確定させる。デッキ読み込み待ちなどの
      //   非同期処理中に指が動いていた場合でも、ここで最新値を使うことでズレを防ぐ。
      const oldVisualTop = dragEl.getBoundingClientRect().top;
      const resumeClientX = lastClientX;
      const resumeClientY = lastClientY;

      // フォルダを開く
      currentFolderId = targetFolderId;

      // ★ ドラッグ中は renderDeckListUI() が丸ごとスキップされるため、ここだけ
      //   一時的にガードを外して再描画し、開いたフォルダの中身を表示する。
      const wasDragActive = cmListDragActive;
      cmListDragActive = false;
      renderDeckListUI();
      cmListDragActive = wasDragActive;

      const body = document.querySelector('#screen-list .cm-scroll-body');
      if (body) body.scrollTop = 0;

      // ★ 再描画で古いdragEl要素はDOMから外れてしまったので、新しく描画された
      //   同じ項目（data-keyで特定）を探し直し、そのままドラッグを継続する。
      //   （ファイル名に特殊文字を含む可能性があるためCSSセレクタは使わずJSで探す）
      const newEl = getItems().find(it => it.dataset.key === key) || null;
      if (newEl) {
        // ★ 新しく描画された要素は、開いたフォルダの一覧の中の「自然な位置」に
        //   配置されている（＝指の位置とは無関係）。切り替え直前の見た目の位置
        //   （oldVisualTop）との差分を初期オフセットとして与えることで、
        //   カードが指の位置からずれずにそのまま連続して見えるようにする。
        const newNaturalTop = newEl.getBoundingClientRect().top;
        const initialDy = oldVisualTop - newNaturalTop;
        beginDrag(newEl, resumeClientY, initialDy);
        lastClientX = resumeClientX;
        // ★ 重要：ここで新しい要素にポインターキャプチャを張り直す。
        //   フォルダを開き直す際に元の要素をDOMごと作り直しているため、
        //   長押し開始時に張ったキャプチャ（pressItem側）が外れてしまう。
        //   張り直さないと、この後 指がパンくず付近（#deck-grid の外）に
        //   出た瞬間から pointermove/pointerup が grid に届かなくなり、
        //   endDrag() が一切呼ばれずに touch-action:none 等が要素に残り続けて
        //   「スクロールも何もできなくなる」不具合の原因になる。
        try { newEl.setPointerCapture(pressPointerId); } catch (_) {}
      } else {
        // 万一見つからなければドラッグ状態を安全に終了させる
        dragEl = null;
        cmListDragActive = false;
      }
    } finally {
      hoverOpenInProgress = false;
    }
  }

  function endDrag() {
    if (!dragEl) return;
    clearHoverFolder(); // ★ ドロップ時にフォルダのハイライト・自動オープン待ちタイマーを解除する
    if (autoScrollRAF !== null) { cancelAnimationFrame(autoScrollRAF); autoScrollRAF = null; }
    dragEl.classList.remove('dragging');
    dragEl.style.transform = '';
    dragEl.style.zIndex = '';
    dragEl.style.boxShadow = '';
    dragEl.style.opacity = '';
    dragEl.style.position = '';
    dragEl.style.touchAction = '';
    dragEl = null;
    cmListDragActive = false; // ★ 再描画スキップガードを解除（次のポーリングで最新状態に更新される）

    // ★ DOM上の最終的な並び順（data-key）をこのフォルダのスコープに保存する
    const orderedKeys = getItems().map(it => it.dataset.key);
    saveListOrder(currentFolderId, orderedKeys);

    // ★ フォルダ／公開済みデッキ（＝みんなに共有される項目）が含まれていれば、
    //   サーバーにも反映して他の人の一覧にも同じ並びを届ける。
    //   自分だけの下書きデッキしか含まれていない場合はサーバー通信自体を省略する。
    if (orderedKeys.some(isSharedOrderKey)) {
      pushSharedOrderToServer(currentFolderId, orderedKeys).then(ok => {
        if (!ok) showBanner('並び替えのサーバー反映に失敗しました（この端末には保存済み）', '#fffbeb', '#92400e', Icons.html('warning', {size:15}));
      });
    }

    // ★ 指を離した瞬間に発生するクリックで意図せずフォルダが開かないようにするガード
    cmDragJustEndedAt = Date.now();
  }

  function cancelPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    if (touchActionTimer) { clearTimeout(touchActionTimer); touchActionTimer = null; } // ★ 追加
    pressItem = null; pressPointerId = null;
    // ★ 追加：実際のドラッグに移行しなかった（＝dragElがまだ無い）場合だけ、
    //   ここで再描画ブロックを解除する。既にドラッグ中（dragElあり）の場合は
    //   endDrag() 側の解除に任せる（そちらの方が後）。
    if (!dragEl) cmListDragActive = false;
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (dragEl) return; // 既に別の指・別のポインタでドラッグ中
    const item = e.target.closest('.deck-card');
    if (!item || item.parentElement !== grid) return;
    // ▶プレイ／✏️メニューなどのボタンから始まった場合は、通常のタップ操作を優先する
    if (e.target.closest('button, .btn, .icon-btn, a')) return;

    pressItem = item;
    pressPointerId = e.pointerId;
    pressStartX = e.clientX;
    pressStartY = e.clientY;
    // ★ バグ修正：長押し判定が成立する前（pressTimer発火前）の待機中に
    //   バックグラウンドポーリングなどから renderDeckListUI() が呼ばれて
    //   #deck-grid が丸ごと作り直されると、pressItem が新しいDOMから浮いた
    //   「孤立した古い要素」になってしまう。その状態で長押しが成立して
    //   beginDrag(pressItem, ...) が呼ばれると、既に画面上に新しく描画された
    //   本物の項目とは別に、この孤立した古い要素も見た目上表示されてしまい、
    //   「デッキ／フォルダが一時的に2つ表示される」不具合の原因になっていた。
    //   これを防ぐため、長押し判定中（＝指を置いてから離す/確定するまでの間）も
    //   ドラッグ中と同様に再描画をスキップさせる。
    cmListDragActive = true;

    if (e.pointerType === 'touch') {
      // ★ 修正：以前はタッチ開始と同時にtouch-action:noneにしていたが、
      //   これだと普通にスワイプでスクロールしたいだけの操作でも、その瞬間だけ
      //   ネイティブスクロールが止められてしまい「スワイプしづらい／引っかかる」
      //   原因になっていた（この後JS側の手動スクロールに切り替わるが、
      //   慣性が無いぶんネイティブスクロールより明らかに動きが重くなる）。
      //   ─────────────────────────────────────────
      //   そこで、指を置いてからTOUCH_ACTION_DELAY_MSの間だけ「様子見」し、
      //   その間に指がある程度動けば「スクロールしたいのだ」と判断して
      //   このタイマーをキャンセルする（＝touch-actionには一切触れず、
      //   ネイティブスクロールに完全に任せる。onPointerMove側もこの場合は
      //   手動スクロールへ切り替えない）。
      //   逆に、その間ほとんど動かなければ「長押し（並び替え）したいのだ」と
      //   判断してtouch-action:noneを適用する。このタイミングであれば、
      //   まだ最初のtouchmoveが発生していないため、iOS Safariでも問題なく
      //   反映される（「長押し成立後（380ms後）まで遅らせると手遅れになる」
      //   というのは、その間に指がある程度動いてしまっているケースの話）。
      manualScrollParent = findScrollParent(item);
      manualScrollLastY = e.clientY;
      manualScrollActive = false;
      touchActionTimer = setTimeout(() => {
        touchActionTimer = null;
        if (pressItem !== item) return; // 既に指を離した／スクロールに切り替わっていたら何もしない
        touchActionItem = item;
        touchActionItem.style.touchAction = 'none';
      }, TOUCH_ACTION_DELAY_MS);
    }

    pressTimer = setTimeout(() => {
      pressTimer = null;
      if (!pressItem) return;
      // ★ 追加の安全策：万一ここまでの間に何らかの理由で pressItem が
      //   #deck-grid から外れてしまっていたら（＝孤立した古い要素なら）、
      //   ドラッグを開始せずに静かに諦める（見た目上の複製を防ぐ）。
      if (!pressItem.isConnected || pressItem.parentElement !== grid) { cancelPress(); return; }
      try { pressItem.setPointerCapture(pressPointerId); } catch (_) {}
      lastClientX = pressStartX; // ★ フォルダ重なり判定の初期X座標
      beginDrag(pressItem, pressStartY);
    }, LONG_PRESS_MS);
  }

  // ★ 追加：手動スクロールの差分（manualScrollPendingDelta）を、画面の描画タイミング
  //   （requestAnimationFrame）に合わせて1フレームに1回だけ scrollTop へ反映する。
  function manualScrollTick() {
    manualScrollRAF = null;
    if (!manualScrollActive) { manualScrollPendingDelta = 0; return; }
    if (manualScrollPendingDelta !== 0 && manualScrollParent) {
      manualScrollParent.scrollTop += manualScrollPendingDelta;
      manualScrollPendingDelta = 0;
    }
  }

  function onPointerMove(e) {
    if (dragEl && e.pointerId === pressPointerId) {
      e.preventDefault();
      moveDrag(e.clientX, e.clientY);
      return;
    }
    // ★ 長押し判定キャンセル後も、cancelPress()でpressPointerIdはnullに
    //   なってしまうため、同じ指の手動スクロールは別IDで追跡を続ける。
    if (manualScrollActive && e.pointerId === manualScrollPointerId) {
      e.preventDefault();
      // ★ 修正：以前はここで毎回 scrollTop を直接書き換えていたため、
      //   touchmoveイベントの発火間隔のブレがそのまま描画のガタつき
      //   （がくがく）として見えてしまっていた。
      //   ここでは差分を貯めておくだけにし、実際の反映は下のrAFループで
      //   画面の描画タイミングに合わせて1回ずつまとめて行うことで、
      //   ネイティブスクロールに近い滑らかさにする。
      const delta = manualScrollLastY - e.clientY; // 指を上に動かした→下にスクロール
      manualScrollPendingDelta += delta;
      manualScrollLastY = e.clientY;
      if (manualScrollRAF === null) manualScrollRAF = requestAnimationFrame(manualScrollTick);
      return;
    }

    if (pressPointerId === null || e.pointerId !== pressPointerId) return; // 追跡中の指以外は無視

    // 長押し確定前：しきい値を超えて動いたら「スクロールしたいのだ」とみなし、
    // 長押し判定をキャンセルする。
    // ★ タッチの場合は touch-action:none にしてあるためネイティブスクロールは
    //   もう発生しないので、以降はこちらで手動スクロールを行う。
    if (pressTimer) {
      const dx = e.clientX - pressStartX, dy = e.clientY - pressStartY;
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
        // ★ 修正：touch-actionがまだ'none'になっていない（＝touchActionTimerがまだ
        //   発火していない）場合は、ネイティブスクロールがまだ生きているということなので
        //   JSの手動スクロールへ切り替える必要はない（切り替えると二重にスクロールして
        //   カクつく）。touchActionItemが既にセットされている場合だけ、ネイティブ
        //   スクロールがもう使えない状態なので手動スクロールで代わりに動かす。
        if (e.pointerType === 'touch' && touchActionItem) {
          manualScrollPointerId = e.pointerId;
          manualScrollActive = true;
        }
        cancelPress();
      }
    }
  }

  function resetTouchAction() {
    if (manualScrollRAF !== null) { cancelAnimationFrame(manualScrollRAF); manualScrollRAF = null; }
    manualScrollPendingDelta = 0;
    if (touchActionItem) { touchActionItem.style.touchAction = ''; touchActionItem = null; }
    manualScrollActive = false;
    manualScrollParent = null;
    manualScrollPointerId = null;
  }

  function onPointerUp(e) {
    if (dragEl && e.pointerId === pressPointerId) { endDrag(); cancelPress(); resetTouchAction(); return; }
    if (e.pointerId === pressPointerId) { cancelPress(); resetTouchAction(); return; }
    if (e.pointerId === manualScrollPointerId) { resetTouchAction(); }
  }

  grid.addEventListener('pointerdown', onPointerDown);
  grid.addEventListener('pointermove', onPointerMove, { passive: false });
  grid.addEventListener('pointerup', onPointerUp);
  grid.addEventListener('pointercancel', onPointerUp);

  // ★ 追加の保険：フォルダの自動オープン／自動で戻る操作の直後は、指が一時的に
  //   #deck-grid の外（パンくず付近など）にあることがあり、万一ポインターキャプチャの
  //   張り直しがうまく効かない端末があっても、指を離した／キャンセルされたイベント自体は
  //   documentまでは必ずバブリングしてくる。ここで拾って必ず後片付け（endDrag等）が
  //   走るようにし、touch-action:none等が要素に残り続ける事故を防ぐ。
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);

  // ★ 修正：並び替え中にスマホの画面が勝手にスクロールしてしまう不具合の対策。
  //   ─────────────────────────────────────────
  //   このコードは「触れた瞬間に対象カードの touch-action を 'none' にすれば、
  //   その後のブラウザのネイティブスクロールを抑えられる」という前提で
  //   組まれているが、実機（特にAndroid Chromeなど）では pointerdown 内で
  //   touch-action を書き換えても、タイミングによってはブラウザ側の
  //   ジェスチャー判定に間に合わず、ネイティブの縦スクロールが始まってしまう
  //   ことがある。その場合、長押しでドラッグが「始まったように見える」のに
  //   指を動かすと画面ごとスクロールしてしまう、という症状になる。
  //   touch-action の設定タイミングに依存しない、より確実な方法として、
  //   素の touchmove イベントを passive:false で監視し、このカード上で
  //   長押し判定中・ドラッグ中・手動スクロール中のいずれかであれば
  //   毎回 e.preventDefault() してネイティブスクロールの発生自体を止める。
  function onNativeTouchMove(e) {
    // ★ 修正：以前は「長押し判定中（pressPointerId !== null）」というだけで
    //   毎回 preventDefault していたため、ただのスワイプでも最初の一瞬だけ
    //   ネイティブスクロールが止められ「スワイプしづらい」原因になっていた。
    //   touchActionItem（＝実際にtouch-action:noneを適用した対象）がある時だけ
    //   preventDefaultすれば十分で、それ以外（様子見中）はネイティブスクロールに
    //   触れないようにする。
    if (dragEl || manualScrollActive || touchActionItem) {
      e.preventDefault();
    }
  }
  grid.addEventListener('touchmove', onNativeTouchMove, { passive: false });
})();

async function deleteCardFromDeck(idx) {
  const ok = await showCmConfirm({
    title: 'このカードを削除しますか？', okLabel: '削除する', okStyle: 'danger',
  });
  if (!ok) return;
  const deck = decks.find(d => d.id === currentDeckId);
  deck.cards.splice(idx, 1); saveDecks(decks);
  document.getElementById('edit-counter').textContent = deck.cards.length + '枚';
  renderCreatedList();
  // ★ 修正：追加時と同じ理由で、削除もサーバー登録済みなら即座に反映しておく
  //   （そうしないと、次に編集画面を開いたときの強制リロードで
  //     削除前の古いカードがサーバーから復活してしまう）
  if (deck.filename) queueSyncDeckToServer(deck);
}
async function confirmLeaveEdit() {
  const ok = await showCmConfirm({
    title: '編集を終了しますか？', desc: '一覧画面に戻ります。',
    okLabel: '終了する', okStyle: 'blue',
  });
  if (ok) showScreen('list');
}

// ── カード編集モーダル（デッキ編集画面 / 学習画面 共通） ─────
let editingDeckId  = null;
let editingCardKey = null;
let editingContext = 'editor'; // 'editor'（デッキ編集画面）| 'study'（プレイ中）

// ★ 追加：カード編集モーダル内での画像編集用バッファ
//   デッキ編集画面の新規カード作成用バッファ（imgBuf）とは別に持つことで、
//   モーダルを開いている最中に新規カード作成側のバッファを壊さないようにする。
let editImgBuf = { q: [], a: [], e: [] };
// ★ 追加：img-file-input の change イベントが「新規カード作成用（editor）」と
//   「カード編集モーダル用（modal）」のどちらから呼ばれたかを区別するためのフラグ
let imgContext = 'editor';

// ★ 追加：カード編集モーダルを開く前に、公開済みデッキなら
//   サーバーから最新のカードを読み込み直しておく（一度だけ）。
//   ─────────────────────────────────────────
//   他の端末・他の人が先に編集して公開していた場合、古いキャッシュの
//   まま編集して保存すると、その人の変更を上書きして消してしまう。
//   これを防ぐため、モーダルを開く直前に必ず最新化する。
//   （失敗時は loadDeckCardsWithRecovery が再試行/中止をユーザーに委ねる）
async function reloadCardBeforeEdit(deckId) {
  const deck = decks.find(d => d.id === deckId);
  if (!deck || !deck.filename) return true; // 未公開デッキはローカルのみなので不要
  // ★ 修正：例えば「10番のカードを作って次へ→すぐ6番を編集」のように、
  //   直前の追加/削除のサーバー同期（queueSyncDeckToServer）がまだ完了していない
  //   状態でここに来ることがある。その状態でいきなり強制リロードすると、
  //   サーバーがまだ知らない直前の変更がこの端末からも消えてしまうため、
  //   まず保留中の同期処理の完了を待ってから最新化する。
  await waitForPendingSync(deckId);
  return await loadDeckCardsWithRecovery(deckId);
}

async function openCardEditModal(idx) {
  const deck = decks.find(d => d.id === currentDeckId);
  if (!deck) return;
  // ★ 修正：ここは「今まさにこの端末で開いているデッキ編集画面」の中で、
  //   同じデッキの別のカードを編集するケース。openEditDeck() が
  //   この編集セッションの最初に既にサーバーから最新化しており、それ以降の
  //   追加・削除もローカル→サーバーの順に同期キューへ積まれている。
  //   ここで毎回さらに強制的にサーバーから取り直すと、
  //   直前に送った変更がサーバー側にまだ反映しきっていない（反映に数秒かかる等）
  //   タイミングでは、その反映前の古い内容で上書きしてしまい、
  //   「10番を作って次へ→すぐ6番を編集」のような操作でカードが消える事故に
  //   つながっていた。この画面の中で編集する分には、この端末のローカルの内容が
  //   最新であることは保証されているため、強制リロードはしない。
  const freshCard = deck.cards[idx];
  if (!freshCard) return;
  openCardEditModalCommon(deck.id, freshCard, 'editor');
}

// ★ プレイ中に今表示しているカードを編集する
async function editCurrentStudyCard() {
  const c = studyCards[studyIdx];
  if (!c) return;
  const deckId = c.__deckId || studyDeckId; // ★
  const key = cardKey(c);

  const ok = await reloadCardBeforeEdit(deckId);
  if (!ok) return; // ユーザーが読み込みを中止した

  const deck = decks.find(d => d.id === deckId);
  const freshCard = deck ? deck.cards.find(x => cardKey(x) === key) : null;
  if (!freshCard) {
    await showCmAlert({ title: 'このカードは既に削除されています', desc: '最新の内容に更新しました。' });
    return;
  }
  openCardEditModalCommon(deckId, freshCard, 'study');
}

let editingIsQuizChoice = false; // ★ 選択式カード（多肢選択デッキ／クイズ過去問デッキ）を編集中かどうか

function openCardEditModalCommon(deckId, c, context) {
  editingDeckId  = deckId;
  editingCardKey = cardKey(c);
  editingContext = context;
  // ★ choices を持つカードは、通常の解答/解説欄の代わりに選択肢入力欄を表示する。
  //   単一/複数正解はデッキ／カードのどちらにもモードを持たせず、常にチェックボックスで
  //   表示し、チェックした個数だけで自動的に決まる。
  editingIsQuizChoice = Array.isArray(c.choices) && c.choices.length >= CHOICE_MIN;

  document.getElementById('modal-edit-q').value = mathToPlainText(c.question);
  autoResize(document.getElementById('modal-edit-q'));
  document.getElementById('modal-edit-q').dispatchEvent(new Event('input', { bubbles: true }));

  document.getElementById('modal-edit-answer-block').style.display      = editingIsQuizChoice ? 'none' : '';
  document.getElementById('modal-edit-choices-block').style.display     = editingIsQuizChoice ? '' : 'none';
  document.getElementById('modal-edit-explanation-block').style.display = editingIsQuizChoice ? 'none' : '';

  if (editingIsQuizChoice) {
    // ★ 旧形式（correct_index単数）のカードにも対応する
    const correctIndices = Array.isArray(c.correct_indices) ? c.correct_indices
      : (typeof c.correct_index === 'number' ? [c.correct_index] : []);
    renderChoiceEditorRows('modal-edit-choice', c.choices, correctIndices);
    // ★ 問題文の画像だけはこのモードでも使う（imgs_q）
    editImgBuf = { q: [...(c.imgs_q || [])], a: [], e: [] };
    renderModalImgStrip('q');
  } else {
    document.getElementById('modal-edit-a').value = mathToPlainText(c.answer);
    document.getElementById('modal-edit-e').value = mathToPlainText(c.explanation||'');
    ['modal-edit-a','modal-edit-e'].forEach(id => {
      const el = document.getElementById(id);
      autoResize(el);
      el.dispatchEvent(new Event('input', { bubbles: true })); // ★ 既存の数式プレビューを反映させる
    });

    // ★ 追加：既存の画像をモーダル専用バッファへコピーして表示する
    //   （元の配列を直接触らず、保存時にまとめて書き戻すため）
    editImgBuf = {
      q: [...(c.imgs_q || [])],
      a: [...(c.imgs_a || [])],
      e: [...(c.imgs_e || [])],
    };
    ['q','a','e'].forEach(k => renderModalImgStrip(k));
  }

  document.getElementById('card-edit-ok').style.display  = 'none';
  document.getElementById('card-edit-err').style.display = 'none';
  openModal('modal-card-edit');
}

async function saveCardEdit() {
  const q = document.getElementById('modal-edit-q').value.trim();
  const errBar = document.getElementById('card-edit-err');

  // ★「クイズ過去問」デッキの4択カードは、通常の解答/解説とは別の保存経路にする
  if (editingIsQuizChoice) {
    return saveQuizChoiceCardEdit(q, errBar);
  }

  const a = document.getElementById('modal-edit-a').value.trim();
  const e = document.getElementById('modal-edit-e').value.trim();
  if (!q || !a) {
    errBar.innerHTML = Icons.html('close', {size:14}) + ' 問題文と解答は必須です';
    errBar.style.display = 'block';
    setTimeout(() => errBar.style.display = 'none', 3000);
    return;
  }
  if (await warnIfBugChars(q, 'modal-edit-q')) return;
  if (await warnIfBugChars(a, 'modal-edit-a')) return;
  if (await warnIfBugChars(e, 'modal-edit-e')) return;
  const deck = decks.find(d => d.id === editingDeckId);
  if (!deck) { closeModal('modal-card-edit'); return; }
  const idx = deck.cards.findIndex(c => cardKey(c) === editingCardKey);
  if (idx === -1) { closeModal('modal-card-edit'); return; }

  if (await warnIfDuplicateOrSameCard(deck, q, a, e, idx)) return;

  // 既存オブジェクトを直接書き換える
  const card = deck.cards[idx];
  card.question    = q;
  card.answer      = a;
  card.explanation = e;
  // ★ 追加：画像もモーダルバッファから書き戻す
  card.imgs_q = [...editImgBuf.q];
  card.imgs_a = [...editImgBuf.a];
  card.imgs_e = [...editImgBuf.e];

  // ★ studyCards 側（プレイ中の配列）にも同期する。
  //   以前は deck.cards と同じオブジェクト参照だったため自動的に反映されていたが、
  //   カード編集前に deck.cards を丸ごと読み込み直すようになったため、
  //   もはや同じ参照とは限らない。取りこぼさないよう明示的に書き戻す。
  const studySameIdx = studyCards.findIndex(sc =>
    cardKey(sc) === editingCardKey && (sc.__deckId || studyDeckId) === deck.id
  );
  if (studySameIdx !== -1) {
    const sc = studyCards[studySameIdx];
    sc.question = q; sc.answer = a; sc.explanation = e;
    sc.imgs_q = [...editImgBuf.q]; sc.imgs_a = [...editImgBuf.a]; sc.imgs_e = [...editImgBuf.e];
  }

  saveDecks(decks);
  closeModal('modal-card-edit');

  if (editingContext === 'study') {
    refreshStudyCardDisplay(card);
  } else if (editingContext === 'listview') {
    // ★ 追加：一覧表示画面から編集した場合はその一覧を再描画する
    renderListView();
  } else {
    renderCreatedList();
  }

  // ★ 公開済みならサーバー（GitHub）側にも反映する
  if (deck.filename) {
    const ok = await queueSyncDeckToServer(deck);
    if (ok) {
      showBanner('保存しました', '#dcfce7', '#166534', Icons.html('save', {size:15}));
    } else {
      showBanner('サーバーへの反映に失敗しました（ローカルには保存済み）', '#fffbeb', '#92400e', Icons.html('warning', {size:15}));
    }
  } else {
    // 未公開デッキはローカル保存のみ
    showBanner('保存しました（ローカル）', '#dcfce7', '#166534', Icons.html('save', {size:15}));
  }
}

// ★ 選択式カード（多肢選択デッキ／クイズ過去問デッキ）の編集を保存する（saveCardEditから分岐して呼ばれる）
async function saveQuizChoiceCardEdit(q, errBar) {
  const { choices: rawChoices, correct } = readChoiceEditorState('modal-edit-choice');
  const choices = rawChoices.map(c => c.trim());
  // ★ 単一/複数正解は問題ごとに正解チェックの数で自動的に決まる（1個＝択一、2個以上＝複数回答）。
  //   ここでは「1つも選ばれていない」ことだけをエラーにする。
  if (!q || choices.some(c => !c) || correct.length === 0) {
    errBar.innerHTML = Icons.html('close', {size:14}) + ' 問題文・すべての選択肢・正解を1つ以上選ぶことはすべて必須です';
    errBar.style.display = 'block';
    setTimeout(() => errBar.style.display = 'none', 3000);
    return;
  }
  if (await warnIfBugChars(q, 'modal-edit-q')) return;
  for (let i = 0; i < choices.length; i++) {
    if (await warnIfBugChars(choices[i], `modal-edit-choice-${i}`)) return;
  }

  const deck = decks.find(d => d.id === editingDeckId);
  if (!deck) { closeModal('modal-card-edit'); return; }
  const idx = deck.cards.findIndex(c => cardKey(c) === editingCardKey);
  if (idx === -1) { closeModal('modal-card-edit'); return; }

  const card = deck.cards[idx];
  card.question = q;
  card.choices = choices;
  card.correct_indices = correct.slice().sort((x, y) => x - y);
  delete card.correct_index; // ★ 旧形式（単数）のフィールドが残っていれば片付ける
  // ★ answer も正解の選択肢文言で更新しておく（検索・一覧表示など既存コードのため）
  card.answer = card.correct_indices.map(i => choices[i]).join(' / ');
  card.imgs_q = [...editImgBuf.q];

  saveDecks(decks);
  closeModal('modal-card-edit');

  if (editingContext === 'listview') {
    renderListView();
  } else {
    renderCreatedList();
  }

  if (deck.filename) {
    const ok = await queueSyncDeckToServer(deck);
    if (ok) {
      showBanner('保存しました', '#dcfce7', '#166534', Icons.html('save', {size:15}));
    } else {
      showBanner('サーバーへの反映に失敗しました（ローカルには保存済み）', '#fffbeb', '#92400e', Icons.html('warning', {size:15}));
    }
  } else {
    showBanner('保存しました（ローカル）', '#dcfce7', '#166534', Icons.html('save', {size:15}));
  }
}

// プレイ中の表示だけを更新（めくり状態はそのまま維持）
function refreshStudyCardDisplay(c) {
  // ★ 反転モードなら問題⇔解答を入れ替えて表示する（データ自体は変えない）
  const qText = studyReverse ? c.answer   : c.question;
  const qImgs = studyReverse ? c.imgs_a   : c.imgs_q;
  const aText = studyReverse ? c.question : c.answer;
  const aImgs = studyReverse ? c.imgs_q   : c.imgs_a;

  setMathText(document.getElementById('study-q-text'), qText);
  renderImgList(document.getElementById('study-q-imgs'), qImgs);
  setMathText(document.getElementById('study-a-text'), aText);
  renderImgList(document.getElementById('study-a-imgs'), aImgs);
  const explWrap = document.getElementById('study-expl-wrap');
  if (c.explanation) {
    setMathText(document.getElementById('study-e-text'), c.explanation);
    explWrap.style.display = '';
  } else {
    explWrap.style.display = 'none';
  }
}

// ── デッキ名変更 ──────────────────────
let renamingDeckId = null;
async function openRename(id) {
  renamingDeckId = id;
  const deck = decks.find(d => d.id === id);
  const currentSubject = deck.subject || '';
  const currentName = currentSubject && deck.name.startsWith(currentSubject + ' ')
    ? deck.name.slice(currentSubject.length + 1) : deck.name;
  document.getElementById('modal-rename-input').value = currentName;
  // ★ 追加：まだサーバー未登録（非公開・作成中のローカル下書き）のデッキだけ
  //   「公開予定」トグルを表示する。既にサーバー登録済み（filenameあり）の
  //   デッキは、公開予定を取り消したい場合は既存の「非公開に戻す」メニューを使う。
  const planRow = document.getElementById('modal-rename-plan-publish-row');
  if (!deck.filename) {
    planRow.style.display = '';
    document.getElementById('modal-rename-plan-publish').checked = deck.planPublish !== false;
  } else {
    planRow.style.display = 'none';
  }
  const sel = document.getElementById('modal-rename-subject');
  sel.innerHTML = '<option value="">読み込み中…</option>';
  openModal('modal-rename');
  try {
    // ★ cache: 'no-store' を追加
    const res  = await fetch(`${API_BASE}channels?guild_id=${GUILD_ID}`, { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok || !data.channels.length) throw new Error();
    sel.innerHTML = '<option value="">科目なし</option>' +
      data.channels.map(c =>
        `<option value="${esc(c.name)}"${c.name === currentSubject ? ' selected' : ''}>${esc(c.name)}</option>`
      ).join('');
  } catch(e) {
    // ★ 修正：currentSubject（deck.subject）はデッキ作成者が自由に設定できる文字列。
    //   未エスケープでinnerHTMLへ挿入するとXSSになるため esc() を通す。
    sel.innerHTML = `<option value="${esc(currentSubject)}">${esc(currentSubject) || '（取得失敗）'}</option>`;
  }
  setTimeout(() => document.getElementById('modal-rename-input').focus(), 150);
}
async function saveRename() {
  const subject = document.getElementById('modal-rename-subject').value;
  const input   = document.getElementById('modal-rename-input').value.trim();
  if (!input) return;
  if (await warnIfBugChars(input, 'modal-rename-input')) return;
  const deck = decks.find(d => d.id === renamingDeckId);
  const newName = subject ? `${subject} ${input}` : input;
  // ★ 追加：まだサーバー未登録のデッキのみ、公開予定トグルの変更を反映する
  const wasPlanPublish = deck.planPublish !== false;
  let planPublishChanged = false;
  if (!deck.filename) {
    const nowPlanPublish = document.getElementById('modal-rename-plan-publish').checked;
    if (nowPlanPublish !== wasPlanPublish) planPublishChanged = true;
    deck.planPublish = nowPlanPublish;
  }
  deck.subject = subject;
  deck.name    = newName;
  saveDecks(decks);
  closeModal('modal-rename');
  renderDeckListUI();

  // ★ 追加：公開予定が「なし→あり」に変わった場合、この時点でサーバーへ登録し、
  //   他の人の一覧にも「作成中」として表示されるようにする。
  if (!deck.filename && planPublishChanged && deck.planPublish) {
    await announceNewDeckToServer(deck.id);
    renderDeckListUI();
  }

  // ★ 公開済みならサーバー側のファイルも更新する（通知はしない）
  //   ※ カード本体が未読み込みでも、renameだけならcardsが空でも
  //     サーバー側は既存ファイルの中身を維持したまま名前だけ変えたいところだが、
  //     save_cards は cards を丸ごと上書きする仕様なので、未読み込みのまま
  //     送るとカードが消えてしまう。そのため rename 前に必ず読み込んでおく。
  //   ★ 修正：cardsLoaded=true のキャッシュがあっても古い可能性があるため必ず
  //     最新化する。失敗時も loadDeckCardsWithRecovery が回復手段を提示するので、
  //     rename操作だけがずっとできなくなる、ということはない。
  if (deck.filename) {
    // ★ 追加：この直後の強制リロードでローカルの変更（追加/削除など未同期分）が
    //   消えてしまわないよう、まず直前の同期処理が終わるのを待つ。
    await waitForPendingSync(deck.id);
    const loaded = await loadDeckCardsWithRecovery(deck.id);
    if (!loaded) {
      showBanner('名前の変更はローカルには反映されています（サーバーへの反映は未実施）', '#fffbeb', '#92400e', Icons.html('warning', {size:15}));
      return;
    }
    const ok = await queueSyncDeckToServer(deck);
    if (!ok) showBanner('サーバーへの名前変更の反映に失敗しました', '#fffbeb', '#92400e', Icons.html('warning', {size:15}));
  }
}

// ★ 追加：デッキごとに「直近のサーバー同期処理」を1本の待ち合わせ可能なPromiseとして
//   直列に繋いでおくための仕組み。
//   ─────────────────────────────────────────────
//   カードを次々に追加・削除する場面（例：10問作って「次へ」で連続作成）では、
//   1回1回の syncDeckToServer() 完了を待たずに次の操作へ進めるようにしたい
//   （待つとテンポが悪くなる）一方で、「作成済みリストから別の問題（例：6番）を
//   タップして編集する」ときは reloadCardBeforeEdit() が強制的にサーバーから
//   最新カードを取り直すため、直前の追加分の同期がまだ完了していないと
//   その追加分がサーバーに存在しないまま上書き取得されて消えてしまう。
//   これを防ぐため、同期を開始するときは必ず queueSyncDeckToServer() を通し、
//   強制リロードの直前で waitForPendingSync() を使ってその完了を待ち合わせる。
const deckSyncPromises = new Map(); // deckId -> 直近の同期処理のPromise
function queueSyncDeckToServer(deck) {
  const prev = deckSyncPromises.get(deck.id) || Promise.resolve();
  const next = prev.then(() => syncDeckToServer(deck)).catch(() => false);
  deckSyncPromises.set(deck.id, next);
  return next;
}
async function waitForPendingSync(deckId) {
  const pending = deckSyncPromises.get(deckId);
  if (pending) { try { await pending; } catch(e) {} }
}

// ★ 公開済みデッキの内容をサーバーに反映する共通処理（通知なし）
async function syncDeckToServer(deck) {
  try {
    const cards = deck.cards.map(cardToServerPayload); // ★ choices/correct_indicesも含めて画像も同期する
    const session = getLoginSession();
    const res = await fetch(`${API_BASE}save_cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: deck.name,
        cards,
        filename: deck.filename,
        guild_id: GUILD_ID,
        session_token: session ? session.session_token : undefined,
        subject: deck.subject || null,
        folder_id: deck.folderId || null, // ★ フォルダ所属（みんなで共有）
        publisher_id: session ? session.student_id : null,
        publisher_nickname: deck.published_by || (session ? session.nickname : '匿名'),
        silent: true, // ★ 通知しない
        incomplete: !!deck.incomplete, // ★ 未完成フラグを維持したままサーバーへ反映する
        choice_mode: deck.choiceMode || null, // ★ 多肢選択デッキかどうかを維持したまま反映する
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '不明なエラー');
    deck.count = deck.cards.length;
    saveDecks(decks);
    return true;
  } catch (e) {
    return false;
  }
}

// ── 学習データ（わからないマーク／続きから／完了記録）の端末間共有 ──
//   ★ 以前はブラウザのlocalStorageだけに保存していたため、別の端末を
//     使うと見えなかった。ログイン（student_id）に紐付けてサーバー
//     （GitHub）側にも保存し、他の端末からも同じ状態を見られるようにする。
//   ・考え方は list_order.json / folders.json と同じ：
//     「サーバーが正、ローカルのキャッシュは届くまでの間だけ即座に
//     表示するために使う」。オフライン・通信失敗時もローカルキャッシュで
//     即座に読み書きでき、通信は裏側で試みるだけなので操作は止めない。
const STUDY_DATA_CACHE_KEY = `cardmaker_study_data_cache_v1_${GUILD_ID}`;
migrateGuildScopedLocalKey('cardmaker_study_data_cache_v1', STUDY_DATA_CACHE_KEY);
function loadStudyDataCache() {
  try {
    const d = JSON.parse(localStorage.getItem(STUDY_DATA_CACHE_KEY));
    if (d && typeof d === 'object') {
      return { unsure: d.unsure || {}, progress: d.progress || {}, completed: d.completed || {}, seen: d.seen || {} };
    }
  } catch (e) {}
  return { unsure: {}, progress: {}, completed: {}, seen: {} };
}
function saveStudyDataCache() {
  try { localStorage.setItem(STUDY_DATA_CACHE_KEY, JSON.stringify(studyDataCache)); } catch (e) {}
}
let studyDataCache = loadStudyDataCache();

// ★ 修正（バグ修正）：わからないマーク／続きから進捗／完了記録を「端末間で
//   正しく同期するためのキー」に変換する。
//   ─────────────────────────────────────────────
//   deck.id は fetchAndMergeDecks() が「この端末で初めてそのデッキを見たとき」
//   に genId() でその場限り採番するローカル専用のIDで、同じ公開済みデッキでも
//   端末（あるいは同じ端末でも別のブラウザ／別に「ホーム画面に追加」したPWA）
//   ごとに毎回バラバラの値になる。これをそのままサーバー同期のキーに使って
//   いたため、ある端末で付けた「わからない」マークが、そのデッキを別のIDで
//   認識している他の端末には決して同じキーとして現れず、「別端末で変更しても
//   反映されない」という不具合になっていた。
//   サーバー側で全端末共通なのは deck.filename（公開時にサーバーが発行し、
//   以降ずっと変わらない）なので、公開済みデッキは必ずこちらをキーに使う。
//   まだ公開していない（この端末だけのローカル下書き）デッキは他の端末には
//   そもそも存在しないので、これまで通りローカルIDで構わない
//   （'local:' を付けて deck.filename と衝突しないようにするだけ）。
function studyDataDeckKey(deck) {
  if (!deck) return null;
  return deck.filename || ('local:' + deck.id);
}

// デッキ/フォルダを進捗・完了記録のキーに変換する（サーバー側と共通の形式）。
// フォルダのidは元々サーバー発行の共通IDなのでそのまま使える。
function studyItemKey(isFolder, id) {
  if (isFolder) return 'folder:' + id;
  const deck = decks.find(d => d.id === id);
  return 'deck:' + (studyDataDeckKey(deck) ?? id); // 万一見つからない場合は従来通りIDをそのまま使う
}

// ★ サーバーから自分の学習データを取得し、キャッシュへ反映する
async function fetchAndMergeStudyData() {
  const session = getLoginSession();
  if (!session || !session.session_token) return false;
  // ★ 修正（不具合修正）：直前に押した「わからない」等がまだサーバーへ届いて
  //   いない状態でここに来ると、その変更を含まない古い内容で丸ごと上書き
  //   してしまう（pushStudyDataToServer側のコメント参照）。送信中のものが
  //   あれば、それらが片づく（成功・失敗を問わず一段落する）まで待ってから取得する。
  //   ★ 追加：ここでの待ち合わせは「取得を始める前」時点のものだけが対象。
  //   取得（fetch）が実際に通信している最中に新しい変更が始まった場合、
  //   その変更をサーバーが反映する前のレスポンスを受け取ってしまう可能性が
  //   まだ残るため、下（応答を受け取った直後）でもう一度確認する。
  if (_pendingStudyDataPushes.length) {
    await Promise.allSettled(_pendingStudyDataPushes);
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    // ★ session_tokenはURLクエリに載せない（ブラウザ履歴・アクセスログ・Refererに
    //   残るリスクがあるため）。Authorizationヘッダで送る。
    const qs = new URLSearchParams({ guild_id: GUILD_ID });
    const res = await fetch(`${API_BASE}get_study_data?${qs.toString()}`, {
      signal: controller.signal, cache: 'no-store',
      headers: { 'Authorization': 'Bearer ' + session.session_token },
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!data.ok) return false;
    // ★ 追加：通信中に新しい変更が始まっていたら、この応答は「その変更を
    //   含まない古いスナップショット」かもしれないので、上書きせずに諦める
    //   （＝ローカルの変更を守る。次回のポーリングで改めて取得し直せば十分）。
    if (_pendingStudyDataPushes.length) return false;
    studyDataCache = {
      unsure:    data.data.unsure    || {},
      progress:  data.data.progress  || {},
      completed: data.data.completed || {},
      seen:      data.data.seen      || {},
    };
    saveStudyDataCache();
    return true;
  } catch (e) {
    return false; // 通信失敗時はローカルキャッシュのまま使い続ける
  }
}

// ★ 修正（不具合修正）：わからないマーク等を送信中（まだサーバーに届いたか
//   確定していない間）に、他端末の変更を拾うための定期同期（checkStudyDataUpdate、
//   15秒間隔）が割り込むと、サーバー側がまだ更新される前の古い内容で
//   studyDataCache を丸ごと上書きしてしまい、送ったはずの「わからない」が
//   消えて見える不具合があった。送信中のPromiseを覚えておき、
//   fetchAndMergeStudyData側でそれらの完了を待ってから取得することで、
//   この競合を防ぐ。
let _pendingStudyDataPushes = [];

// 学習データをサーバーへ送る共通処理（失敗しても操作自体は止めない）
async function pushStudyDataToServer(path, body) {
  const session = getLoginSession();
  if (!session || !session.session_token) return false;
  const promise = _pushStudyDataToServerImpl(path, body);
  _pendingStudyDataPushes.push(promise);
  try {
    return await promise;
  } finally {
    _pendingStudyDataPushes = _pendingStudyDataPushes.filter(p => p !== promise);
  }
}
async function _pushStudyDataToServerImpl(path, body) {
  const session = getLoginSession();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guild_id: GUILD_ID, session_token: session.session_token, ...body }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    return !!data.ok;
  } catch (e) {
    return false;
  }
}

// ── わからないマーク ──────────────────
//   ★ 修正：deckId（ローカル専用ID）ではなく studyDataDeckKey()（端末間で
//     共通の filename ベースのキー）で studyDataCache.unsure を引く・書き込む。
//     呼び出し側は deckId を渡すだけでよい（互換性のため引数は変えていない）。
function getUnsureSet(deckId) {
  const deck = decks.find(d => d.id === deckId);
  const key = studyDataDeckKey(deck) ?? deckId;
  const arr = studyDataCache.unsure[key];
  return new Set(Array.isArray(arr) ? arr : []);
}
function saveUnsureSet(deckId, set) {
  const deck = decks.find(d => d.id === deckId);
  const key = studyDataDeckKey(deck) ?? deckId;
  const arr = [...set];
  if (arr.length) studyDataCache.unsure[key] = arr;
  else delete studyDataCache.unsure[key];
  saveStudyDataCache();
  pushStudyDataToServer('save_unsure', { deck_id: key, unsure: arr });
}

// ── みんなの「わかる率」用：実際に学習した（表示した）カードの記録 ──
//   ★「わからない」と違い、一度記録したカードキーは外れない（学習済みという事実は
//     消えないため）。公開デッキ（filenameあり）だけが対象（非公開デッキは
//     「他の人」がいないので集計の意味がない）。
function markCardSeen(deckId, card) {
  const deck = decks.find(d => d.id === deckId);
  if (!deck || !deck.filename) return;
  const key = deck.filename;
  const already = studyDataCache.seen[key] || [];
  const cKey = cardKey(card);
  if (already.includes(cKey)) return; // 既に記録済みなら通信しない
  const arr = [...already, cKey];
  studyDataCache.seen[key] = arr;
  saveStudyDataCache();
  pushStudyDataToServer('save_seen', { deck_id: key, seen: arr });
}

// ★ 追加：学習画面右上に「みんなのわかる率」を出す（自分だけでなく、その公開デッキを
//   学習した全員分の「学習済みカードのうち、今わからないマークが付いていない割合」）。
//   フォルダをまとめてプレイしている場合は、対象フォルダ内の公開デッキ全部をまとめて集計する。
//   非公開デッキだけの場合は「他の人」がいないので出さない。
async function loadUnderstandingBadge() {
  const badge = document.getElementById('study-understand-badge');
  if (!badge) return;
  badge.style.display = 'none';
  const session = getLoginSession();
  if (!session || !session.session_token) return;
  const targetDecks = studyIsFolder
    ? folderPlayDecks.filter(d => d.filename)
    : decks.filter(d => d.id === studyDeckId && d.filename);
  const filenames = [...new Set(targetDecks.map(d => d.filename))];
  if (!filenames.length) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    // ★ session_tokenはURLクエリに載せない（get_study_dataと同じ理由）。Authorizationヘッダで送る。
    const qs = new URLSearchParams({ guild_id: GUILD_ID, filenames: filenames.join(',') });
    const res = await fetch(`${API_BASE}deck_understanding?${qs.toString()}`, {
      signal: controller.signal, cache: 'no-store',
      headers: { 'Authorization': 'Bearer ' + session.session_token },
    });
    clearTimeout(timer);
    const data = await res.json();
    // ★ まだ誰も（自分も含め）1枚も学習していなければ、0%という誤解を招く表示はしない
    if (!data.ok || !data.studied) return;
    const pct = Math.round((data.understood / data.studied) * 100);
    badge.innerHTML = `${Icons.cmHtml('globe', {size:13})} わかる率 ${pct}%`;
    badge.title = `学習済みカードのうち「わからない」が付いていない割合（みんなの合計 ${data.understood}/${data.studied}）`;
    badge.style.display = '';
  } catch (e) {} // 通信失敗時は出さないだけ（学習自体は止めない）
}

// ★ 学習の続きから再開するための進捗保存・読込・削除
//   ・デッキ / フォルダそれぞれ独立したキーで保存する
//   ・保存するのは「そのときのカードの並び順（キー配列）」「今何問目か」
//     「'all'/'unsure' のどちらのモードだったか」「反転モードだったか」
//     「シャッフル済みだったか」
//   ・カードの内容自体は保存しない（常に最新の decks から引き直すため、
//     編集や画像追加をしても続きから再開したときにズレない）
function saveStudyProgress() {
  const id = studyIsFolder ? studyFolderId : studyDeckId;
  if (!id || !studyCards.length) return;
  const data = {
    order: studyCards.map(c => cardKey(c)),
    idx: studyIdx,
    mode: studyMode,
    reverse: studyReverse,
    autoGrade: studyAutoGrade, // ★ 追加：自動採点モードだったかどうかを保存し、再開時に復元する
    fourChoice: studyFourChoice, // ★ 追加：「4択にする」設定だったかどうかを保存し、再開時に復元する
    shuffled: studyShuffled, // ★ 追加：シャッフル済みの並びかどうかを保存し、再開時に区別できるようにする
    updatedAt: Date.now(),
  };
  const key = studyItemKey(studyIsFolder, id);
  studyDataCache.progress[key] = data;
  saveStudyDataCache();
  pushStudyDataToServer('save_study_progress', { key, data });
}
function loadStudyProgress(isFolder, id) {
  const data = studyDataCache.progress[studyItemKey(isFolder, id)];
  if (!data || !Array.isArray(data.order) || !data.order.length) return null;
  if (typeof data.idx !== 'number' || data.idx >= data.order.length) return null;
  return data;
}
function clearStudyProgress(isFolder, id) {
  const key = studyItemKey(isFolder, id);
  if (key in studyDataCache.progress) {
    delete studyDataCache.progress[key];
    saveStudyDataCache();
    pushStudyDataToServer('save_study_progress', { key, data: null });
  }
}

// ★ 学習を最後まで終えた（完了した）記録の保存・読込
//   ・「プレイ中（続きから）」とは別のキーで、完了した日時と問題数だけを保存する
function saveCompletionRecord(isFolder, id, total) {
  if (!id || !total) return;
  const data = { total, completedAt: Date.now() };
  const key = studyItemKey(isFolder, id);
  studyDataCache.completed[key] = data;
  saveStudyDataCache();
  pushStudyDataToServer('save_completion', { key, data });
}
function loadCompletionRecord(isFolder, id) {
  const data = studyDataCache.completed[studyItemKey(isFolder, id)];
  if (!data || typeof data.completedAt !== 'number' || !data.total) return null;
  return data;
}

let studyDeckId = null;
let studyShuffled = false;   // ★ 追加：現在シャッフル済みの並びで学習中かどうか（続きから再開時の表示・保存用）
let studyIsFolder = false;   // ★ 追加：フォルダ単位のプレイ中かどうか
let studyFolderId = null;    // ★ 追加：プレイ中のフォルダid
let studyBaseTitle = '';     // ★ 追加：学習画面タイトルの元テキスト（デッキ名/フォルダ名、アイコン・逆順/シャッフル表示は含まない）

// ★ 追加：study-titleを安全に描画する共通処理。studyBaseTitle（デッキ名/
//   フォルダ名＝ユーザー入力）は必ずescで、アイコンはこのファイル内の
//   固定HTMLとして組み立てる（絵文字を末尾に付け足すregex文字列操作を
//   やめ、常にここから再描画する方式にした）。
function renderStudyTitle() {
  const prefixIcon = studyIsFolder ? Icons.cmHtml('folder', {size:16}) + ' ' : '';
  const suffixIcons =
    (studyReverse  ? ' ' + Icons.html('refresh', {size:14})  : '') +
    (studyShuffled ? ' ' + Icons.html('shuffle', {size:14}) : '');
  document.getElementById('study-title').innerHTML = prefixIcon + esc(studyBaseTitle) + suffixIcons;
}
let folderPlayDecks = [];    // ★ 追加：フォルダプレイの対象デッキ一覧
let loadingFolderIds = new Set(); // ★ 追加：カード読み込み中のフォルダid

// ★ フォルダ配下の全デッキ（サブフォルダ含む）を1つの学習セッションとしてプレイする
async function openFolderPlayMode(folderId) {
  const folder = folders.find(f => f.id === folderId);
  const targetDecks = collectDecksInFolder(folderId)
    .filter(d => (d.filename ? (d.count ?? d.cards.length) : d.cards.length) > 0);
  if (!targetDecks.length) return;

  loadingFolderIds.add(folderId);
  renderDeckListUI();

  // ★ プレイ開始時は毎回サーバーの最新カードを取りに行く（force=true）。
  //   キャッシュ済みでも取り直すことで、他の人が直した修正がすぐプレイ画面に反映される。
  // ★ 修正：直前の編集でのサーバー同期がまだ終わっていない状態で強制リロードすると、
  //   同期前の古い内容（最悪カード0枚）で上書きされてしまうため、各デッキの保留中の
  //   同期を先に待ってから読み込み直す。
  await Promise.all(targetDecks.map(d => waitForPendingSync(d.id)));
  // ★ 修正：1回失敗しただけで行き止まりのアラートを出して終わらせず、
  //   失敗したデッキだけを対象に「もう一度試す」を選べるようにする
  //   （タイムアウトを含む一時的な通信エラーでフォルダのプレイを諦めなくて済むように）。
  let pending = targetDecks;
  while (pending.length) {
    const results = await Promise.all(pending.map(d => ensureDeckCardsLoaded(d.id, true)));
    pending = pending.filter((d, i) => !results[i].ok);
    if (!pending.length) break;
    const retry = await showCmConfirm({
      title: '読み込みに失敗しました',
      desc: `${pending.length}件のデッキが読み込めませんでした。通信環境を確認してもう一度お試しください。`,
      okLabel: 'もう一度試す', cancelLabel: 'やめる',
    });
    if (!retry) { loadingFolderIds.delete(folderId); renderDeckListUI(); return; }
  }

  loadingFolderIds.delete(folderId);
  renderDeckListUI();

  folderPlayDecks = targetDecks;
  studyIsFolder = true;
  studyFolderId = folderId;
  studyDeckId = null;

  document.getElementById('reverse-mode-checkbox').checked = false;
  document.getElementById('auto-grade-checkbox').checked = false; // ★ 追加：モーダルを開くたびに未チェックへリセット
  document.getElementById('four-choice-checkbox').checked = false; // ★ 追加：「4択にする」も未チェックへリセット
  onReverseModeToggleChange(); // ★ 追加：反転OFFなので自動採点トグルを表示状態にする
  onAutoGradeToggleChange(); // ★ 追加：自動採点OFFなので「4択にする」サブトグルを隠す
  setIconText(document.getElementById('play-mode-deck-name'), folder ? Icons.cmHtml('folder', {size:15}) : '', folder ? folder.name : 'フォルダ');

  const allCount = folderPlayDecks.reduce((s, d) => s + d.cards.length, 0);
  document.getElementById('play-mode-all-sub').textContent = `${allCount} 問`;

  const unsureCount = folderPlayDecks.reduce((s, d) => {
    const unsure = getUnsureSet(d.id);
    return s + d.cards.filter(c => unsure.has(cardKey(c))).length;
  }, 0);
  const unsureItem = document.getElementById('play-mode-unsure-item');
  if (unsureCount > 0) {
    document.getElementById('play-mode-unsure-sub').textContent = `${unsureCount} 問`;
    unsureItem.style.display = '';
  } else {
    unsureItem.style.display = 'none';
  }

  // ★ 続きから再開できる場合は「続きから」の項目を表示する
  const savedF = loadStudyProgress(true, folderId);
  const resumeItemF = document.getElementById('play-mode-resume-item');
  if (savedF) {
    document.getElementById('play-mode-resume-sub').textContent = `${savedF.idx + 1} / ${savedF.order.length} 問から`;
    resumeItemF.style.display = '';
  } else {
    resumeItemF.style.display = 'none';
  }

  // ★「みんなでクイズを始める」は単一デッキが前提の機能なので、フォルダのプレイでは出さない
  //   （複数デッキ・フォルダごとまとめてクイズにしたい場合はQuiz.html側の「デッキを選ぶ」を使う）。
  document.getElementById('play-mode-quiz-item').style.display = 'none';

  openModal('modal-play-mode');
}
// ★ プレイ開始のたびに、必ずサーバーから最新のカードを取り直す（force=true）。
//   ─────────────────────────────────────────────
//   以前は cardsLoaded=true（一度読み込み済み）のデッキはキャッシュのまま
//   プレイ画面を開いていたため、他の人が先に修正していても気づけず、
//   「同じ間違いをまた編集してしまう」「もう直っていたのに気づかない」
//   といったすれ違いが起きやすかった。プレイのたびに読み込み直すことで、
//   誰かが編集した直後でも次にプレイした人にはほぼ即座に反映される。
// ============================================================
//  ★ 一人用選択式クイズは Cardmaker-quizplay.js に分離した
//  ─────────────────────────────────────────────
//  実体は別ファイルに移し、loadChunksInBackground() が背景で読み込む。
//  ここに残す startSoloQuiz は、openPlayMode()（下記、core側）や
//  結果画面の「もう一度挑戦する」ボタン（Cardmaker.html）から呼ばれる
//  入口。チャンク読み込み完了後は同名の本物の実装に上書きされる。
async function startSoloQuiz(deckId) {
  await loadChunkWithFeedback('quizplay', '/Cardmaker-quizplay.js');
  return startSoloQuiz(deckId); // ★ この時点では本物の実装に差し替わっている
}

async function openPlayMode(deckId) {
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return;
  // ★「クイズ過去問」フォルダの中のデッキ、および多肢選択デッキ（choiceMode有り）は、
  //   通常のフラッシュカード（すべて/わからないだけ/続きから の選択モーダル）
  //   ではなく、一人用選択式モードでプレイする。
  //   ★ ただし公開済み（filenameあり）なら「みんなでクイズ」も選べるよう、
  //     一人用選択式モーダルを出す前に軽く選ばせる（play-mode-itemと同じ見た目）。
  if (isDeckInFolderScope(deckId, QUIZ_ARCHIVE_FOLDER_ID) || deck.choiceMode) {
    if (!deck.filename) return startSoloQuiz(deckId);
    const choice = await showCmChoiceDialog({
      title: deck.name,
      choices: [
        { icon: Icons.cmHtml('choice', {size:20}), label: '一人でプレイ', sub: '選択式クイズに一人で挑戦する', value: 'solo' },
        { icon: Icons.cmHtml('quiz', {size:20}), label: 'みんなでクイズを始める', sub: '友達とオンラインで早押し4択', value: 'multi' },
      ],
    });
    if (choice === 'multi') return startQuizFromDeck(deckId);
    if (choice === 'solo') return startSoloQuiz(deckId);
    return; // キャンセル
  }
  studyIsFolder = false;
  studyDeckId = deckId;

  // ★ 修正：直前にカードを追加/削除した際のサーバー同期（queueSyncDeckToServer）が
  //   まだ完了していない状態で強制リロードすると、その同期前の古い（最悪カード0枚の）
  //   内容をサーバーから取得して上書きしてしまい、「中身があるのに0問で完了」に
  //   なってしまう不具合があった。force reloadの前に必ず保留中の同期を待つ。
  await waitForPendingSync(deckId);
  // ★ 修正：1回失敗しただけで行き止まりのアラートを出して終わらせず、
  //   loadDeckCardsWithRecovery と同様に「もう一度試す」を選べるようにする
  //   （タイムアウトを含む一時的な通信エラーでプレイを諦めなくて済むように）。
  let result = await ensureDeckCardsLoaded(deckId, true);
  while (!result.ok) {
    const retry = await showCmConfirm({
      title: '読み込みに失敗しました',
      desc: '通信環境を確認してもう一度お試しください。',
      okLabel: 'もう一度試す', cancelLabel: 'やめる',
    });
    if (!retry) return;
    result = await ensureDeckCardsLoaded(deckId, true);
  }

  document.getElementById('reverse-mode-checkbox').checked = false; // ★ プレイモード選択のたびに未チェックへリセット
  document.getElementById('auto-grade-checkbox').checked = false; // ★ 追加：自動採点トグルも未チェックへリセット
  document.getElementById('four-choice-checkbox').checked = false; // ★ 追加：「4択にする」も未チェックへリセット
  onReverseModeToggleChange(); // ★ 追加：反転OFFなので自動採点トグルを表示状態にする
  onAutoGradeToggleChange(); // ★ 追加：自動採点OFFなので「4択にする」サブトグルを隠す
  document.getElementById('play-mode-deck-name').textContent = deck.name;
  document.getElementById('play-mode-all-sub').textContent = `${deck.cards.length} 問`;
  const unsure = getUnsureSet(deckId);
  const unsureCount = deck.cards.filter(c => unsure.has(cardKey(c))).length;
  const unsureItem = document.getElementById('play-mode-unsure-item');
  if (unsureCount > 0) {
    document.getElementById('play-mode-unsure-sub').textContent = `${unsureCount} 問`;
    unsureItem.style.display = '';
  } else {
    unsureItem.style.display = 'none';
  }

  // ★ 続きから再開できる場合は「続きから」の項目を表示する
  const savedD = loadStudyProgress(false, deckId);
  const resumeItemD = document.getElementById('play-mode-resume-item');
  if (savedD) {
    document.getElementById('play-mode-resume-sub').textContent = `${savedD.idx + 1} / ${savedD.order.length} 問から`;
    resumeItemD.style.display = '';
  } else {
    resumeItemD.style.display = 'none';
  }

  // ★「みんなでクイズを始める」：公開済み（filenameあり）のデッキだけ表示する
  //   （Quiz.jsはサーバーのget_card_setでデッキを取得するため、非公開のローカル限定
  //   デッキは対象外）。
  document.getElementById('play-mode-quiz-item').style.display = deck.filename ? '' : 'none';

  // ★ 反転トグルを必ず見せるため、わからないカードの有無に関わらずモーダルを開く
  openModal('modal-play-mode');
}

// ★ 追加：反転モードのON/OFFに応じて自動採点トグルの表示を切り替える。
//   反転モード（問題と解答を逆にする）中は自動採点の対象がずれてしまうため、
//   反転ONの間はトグル自体を隠し、内部的にもOFFへ強制的に戻しておく。
function onReverseModeToggleChange() {
  const reversed = document.getElementById('reverse-mode-checkbox').checked;
  const row = document.getElementById('auto-grade-toggle-row');
  row.style.display = reversed ? 'none' : '';
  if (reversed) {
    document.getElementById('auto-grade-checkbox').checked = false;
    onAutoGradeToggleChange(); // ★ 追加：自動採点を強制OFFにしたら「4択にする」サブトグルも連動して隠す
  }
}

// ★ 追加：自動採点ONの時だけ「4択にする」サブトグルを表示する（自動採点OFFなら意味が無いため）。
function onAutoGradeToggleChange() {
  const on = document.getElementById('auto-grade-checkbox').checked;
  const row = document.getElementById('four-choice-toggle-row');
  row.style.display = on ? '' : 'none';
  if (!on) document.getElementById('four-choice-checkbox').checked = false;
}

async function startStudyMode(mode) {
  studyReverse = document.getElementById('reverse-mode-checkbox').checked;
  // ★ 追加：自動採点は反転モードでない場合のみ有効にする（反転中はトグル自体を隠しているが念のため二重に保険）
  studyAutoGrade = !studyReverse && document.getElementById('auto-grade-checkbox').checked;
  studyFourChoice = studyAutoGrade && document.getElementById('four-choice-checkbox').checked;
  const progressId = studyIsFolder ? studyFolderId : studyDeckId;

  // ★ 追加：「すべてのカード」「わからないカードだけ」を選んだ場合、
  //   既に「続きから」の再開データが残っていると、この後の処理で
  //   問答無用でそのデータが破棄されてしまう（clearStudyProgress）。
  //   気づかないうちに再開位置が消えてしまわないよう、事前に確認する。
  if (mode !== 'resume') {
    const existing = loadStudyProgress(studyIsFolder, progressId);
    if (existing) {
      const proceed = await showCmConfirm({
        title: '「続きから」のデータが消えます',
        desc: '保存されている再開位置は破棄され、最初からのプレイになります。\nこのまま始めますか？',
        okLabel: 'このまま始める', cancelLabel: 'キャンセル', okStyle: 'danger',
      });
      if (!proceed) return;
    }
  }

  closeModal('modal-play-mode');

  if (mode === 'resume') {
    // ★ 保存された進捗（カードキーの並び順・位置・モード・反転設定・シャッフル済みか）を復元する。
    //   カード本体は常に最新の decks / folderPlayDecks から引き直すので、
    //   編集や画像追加が続きから再開に影響しない。
    const saved = loadStudyProgress(studyIsFolder, progressId);
    if (!saved) return; // 万が一データが消えていた場合は何もしない
    studyReverse = saved.reverse;
    studyAutoGrade = !saved.reverse && !!saved.autoGrade; // ★ 追加：保存されていた自動採点設定を復元
    studyFourChoice = studyAutoGrade && !!saved.fourChoice; // ★ 追加：保存されていた「4択にする」設定を復元
    studyMode = saved.mode || 'all';
    studyShuffled = !!saved.shuffled; // ★ シャッフル済みだったかどうかを復元（タイトル表示用）

    let pool;
    if (studyIsFolder) {
      pool = [];
      folderPlayDecks.forEach(d => d.cards.forEach(c => pool.push({ ...c, __deckId: d.id })));
      const folder = folders.find(f => f.id === studyFolderId);
      studyBaseTitle = folder ? folder.name : 'フォルダ';
    } else {
      const deck = decks.find(d => d.id === studyDeckId);
      pool = deck ? [...deck.cards] : [];
      studyBaseTitle = deck ? deck.name : '';
    }
    const byKey = new Map(pool.map(c => [cardKey(c), c]));
    // ★ order は保存時点の並び順（シャッフル済みならその並び）をそのまま記録しているので、
    //   ここで単純にキーから引き直すだけで、シャッフルした状態のまま正しく再開できる。
    studyCards = saved.order.map(k => byKey.get(k)).filter(Boolean);
    if (!studyCards.length) return; // カードが全部消えていた場合は何もしない
    studyIdx = Math.min(saved.idx, studyCards.length - 1);
  } else {
    studyMode = mode;
    studyShuffled = false; // ★ 「すべて」「わからないだけ」を選び直した場合はシャッフル状態をリセット
    if (studyIsFolder) {
      // フォルダ内の全デッキのカードを、どのデッキ由来かのタグ付きでまとめる
      const merged = [];
      folderPlayDecks.forEach(d => {
        const unsure = mode === 'unsure' ? getUnsureSet(d.id) : null;
        d.cards.forEach(c => {
          if (mode === 'unsure' && !unsure.has(cardKey(c))) return;
          merged.push({ ...c, __deckId: d.id }); // ★ 元のデッキidを保持
        });
      });
      studyCards = merged;
      const folder = folders.find(f => f.id === studyFolderId);
      studyBaseTitle = folder ? folder.name : 'フォルダ';
    } else {
      const deck = decks.find(d => d.id === studyDeckId);
      if (mode === 'unsure') {
        const unsure = getUnsureSet(studyDeckId);
        studyCards = deck.cards.filter(c => unsure.has(cardKey(c)));
      } else {
        studyCards = [...deck.cards];
      }
      studyBaseTitle = deck.name;
    }
    studyIdx = 0;
    // ★ 「すべて」「わからないだけ」を新しく選び直した場合は、
    //   古い「続きから」データを破棄する（そのまま残すと内容と矛盾するため）
    clearStudyProgress(studyIsFolder, progressId);
  }

  // ★ 修正：サーバーの事前生成キャッシュ確認（高速なファイル読み込みのみ、数百ms程度）を
  //   待ってから描画する。学習開始が遅れるのはこの一瞬だけで、間に合えば最初のカードから
  //   AI強化済みの選択肢が出せる（キャッシュが無い/失敗してもここで待ちすぎない設計）。
  await setupFourChoiceIfNeeded();

  renderStudyTitle();
  document.getElementById('study-done-sub').textContent = `全 ${studyCards.length} 問完了！`;
  showScreen('study');
  document.getElementById('study-done').style.display    = 'none';
  document.getElementById('study-content').style.display = 'flex';
  renderStudyCard();
  loadUnderstandingBadge(); // ★ 追加：みんなの「わかる率」を右上に読み込む（非同期・表示はブロックしない）
}

// ============================================================
//  自動採点＋「4択にする」モード
//  ─────────────────────────────────────────
//  みんなでクイズ（bot.py側 _pick_distractors）と同じ考え方で、まず即座に
//  使える「綴りの類似度＋文字数の近さ」ベースの4択を組み立てて学習を始め、
//  その裏でローカルAI（Ollama）に数問ずつ問い合わせて、応答が返ってきた
//  カードから順に、より意味的に紛らわしい選択肢へ差し替えていく。
//  AIが使えない（未設定・失敗）場合も、最初に組み立てた4択のまま問題なく遊べる。
// ============================================================

// ★ 2文字（bigram）の一致度で文字列の類似度を測る（Python側のdifflib.SequenceMatcher
//   ほど厳密ではないが、「なんとなく綴りが近いものを優先する」という目的には十分）。
function _bigramSimilarity(a, b) {
  function bigrams(s) {
    const arr = [];
    for (let i = 0; i < s.length - 1; i++) arr.push(s.slice(i, i + 2));
    return arr;
  }
  const ba = bigrams(a), bb = bigrams(b);
  if (!ba.length || !bb.length) return a === b ? 1 : 0;
  const rest = [...bb];
  let common = 0;
  ba.forEach(bg => {
    const idx = rest.indexOf(bg);
    if (idx !== -1) { common++; rest.splice(idx, 1); }
  });
  return (2 * common) / (ba.length + bb.length);
}
function _distractorScore(correct, a) {
  const seqRatio = _bigramSimilarity(correct, a);
  const longer = Math.max(correct.length, a.length, 1);
  const lengthRatio = 1 - Math.abs(correct.length - a.length) / longer;
  return seqRatio * 0.7 + lengthRatio * 0.3;
}
function shuffleArrayInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
// ★ 追加（2026/08/26）：4択にできる条件（答えの異なりの数）を厳しくしたことで、
//   対象デッキの候補プール自体が元々大きくなった。AIに渡す候補数もそれに合わせて
//   広げる（FOUR_CHOICE_POOL_MIN_SIZEと合わせて調整すること）。
//   ★ 修正（同日）：綴り類似度による事前絞り込み（bigram＋文字数）だけでは、
//   記述式（文章）の解答で「本当は紛らわしいのに順位が低くて漏れる」候補が
//   出やすいとの指摘を受け、16→40に拡大（AIが「デッキの中から広く探す」余地を増やす）。
const FOUR_CHOICE_AI_SHORTLIST_SIZE = 40;
// pool: correct以外の、このカードの元デッキの解答（重複除去済み）一覧
function buildChoiceEntry(correct, pool) {
  // ★ 修正（効率化）：sortの比較関数の中で_distractorScoreを毎回計算し直すと
  //   （比較のたびに2回、O(n log n)回呼ばれる）候補が多いデッキほど無駄が
  //   大きくなる。先に各候補のスコアを1回だけ計算してから並べ替える
  //   （decorate-sort-undecorate）。学習開始前に同期的に呼ばれる関数なので、
  //   ここが遅いとそのまま学習開始の体感速度に影響する。
  const scored = pool
    .map(a => ({ a, score: _distractorScore(correct, a) }))
    .sort((x, y) => y.score - x.score)
    .map(s => s.a);
  const shortlist = scored.slice(0, FOUR_CHOICE_AI_SHORTLIST_SIZE); // ★ AIへ渡す候補用に保持しておく（表示用の3件より広めに残す）
  const topPoolSize = Math.max(3, Math.min(scored.length, 6));
  const distractors = shuffleArrayInPlace(scored.slice(0, topPoolSize)).slice(0, 3);
  const choices = shuffleArrayInPlace([...distractors, correct]);
  return { choices, correctIndex: choices.indexOf(correct), shortlist };
}

async function setupFourChoiceIfNeeded() {
  studyChoicesMap = new Map();
  _fourChoiceAiRunToken++; // ★ 前回までのAI問い合わせ結果が紛れ込まないよう無効化する
  if (!studyFourChoice || !studyCards.length) return;

  // ★ デッキ単位で1問題プールにする（フォルダをまとめて再生している場合は、
  //   カードごとにその元デッキ内の解答だけをプールにする）。
  const poolByDeck = new Map();
  function poolFor(deckId) {
    if (poolByDeck.has(deckId)) return poolByDeck.get(deckId);
    const deck = decks.find(d => d.id === deckId);
    const seen = new Set();
    const pool = [];
    (deck ? deck.cards : []).forEach(cc => {
      const a = (cc.answer || '').trim();
      if (a && !seen.has(a)) { seen.add(a); pool.push(a); }
    });
    poolByDeck.set(deckId, pool);
    return pool;
  }

  // ★ 修正（2026/08/26）：答えの異なりが「6件以上」でもまだ選別の余地が乏しく
  //   紛らわしくない誤答が混ざりやすかったため、「10件を超える（11件以上）」へ
  //   さらに厳格化した。これにより対象デッキの候補プールが元々広くなり、
  //   AI（scheduleFourChoiceAiEnhancement）に渡す候補（shortlist）も自然と
  //   充実する＝AIがより自信を持って紛らわしい誤答を選べるようになる。
  const FOUR_CHOICE_POOL_MIN_SIZE = 10;
  studyCards.forEach(card => {
    const correct = ((studyReverse ? card.question : card.answer) || '').trim();
    if (!correct) return;
    const deckId = card.__deckId || studyDeckId;
    const pool = poolFor(deckId).filter(a => a !== correct);
    if (pool.length <= FOUR_CHOICE_POOL_MIN_SIZE) return;
    studyChoicesMap.set(cardKey(card), buildChoiceEntry(correct, pool));
  });

  if (!studyChoicesMap.size) return;

  // ★ 追加（2026/08/26）：デッキ「公開」保存時にサーバー側でバックグラウンド
  //   事前生成された選択肢（four_choice_cache_<filename>.json）があれば、
  //   ここで取りに行って差し替える。ファイル読み込みだけなので高速（数百ms
  //   程度）で、間に合えば最初のカードから既にAI強化済みの選択肢を使える。
  //   取得できたカードはローカルのAI強化（scheduleFourChoiceAiEnhancement）の
  //   対象から外し、二重に問い合わせない。
  const serverCoveredKeys = await applyServerChoiceCaches();
  scheduleFourChoiceAiEnhancement(serverCoveredKeys);
}

// ★ 追加：サーバーが返した誤答候補が信頼できる形か検証する（キャッシュ生成後に
//   カードの解答が変わっていた等で、正解と重複する／件数が合わない場合に備える）。
function isValidServerDistractors(distractors, correct) {
  if (!Array.isArray(distractors) || distractors.length !== 3) return false;
  const seen = new Set([correct]);
  for (const d of distractors) {
    const t = String(d || '').trim();
    if (!t || seen.has(t)) return false;
    seen.add(t);
  }
  return true;
}

async function applyServerChoiceCaches() {
  const covered = new Set();
  const session = getLoginSession();
  if (!session || !session.session_token) return covered;

  // ★ 関係するデッキ（filenameを持つ＝公開済みのものだけ）を集める。
  //   下書き（filenameが無い）デッキはそもそもサーバー側に事前生成の対象にならない。
  const deckIds = new Set();
  studyCards.forEach(card => {
    if (studyChoicesMap.has(cardKey(card))) deckIds.add(card.__deckId || studyDeckId);
  });

  // ★ 修正（効率化、2026/08/26）：デッキごとに直列でawaitしていたため、
  //   フォルダ再生でデッキ数が多いと最悪「デッキ数×5秒」待つことになって
  //   いた（1デッキなら数百ms程度、という設計コメントと矛盾する動き方に
  //   なっていた）。全デッキぶんを並行して取得し、待ち時間を「一番遅い
  //   1件ぶん」に収める。
  const results = await Promise.all([...deckIds].map(async deckId => {
    const deck = decks.find(d => d.id === deckId);
    if (!deck || !deck.filename) return null;
    try {
      const res = await fetch(
        `${API_BASE}cardmaker_choice_cache?guild_id=${GUILD_ID}&filename=${encodeURIComponent(deck.filename)}`,
        { headers: { 'Authorization': 'Bearer ' + session.session_token }, signal: AbortSignal.timeout(5000) }
      );
      const data = await res.json();
      return { deckId, data };
    } catch (e) { return null; } // ★ このデッキ分だけ諦める（他のデッキ・ローカル生成には影響しない）
  }));

  for (const result of results) {
    if (!result) continue;
    const { deckId, data } = result;
    if (!data || !data.ok || !data.cards) continue;

    studyCards.forEach(card => {
      if ((card.__deckId || studyDeckId) !== deckId) return;
      const key = cardKey(card);
      const cur = studyChoicesMap.get(key);
      if (!cur) return;
      const correct = cur.choices[cur.correctIndex];
      const entry = data.cards[key];
      if (!entry || !isValidServerDistractors(entry.distractors, correct)) return;
      const choices = shuffleArrayInPlace([...entry.distractors, correct]);
      studyChoicesMap.set(key, { choices, correctIndex: choices.indexOf(correct), shortlist: cur.shortlist });
      covered.add(key);
    });
  }
  return covered;
}

// ★ 4択が組み上がったカードから順に、数問ずつローカルAIへ問い合わせて差し替える。
//   1回のリクエストに詰め込みすぎるとCPU動作のAIでは応答が遅くなるため、
//   「みんなでクイズ」側の教訓と同じく分割して送る（学習側は待たされないので
//   バッチ数はクイズ側より少なめでも実害は無い）。
// ★ 追加：解答文が「記述系」（単語1つではなく、説明文っぽい）かどうかの簡易判定。
//   綴り類似度＋文字数の近さだけの即席4択は、単語同士なら「なんとなく近い」で
//   それなりに機能するが、記述式の解答（文章）だと綴りが近くても意味は無関係、
//   ということが起きやすく、「消去法で一目で分かる誤答」が混ざりやすい。
//   AIによる強化の価値がより大きいこの手のカードを、問い合わせの先頭へ回す。
function isDescriptiveAnswerText(s) {
  if (!s) return false;
  if (s.length >= 20) return true; // ある程度長い解答は記述系とみなす
  if (/[。、．，,.!?！？]/.test(s)) return true; // 句読点を含む＝文章の可能性が高い
  if (/\s/.test(s.trim())) return true; // 単語区切りのスペースを含む＝説明文っぽい
  return false;
}

// skipKeys: applyServerChoiceCaches()が既にサーバーの事前生成結果で差し替え
//   済みのカードキー一覧（Set）。二重にAIへ問い合わせないよう除外する。
async function scheduleFourChoiceAiEnhancement(skipKeys) {
  const myToken = _fourChoiceAiRunToken;
  const session = getLoginSession();
  if (!session || !session.session_token) return;

  const entries = studyCards
    .map((card, idx) => ({ idx, key: cardKey(card) }))
    .filter(e => studyChoicesMap.has(e.key) && !(skipKeys && skipKeys.has(e.key)));
  // ★ 追加：記述系カードを問い合わせの先頭へ並べ替える（Array.sortは安定ソートなので、
  //   記述系同士・単語系同士それぞれの中では元の出題順を維持する）。
  entries.sort((a, b) => {
    const ea = studyChoicesMap.get(a.key), eb = studyChoicesMap.get(b.key);
    const pa = isDescriptiveAnswerText(ea.choices[ea.correctIndex]) ? 0 : 1;
    const pb = isDescriptiveAnswerText(eb.choices[eb.correctIndex]) ? 0 : 1;
    return pa - pb;
  });
  // ★ 修正（2026/08/26）：最初の1件だけバッチサイズ1で送り、一番乗りの改善結果が
  //   できるだけ早く届くようにする（1問だけの生成は3問まとめてより明らかに速い）。
  //   2回目以降は3問ずつに戻す（総リクエスト数と速度のバランス）。
  let start = 0, isFirstBatch = true;
  while (start < entries.length) {
    if (myToken !== _fourChoiceAiRunToken) return; // ★ 学習をやり直す等で無効化されていたら中断
    const batchSize = isFirstBatch ? 1 : 3;
    const batch = entries.slice(start, start + batchSize);
    start += batchSize;
    isFirstBatch = false;
    const items = batch.map(e => {
      const card = studyCards[e.idx];
      const cur = studyChoicesMap.get(e.key);
      const correct = cur.choices[cur.correctIndex];
      const question = ((studyReverse ? card.answer : card.question) || '').trim();
      return { i: e.idx, question, correct, candidates: cur.shortlist };
    });

    let res;
    try {
      res = await fetch(`${API_BASE}cardmaker_ai_distractors`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_id: GUILD_ID, session_token: session.session_token, items }),
        signal: AbortSignal.timeout(25000 * items.length + 30000),
      });
    } catch (e) { return; } // ★ 通信エラー等はここで静かに諦める（既存の4択のまま使える）
    if (myToken !== _fourChoiceAiRunToken) return;

    let data;
    try { data = await res.json(); } catch (e) { return; }
    // ★ 修正：res.json()もawaitを挟む（＝この間に学習がやり直された可能性がある）ため、
    //   ここでもう一度確認する。これが無いと、やり直し後の新しいstudyChoicesMapに
    //   古いセッションのAI応答を書き込んでしまうことがあった。
    if (myToken !== _fourChoiceAiRunToken) return;
    if (!data || !data.ok) return; // ai_unavailable/ai_failed 等。以降のバッチも見込みが薄いので打ち切る

    (data.questions || []).forEach(q => {
      const card = studyCards[q.i];
      if (!card) return;
      const key = cardKey(card);
      const cur = studyChoicesMap.get(key);
      if (!cur || !Array.isArray(q.distractors)) return;
      const correct = cur.choices[cur.correctIndex];
      const choices = shuffleArrayInPlace([...q.distractors, correct]);
      studyChoicesMap.set(key, { choices, correctIndex: choices.indexOf(correct), shortlist: cur.shortlist });
      // ★ 追加：今まさに表示中で、まだ回答していないカードがこのバッチに含まれていた
      //   場合は、次の描画を待たずにその場で選択肢を差し替える（「早めに」AI強化版を
      //   見せる）。既に回答済みのカードは触らない（正誤判定の結果が変わって見えると
      //   混乱するため）。
      if (q.i === studyIdx && !studyChoiceAnswered) {
        renderStudyChoices(studyChoicesMap.get(key));
      }
    });
  }
}

function renderStudyChoices(entry) {
  studyChoiceAnswered = false;
  const el = document.getElementById('study-choices');
  el.innerHTML = entry.choices.map((c, i) => `
    <button type="button" class="qp-choice-btn" onclick="answerStudyChoice(${i})">
      <b>${CHOICE_LETTERS[i]}.</b> <span id="study-choice-text-${i}"></span>
    </button>`).join('');
  entry.choices.forEach((c, i) => setMathText(document.getElementById(`study-choice-text-${i}`), c));
}

// ★ 通常の自動採点（gradeCurrentAnswer）と4択（この関数）の両方から呼ぶ、
//   「間違えたら自動でわからないマークを付ける」共通処理。
function autoMarkUnsureForCard(card, isCorrect) {
  if (isCorrect) return;
  const key = cardKey(card);
  const deckId = card.__deckId || studyDeckId;
  const unsure = getUnsureSet(deckId);
  if (!unsure.has(key)) {
    unsure.add(key);
    saveUnsureSet(deckId, unsure);
  }
}

function answerStudyChoice(idx) {
  if (studyChoiceAnswered) return;
  studyChoiceAnswered = true;
  const card = studyCards[studyIdx];
  const entry = card && studyChoicesMap.get(cardKey(card));
  if (!entry) return;
  const isCorrect = idx === entry.correctIndex;

  document.getElementById('study-answer-panel').classList.add('show');
  document.getElementById('study-reveal-bar').style.display = 'none';
  document.getElementById('study-nav').style.display = '';

  const result = document.getElementById('study-grade-result');
  const mark = document.getElementById('grade-mark');
  const userAnswerEl = document.getElementById('grade-user-answer');
  result.style.display = 'flex';
  result.className = 'study-grade-result ' + (isCorrect ? 'correct' : 'incorrect');
  mark.innerHTML = isCorrect ? '○ 正解' : (Icons.html('close', {size:14}) + ' 不正解');
  userAnswerEl.textContent = 'あなたの解答：' + entry.choices[idx];

  [...document.querySelectorAll('#study-choices .qp-choice-btn')].forEach((btn, i) => {
    btn.disabled = true;
    if (i === entry.correctIndex) btn.classList.add('qp-correct');
    else if (i === idx) btn.classList.add('qp-wrong');
    else btn.classList.add('qp-dim');
  });

  autoMarkUnsureForCard(card, isCorrect);
  updateUnsureBtn();
}

// ══════════ 「一覧で見る」機能は Cardmaker-listview.js に分離した ══════════
//   実体は別ファイルに移し、loadChunksInBackground() が背景で読み込む。
//   ここに残す openListView は、Cardmaker.html（プレイモード選択の
//   「一覧で見る」項目）から呼ばれる入口。チャンク読み込み完了後は
//   同名の本物の実装に上書きされる。
//   （setListViewFilter/toggleListViewReverse/editListViewCard などは、
//   一覧で見る画面が実際に開いた後にしか押せないボタンからしか呼ばれない
//   ため、openListView が読み込みを待つことで間接的に保護されている。
//   ただし検索結果からの直接ジャンプ（Cardmaker-search.js の
//   openSearchResult）だけは openListView を経由しないため、
//   そちら側でも別途チャンクの読み込みを待っている。）
async function openListView() {
  await loadChunkWithFeedback('listview', '/Cardmaker-listview.js');
  return openListView(); // ★ この時点では本物の実装に差し替わっている
}

// ★ 追加：プレイ中のカードが「元のデッキ順で何問目か」を、
//   青色の「問題」ラベル（.study-q-tag）の横に番号だけ表示する。
//   ─────────────────────────────────────────
//   シャッフルすると study-prog-label（例:「3 / 20」）は再生順の位置に
//   なってしまい、元の問題番号が分からなくなる。このバッジは常に
//   元のデッキ内でのカード順（deck.cards内でのインデックス）の番号だけを表示する。
//   バッジ要素はHTML側に無いので、初回はJSで動的に作って隣に挿入する。
function updateStudyOriginalNumberBadge(c) {
  let badge = document.getElementById('study-orig-num-badge');
  if (!badge) {
    const label = document.querySelector('.study-q-tag');
    if (!label) return; // 「問題」ラベルが見つからなければ何もしない
    badge = document.createElement('span');
    badge.id = 'study-orig-num-badge';
    badge.style.cssText = 'margin-left:4px;';
    label.appendChild(badge); // ★「問題」の文字のすぐ右（タグの中）に入れる
  }
  const deckId = c.__deckId || studyDeckId;
  const deck = decks.find(d => d.id === deckId);
  if (!deck) { badge.textContent = ''; return; }
  const origIdx = deck.cards.findIndex(x => cardKey(x) === cardKey(c));
  badge.textContent = origIdx !== -1 ? String(origIdx + 1) : '';
}

function renderStudyCard() {
  const progressId = studyIsFolder ? studyFolderId : studyDeckId;
  if (studyIdx >= studyCards.length) {
    document.getElementById('study-content').style.display = 'none';
    document.getElementById('study-done').style.display    = 'flex';
    document.getElementById('study-prog-fill').style.width  = '100%';
    document.getElementById('study-prog-label').textContent = `${studyCards.length} / ${studyCards.length}`;
    const doneBadge = document.getElementById('study-orig-num-badge');
    if (doneBadge) doneBadge.textContent = '';
    clearStudyProgress(studyIsFolder, progressId); // ★ 完了したら続きデータは不要になるので消す
    saveCompletionRecord(studyIsFolder, progressId, studyCards.length); // ★ 追加：完了したことを記録する
    renderInProgressUI(); // ★ 追加：ホームの「プレイ中」「プレイ済み」欄を最新状態に更新
    return;
  }
  const c = studyCards[studyIdx];
  markCardSeen(studyIsFolder ? c.__deckId : studyDeckId, c); // ★ 追加：みんなの「わかる率」用に学習済み記録

  // ★ 反転モードなら「問題」欄に解答、「解答」欄に問題文を出す（解説はそのまま解答側に表示）
  const qText = studyReverse ? c.answer   : c.question;
  const qImgs = studyReverse ? c.imgs_a   : c.imgs_q;
  const aText = studyReverse ? c.question : c.answer;
  const aImgs = studyReverse ? c.imgs_q   : c.imgs_a;

  setMathText(document.getElementById('study-q-text'), qText);
  renderImgList(document.getElementById('study-q-imgs'), qImgs);
  // ★ フォルダをまとめてプレイしている場合、この問題がどのカードデッキ由来かを表示する
  const deckTag = document.getElementById('study-deck-tag');
  if (studyIsFolder) {
    const srcDeck = decks.find(d => d.id === c.__deckId);
    if (srcDeck) {
      setIconText(deckTag, Icons.html('cardmaker', {size:14}), srcDeck.name);
      deckTag.style.display = '';
    } else {
      deckTag.style.display = 'none';
    }
  } else {
    deckTag.style.display = 'none';
  }
  document.getElementById('study-answer-panel').classList.remove('show');
  document.getElementById('study-reveal-bar').style.display = 'flex';
  document.getElementById('study-nav').style.display = 'none';

  // ★ 修正：解答入力欄は反転モードかどうかに関わらず常に表示する（自問自答の確認用）。
  //   反転モード中は studyAutoGrade が常に false になる（onReverseModeToggleChange /
  //   startStudyMode 側で強制）ため、ここで欄を表示していても自動採点（○×判定）は
  //   行われない。あくまで「入力欄を使って自分で書いてみる」ことだけができる。
  // ★ 追加：自動採点＋4択モードで、かつこのカードが4択にできる（studyChoicesMapに
  //   登録済み）場合は、解答入力欄の代わりに選択肢欄を表示する。登録されていない
  //   （このカードの元デッキで答えの種類が足りない）場合は、通常の解答入力欄のままにする。
  const choiceEntry = studyFourChoice ? studyChoicesMap.get(cardKey(c)) : null;
  const answerInputWrap = document.getElementById('study-answer-input-wrap');
  const answerInput = document.getElementById('study-answer-input');
  const choiceWrap = document.getElementById('study-choice-wrap');
  answerInputWrap.style.display = choiceEntry ? 'none' : '';
  answerInput.value = '';
  choiceWrap.style.display = choiceEntry ? '' : 'none';
  document.getElementById('reveal-answer-btn').style.display = choiceEntry ? 'none' : '';
  if (choiceEntry) {
    renderStudyChoices(choiceEntry);
  } else {
    // ★ 追加（防御的修正）：4択にできないカードへ切り替わったとき、前のカードの
    //   選択肢ボタン（onclickが前のカードのインデックスに紐づいたまま）を
    //   DOMに残さない。現状choiceWrapはdisplay:noneで隠れるため実害は無いが、
    //   将来どこかがrenderStudyChoicesを経由せずこの欄を再表示する変更が
    //   入った場合に、古いカードの選択肢が誤って押せてしまう事故を防ぐ。
    document.getElementById('study-choices').innerHTML = '';
  }
  const gradeResult = document.getElementById('study-grade-result');
  gradeResult.style.display = 'none';
  gradeResult.className = 'study-grade-result';
  document.getElementById('reveal-answer-btn').textContent = studyAutoGrade ? '採点する' : '答えを見る';

  setMathText(document.getElementById('study-a-text'), aText);
  renderImgList(document.getElementById('study-a-imgs'), aImgs);
  const explWrap = document.getElementById('study-expl-wrap');
  if (c.explanation) { setMathText(document.getElementById('study-e-text'), c.explanation); explWrap.style.display = ''; }
  else { explWrap.style.display = 'none'; }
  const pct = studyCards.length > 1 ? (studyIdx/(studyCards.length-1))*100 : 100;
  document.getElementById('study-prog-fill').style.width  = pct + '%';
  document.getElementById('study-prog-label').textContent = `${studyIdx+1} / ${studyCards.length}`;
  updateStudyOriginalNumberBadge(c); // ★ 追加：シャッフル時も元の問題番号がわかるように表示
  // ★ 答えを見る前・見た後、両方の「前へ」ボタンの有効/無効を同期
  document.getElementById('study-prev').disabled     = studyIdx === 0;
  document.getElementById('study-prev-pre').disabled = studyIdx === 0;
  document.getElementById('study-next').innerHTML = studyIdx === studyCards.length-1 ? ('完了 ' + Icons.html('check', {size:14})) : '次へ →';
  updateUnsureBtn();
  saveStudyProgress(); // ★ カードを表示するたびに現在位置を保存し、次回「続きから」を出せるようにする
}

function revealAnswer() {
  document.getElementById('study-answer-panel').classList.add('show');
  document.getElementById('study-reveal-bar').style.display = 'none';
  document.getElementById('study-nav').style.display = '';
  if (studyAutoGrade) gradeCurrentAnswer(); // ★ 追加：自動採点モードなら○×判定を行う
  updateUnsureBtn();
}

// ★ 追加：自動採点まわりの処理
//   ─────────────────────────────────────────
//   入力欄の解答と正解テキストを正規化（前後の空白・全角スペースを除去し小文字化）して比較し、
//   一致していれば○正解、そうでなければ×不正解と判定する。
//   ×だった場合は自動で「わからない」にマークする（既にマーク済みなら何もしない）。
//   ○だった場合は既存の「わからない」マークを勝手に外したりはしない。
function normalizeAnswerText(s) {
  return (s || '').toLowerCase().replace(/[\s\u3000]/g, '');
}
function gradeCurrentAnswer() {
  const card = studyCards[studyIdx];
  if (!card) return;
  const inputEl = document.getElementById('study-answer-input');
  const input = inputEl ? inputEl.value : '';
  const correctText = studyReverse ? card.question : card.answer; // 自動採点は反転モードでは使わない想定だが念のため
  const normInput = normalizeAnswerText(input);
  const isCorrect = normInput !== '' && normInput === normalizeAnswerText(correctText);

  const result = document.getElementById('study-grade-result');
  const mark = document.getElementById('grade-mark');
  const userAnswerEl = document.getElementById('grade-user-answer');
  result.style.display = 'flex';
  result.className = 'study-grade-result ' + (isCorrect ? 'correct' : 'incorrect');
  mark.innerHTML = isCorrect ? '○ 正解' : (Icons.html('close', {size:14}) + ' 不正解');
  userAnswerEl.textContent = 'あなたの解答：' + (input.trim() ? input : '（未入力）');

  autoMarkUnsureForCard(card, isCorrect);
}

function updateUnsureBtn() {
  const card = studyCards[studyIdx]; if (!card) return;
  const key = cardKey(card);
  const deckId = card.__deckId || studyDeckId; // ★ フォルダプレイなら元デッキid
  const unsure = getUnsureSet(deckId);
  const btn = document.getElementById('unsure-btn');
  btn.textContent = 'わからない';
  btn.classList.toggle('marked', unsure.has(key));
}

function toggleUnsure() {
  const card = studyCards[studyIdx]; if (!card) return;
  const key = cardKey(card);
  const deckId = card.__deckId || studyDeckId; // ★
  const unsure = getUnsureSet(deckId);
  if (unsure.has(key)) unsure.delete(key); else unsure.add(key);
  saveUnsureSet(deckId, unsure);
  updateUnsureBtn();
}

// ★ 追加：カード編集モーダル（modal-card-edit）など、学習画面の上にモーダルが
//   開いている最中かどうかを判定する。モーダルは学習画面自体（.screen.active）を
//   切り替えずに上に重ねて表示されるため、モーダルが開いている間でも
//   document.querySelector('.screen.active')?.id は 'screen-study' のままになる。
//   ─────────────────────────────────────────────
//   （Android不具合の修正）問題ごとの編集画面（カード編集モーダル）を開いた状態で
//   左右のボタンを押すと、モーダルの裏にある学習画面のカードが進む／戻ってしまう
//   不具合があった。原因は、上記の理由でモーダルが開いていることを検知できておらず、
//   下の学習画面のカード送り（studyMove）がそのまま実行されてしまっていたため。
//   ここでカードを送る前に必ずモーダルが開いていないか確認するようにする。
function isStudyOverlayModalOpen() {
  return !!document.querySelector('[id^="modal-"].open');
}
// ★ 修正：editCurrentStudyCard は重複定義されていたため削除。
//   実体は上（reloadCardBeforeEdit の近く）で定義したものを使う。
function studyMove(dir) {
  if (isStudyOverlayModalOpen()) return; // ★ モーダルが開いている間は学習カードを進めない
  studyIdx += dir; renderStudyCard();
}

function shuffleStudy() {
  for (let i=studyCards.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [studyCards[i],studyCards[j]]=[studyCards[j],studyCards[i]];
  }
  studyIdx = 0;
  studyShuffled = true; // ★ 追加：シャッフル済み状態にする。以降の saveStudyProgress で保存され、
                        //   「続きから」で再開したときもこのシャッフル順のまま復元される。
  renderStudyTitle(); // ★ タイトルにシャッフル中を表示（studyShuffledは直前にtrueへ更新済み）
  document.getElementById('study-done').style.display    = 'none';
  document.getElementById('study-content').style.display = 'flex';
  renderStudyCard();
  saveStudyProgress(); // ★ 念のため即座に保存しておく（renderStudyCard内でも保存されるが二重に確実化）
}

document.addEventListener('keydown', e => {
  if (document.querySelector('.screen.active')?.id !== 'screen-study') return;
  // ★ 追加：カード編集モーダルなど、学習画面の上にモーダルが開いている間はショートカットを無効化する
  //   （モーダルは画面遷移扱いにならないため、上のチェックだけでは検知できない）
  if (isStudyOverlayModalOpen()) return;
  // ★ 追加：自動採点の解答入力欄にフォーカス中は、スペースキー等が入力できるようショートカットを無効化する
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key==='ArrowRight') studyMove(1);
  if (e.key==='ArrowLeft' && studyIdx>0) studyMove(-1);
  // ★ 追加：4択モードで選択肢が表示されているカードは、スペースキーでの
  //   「答えを見る」（revealAnswer、テキスト入力前提の採点）を行わない。
  //   選択肢はボタンをクリックして答える（answerStudyChoice）ため。
  const curCard = studyCards[studyIdx];
  const inChoiceMode = studyFourChoice && curCard && studyChoicesMap.has(cardKey(curCard));
  if (e.key===' ' && !inChoiceMode) { e.preventDefault(); revealAnswer(); }
});

// ── 画像 ─────────────────────────────
// アップロード時に長辺を IMG_MAX_DIMENSION にリサイズしJPEG圧縮する。
// GitHub Contents API（1ファイルあたり実用上1MB程度が上限）に収まりやすくするため。
const IMG_MAX_DIMENSION = 1280;
const IMG_JPEG_QUALITY  = 0.72;

// --- EXIFの回転情報を読み取る（スマホ写真が横倒しにならないようにするため） ---
function getExifOrientation(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xFFD8) return 1; // JPEGでない
  const length = view.byteLength;
  let offset = 2;
  while (offset + 4 <= length) {
    const marker = view.getUint16(offset, false);
    if (marker === 0xFFE1) {
      const segLength = view.getUint16(offset + 2, false);
      return readExifOrientation(view, offset + 4, segLength);
    } else if ((marker & 0xFF00) !== 0xFF00) {
      break;
    } else {
      offset += 2 + view.getUint16(offset + 2, false);
    }
  }
  return 1;
}
function readExifOrientation(view, start) {
  if (start + 10 > view.byteLength) return 1;
  if (view.getUint32(start, false) !== 0x45786966) return 1; // "Exif"
  const tiffOffset = start + 6;
  const little = view.getUint16(tiffOffset, false) === 0x4949;
  const firstIFDOffset = view.getUint32(tiffOffset + 4, little);
  const dirStart = tiffOffset + firstIFDOffset;
  if (dirStart + 2 > view.byteLength) return 1;
  const entries = view.getUint16(dirStart, little);
  for (let i = 0; i < entries; i++) {
    const entryOffset = dirStart + 2 + i * 12;
    if (entryOffset + 10 > view.byteLength) break;
    if (view.getUint16(entryOffset, little) === 0x0112) {
      return view.getUint16(entryOffset + 8, little);
    }
  }
  return 1;
}
// 1〜8のEXIF orientation値をcanvasの変形に変換する
function applyOrientationTransform(ctx, orientation, width, height) {
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, width, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, width, height); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, height); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, height, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, height, width); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, width); break;
    default: break; // 1（回転なし）
  }
}
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像の読み込みに失敗しました')); };
    img.src = url;
  });
}
async function compressImageFile(file) {
  let orientation = 1;
  if (file.type === 'image/jpeg') {
    try {
      const buf = await file.slice(0, 128 * 1024).arrayBuffer();
      orientation = getExifOrientation(buf);
    } catch(e) { orientation = 1; }
  }

  const img = await loadImageFromFile(file);
  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;
  if (width > IMG_MAX_DIMENSION || height > IMG_MAX_DIMENSION) {
    if (width >= height) { height = Math.round(height * IMG_MAX_DIMENSION / width); width = IMG_MAX_DIMENSION; }
    else { width = Math.round(width * IMG_MAX_DIMENSION / height); height = IMG_MAX_DIMENSION; }
  }

  const swapDims = orientation >= 5 && orientation <= 8; // 90°/270°回転の場合は縦横が入れ替わる
  const canvas = document.createElement('canvas');
  canvas.width  = swapDims ? height : width;
  canvas.height = swapDims ? width  : height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // 透過PNGがJPEG化で黒くならないよう白背景にする
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  applyOrientationTransform(ctx, orientation, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', IMG_JPEG_QUALITY);
}

let imgTarget = null;
const imgInput = document.getElementById('img-file-input');
// ★ 変更：デッキ編集画面の新規カード作成から呼ばれる場合
function addImage(t) { imgTarget=t; imgContext='editor'; imgInput.click(); }
// ★ 追加：カード編集モーダルから呼ばれる場合
function addModalImage(t) { imgTarget=t; imgContext='modal'; imgInput.click(); }

imgInput.addEventListener('change', async () => {
  const file = imgInput.files[0]; if (!file||!imgTarget) return;
  const target = imgTarget;
  const context = imgContext; // ★ 追加：どちらの画面から呼ばれたかを確定させておく
  imgInput.value = '';
  try {
    const dataUrl = await compressImageFile(file);
    if (context === 'modal') {
      editImgBuf[target].push(dataUrl);
      renderModalImgStrip(target);
    } else {
      imgBuf[target].push(dataUrl);
      renderImgStrip(target);
    }
  } catch(e) {
    await showCmAlert({ title: '画像の読み込みに失敗しました', desc: '別の画像で試してください。' });
  }
});
// ★ セキュリティ：renderImgList()と同じ理由（save_cardsはimgs_q/imgs_a/imgs_eの
//   中身を検証していないため、共有デッキ経由で他人が仕込んだ文字列が入りうる）で、
//   ここも`<img src="${b}">`のようなテンプレート文字列ではなく、削除ボタン込みで
//   DOM APIで組み立てる共通ヘルパーに統一する（imgBuf側はJS内で作った data: URL
//   しか入らないので実害は薄いが、editImgBuf側は既存カード＝他人の入力を
//   そのまま引き継ぐため、同じ描画関数を使い回すここでは常に安全な方だけ用意する）。
function renderImgThumbStrip(container, imgs, onRemove) {
  container.innerHTML = '';
  imgs.forEach((b, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'img-thumb';
    const img = document.createElement('img');
    img.src = b;
    img.alt = '';
    img.addEventListener('click', () => openImgLightbox(img.src));
    const delBtn = document.createElement('button');
    delBtn.className = 'img-thumb-del';
    delBtn.innerHTML = Icons.html('close', {size:12}); // ★ Icons.jsの固定SVG（ユーザー入力を含まないため安全）
    delBtn.addEventListener('click', () => onRemove(i));
    wrap.appendChild(img);
    wrap.appendChild(delBtn);
    container.appendChild(wrap);
  });
}
function renderImgStrip(k) {
  renderImgThumbStrip(document.getElementById('imgs-'+k), imgBuf[k], (i) => removeImg(k, i));
}
function removeImg(k,i) { imgBuf[k].splice(i,1); renderImgStrip(k); }

// ★ 追加：カード編集モーダル用の画像ストリップ描画・削除
function renderModalImgStrip(k) {
  renderImgThumbStrip(document.getElementById('modal-imgs-'+k), editImgBuf[k], (i) => removeModalImg(k, i));
}
function removeModalImg(k,i) { editImgBuf[k].splice(i,1); renderModalImgStrip(k); }


// ── モーダル ──────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function onOverlayClick(e,id) { if(e.target===document.getElementById(id)) closeModal(id); }

// ── 画像ライトボックス（タップで拡大表示） ──────
function openImgLightbox(src) {
  if (!src) return;
  document.getElementById('img-lightbox-img').src = src;
  document.getElementById('img-lightbox').classList.add('open');
}
function closeImgLightbox() {
  document.getElementById('img-lightbox').classList.remove('open');
  document.getElementById('img-lightbox-img').src = '';
}

// ── ドロワー ──────────────────────────
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
    '/Plan.js',
    '/Timetable.js',
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

// ── バナー ────────────────────────────
// ★ iconHtml（Icons.html()/Icons.cmHtml()の戻り値）を渡すと、絵文字の
//   代わりに自作アイコンを先頭に添える。msg は常にこのファイル内の固定
//   文字列（呼び出し側にユーザー入力を渡す箇所は無い）なので、innerHTMLで
//   組み立てても安全。
function showBanner(msg, bg, color, iconHtml) {
  const banner = document.getElementById('save-ok-banner');
  banner.innerHTML = (iconHtml ? iconHtml + ' ' : '') + esc(msg);
  banner.style.background = bg;
  banner.style.color = color;
  banner.style.display = 'block';
  setTimeout(() => {
    banner.style.display = 'none';
    banner.style.background = '#dcfce7';
    banner.style.color = '#166534';
  }, 3500);
}

// ── チャンク（機能ごとに分割した追加JS）の読み込み ──────────
//   ★ 追加：Cardmaker.jsを丸ごと最初に読み込むと重いので、一覧表示に
//   最低限必要な部分（このファイル）だけをまず読み込み、検索など
//   すぐには使わない機能は別ファイルに分けて、初期表示が終わった後に
//   バックグラウンドで順番に読み込んでいく（使う/使わないにかかわらず、
//   1つ読み終わったら次、と順に読み進める）。
//   通常はユーザーがその機能を使う前に読み込みが終わっているはずだが、
//   万一間に合っていない状態でその機能が呼ばれても、loadChunk() が
//   読み込み完了まで待ってから続きを実行するので壊れない。
const _chunkPromises = {};
const _chunkDone = new Set(); // ★ 追加：既に読み込み完了したチャンク名（ローディング表示の要否判定用）
function loadChunk(name, src) {
  if (_chunkPromises[name]) return _chunkPromises[name];
  _chunkPromises[name] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => { _chunkDone.add(name); resolve(); };
    s.onerror = () => reject(new Error('chunk load failed: ' + src));
    document.head.appendChild(s);
  });
  return _chunkPromises[name];
}
// ★ 追加：まだ読み込み終わっていないチャンクを使おうとした場合だけ、
//   （通常は背景読み込みで既に終わっているので出番はまれ）ページ遷移
//   用と同じローディング表示を一時的に出しつつ待つ。タップしても
//   何も起きないように見える事故を防ぐための保険。
async function loadChunkWithFeedback(name, src) {
  if (_chunkDone.has(name)) return loadChunk(name, src);
  const overlay = document.getElementById('page-nav-loading');
  if (overlay) overlay.classList.add('show');
  try {
    await loadChunk(name, src);
  } finally {
    if (overlay) overlay.classList.remove('show');
  }
}
// ★ 一覧の初期表示が終わった後に呼ばれる（起動処理を参照）。
//   ここに載せたチャンクを順番に（1つ終わったら次を）読み込んでいく。
async function loadChunksInBackground() {
  const chunks = [
    ['search', '/Cardmaker-search.js'],
    ['quizplay', '/Cardmaker-quizplay.js'],
    ['listview', '/Cardmaker-listview.js'],
    ['csvimport', '/Cardmaker-csvimport.js'],
    ['cardreorder', '/Cardmaker-cardreorder.js'],
  ];
  for (const [name, src] of chunks) {
    try { await loadChunk(name, src); } catch (e) { console.warn('[cardmaker]', e); }
  }
}

// ── ユーティリティ ────────────────────
// ★ セキュリティ：&/</>だけでなく "/' もエスケープする（value="${esc(x)}"のような
//   属性値コンテキストでも安全に使えるようにするため。&quot;/&#39;はHTMLとして
//   描画されれば元の文字に戻るので、テキストとして使う箇所には影響しない）。
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
// ★ 追加：絵文字の代わりに自作アイコン（Icons.js）を使うため、これまで
//   .textContent = アイコン絵文字 + ユーザー入力（デッキ名・フォルダ名等）
//   としていた箇所をDOM APIで安全に組み立て直す共通ヘルパー。アイコン部分は
//   このファイル内の固定HTML（insertAdjacentHTMLで挿入）、テキスト部分は
//   textNodeとして追加するので、フォルダ名・デッキ名に何が入っていても
//   HTMLとしては解釈されない（保存型XSS対策、textContentの時と同じ安全性）。
function setIconText(el, iconHtml, text) {
  el.innerHTML = '';
  if (iconHtml) el.insertAdjacentHTML('beforeend', iconHtml);
  el.appendChild(document.createTextNode((iconHtml ? ' ' : '') + text));
}
// ★ セキュリティ：問題・解答の画像は、直接APIを叩けば任意の文字列を
//   imgs_q/imgs_aへ入れられてしまう（save_cardsはこの中身を検証していない）。
//   `<img src="${s}">` のようにテンプレート文字列でHTMLを組み立てると、
//   sに " を含めるだけで属性の外へ抜けてXSSになるため、必ずDOMのsrc
//   プロパティへ代入する（この方法なら中身が何であってもHTMLとしては解釈されない）。
function renderImgList(container, imgs) {
  container.innerHTML = '';
  (imgs || []).forEach(s => {
    const img = document.createElement('img');
    img.src = s;
    img.alt = '';
    img.addEventListener('click', () => openImgLightbox(img.src));
    container.appendChild(img);
  });
}
function autoResize(el) { el.style.height='auto'; el.style.height=el.scrollHeight+'px'; }
function shake(id) {
  const el=document.getElementById(id); el.style.borderColor='#EF4444'; el.focus();
  setTimeout(()=>el.style.borderColor='',700);
}

// ★ 追加：ボタンにローディング状態（スピナー表示＋押せなくする）をトグルするユーティリティ。
//   ─────────────────────────────────────────
//   「作成」ボタンなどを押した際、サーバー通信が終わるまで見た目が何も
//   変わらず「本当に押せたのか」分かりにくいという問題を解消するために使う。
//   loading=true の間、ボタンの元の中身は data-orig-html に退避しておき、
//   loading=false に戻すときに復元する。
function setBtnLoading(btn, loading, loadingText) {
  if (!btn) return;
  if (loading) {
    if (btn.dataset.origHtml === undefined) btn.dataset.origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('btn-loading');
    btn.innerHTML = `<span class="btn-spinner"></span>${loadingText ? esc(loadingText) : ''}`;
  } else {
    btn.disabled = false;
    btn.classList.remove('btn-loading');
    if (btn.dataset.origHtml !== undefined) {
      btn.innerHTML = btn.dataset.origHtml;
      delete btn.dataset.origHtml;
    }
  }
}

// ============================================================
//  ★ 入力チェック：バグ・表示崩れ・不正な符号位置になりやすい文字を弾く
//  ─────────────────────────────────────────────
//  ・①②③ ㈱㈲㈹ ㍾㍽㎜㎡ などの「機種依存文字」は許可（見た目が出るため）。
//  ・弾くのは主に次の3種類：
//    1) 制御文字（RLO/LROなどの双方向制御・Unicodeタグ文字など）
//    2) 見た目に何も表示されないが実害の大きい文字
//       （ゼロ幅スペース／Word Joiner／BOMなど）
//    3) 壊れた符号位置（孤立サロゲート・非文字コードポイント）
//       → GitHub等でエラーになったり読み込めなくなったりする原因
// ============================================================

// 私用領域（PUA）・非文字コードポイント（Unicode仕様上「文字として未定義」の符号位置）
const BUG_CHAR_RANGES = [
  [0xE000, 0xF8FF],   // 私用領域（外字・gaiji。フォント依存で環境ごとに表示が変わる/崩れる）
  [0xFDD0, 0xFDEF],   // 非文字コードポイント（Unicodeで予約された「文字ではない」符号位置）
];
const BUG_CHAR_CODES = new Set([0xFFFE, 0xFFFF]); // 非文字コードポイント（BMP末尾）

// ── 非表示Unicode文字（見た目に出ない・不正な文字順を偽装できる文字） ──
// ・U+200D（ZWJ）と異体字セレクタ（VS1-16 / VS17-256）は、結合絵文字
//   （👨‍👩‍👧‍👦など）や日本語の異体字シーケンス（IVS）で正規に使われるため対象外とする。
const INVISIBLE_CHAR_RANGES = [
  [0x200B, 0x200C], // ゼロ幅スペース、ZWNJ（※200Dは含まない＝ZWJは許可）
  [0x2060, 0x2064], // Word Joiner、不可視の演算子記号など
  [0x2066, 0x2069], // 双方向テキストの分離文字（LRI/RLI/FSI/PDI）
  [0x202A, 0x202E], // 双方向テキストの埋め込み・上書き（LRE/RLE/PDF/LRO/RLO）
  [0xE0000, 0xE007F], // Unicodeタグ文字（見えないままテキストを埋め込める）
];
const INVISIBLE_CHAR_CODES = new Set([0x00AD, 0x180E, 0xFEFF]); // ソフトハイフン／モンゴル母音分離符／BOM

function isAllowedInvisible(cp) {
  if (cp === 0x200D) return true; // ZWJ（絵文字結合）
  if (cp >= 0xFE00 && cp <= 0xFE0F) return true; // VS1-16（異体字・絵文字表示指定）
  if (cp >= 0xE0100 && cp <= 0xE01EF) return true; // VS17-256（IVS用）
  return false;
}

// 文字列中の「バグ文字」だけを重複なく抽出して返す（無ければ空配列）
function findBugChars(str) {
  if (!str) return [];
  const found = [];
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (isAllowedInvisible(cp)) continue;
    const isCtrl   = cp < 0x20 && ch !== '\t' && ch !== '\n' && ch !== '\r';
    const isDel    = cp === 0x7F;
    const isLoneSg = cp >= 0xD800 && cp <= 0xDFFF; // 孤立サロゲート（壊れた絵文字等）
    const isRange  = BUG_CHAR_RANGES.some(([s, e]) => cp >= s && cp <= e) || BUG_CHAR_CODES.has(cp);
    const isInvis  = INVISIBLE_CHAR_RANGES.some(([s, e]) => cp >= s && cp <= e) || INVISIBLE_CHAR_CODES.has(cp);
    if ((isCtrl || isDel || isLoneSg || isRange || isInvis) && !found.includes(ch)) found.push(ch);
  }
  return found;
}

// 該当文字があれば自前アラートで警告して true（＝入力NG）を返す
async function warnIfBugChars(str, fieldId) {
  const bad = findBugChars(str);
  if (bad.length === 0) return false;
  await showCmAlert({
    title: '使用できない文字が含まれています',
    desc: '見た目に表示されない特殊な制御文字（ゼロ幅スペース・文字方向の制御文字など）や、\n'
        + '壊れた文字コード・未定義の符号位置は、他の端末や外部サービスで\n'
        + 'エラーや文字化けの原因になるため使用できません。\n\n'
        + `該当文字：${bad.join(' ')}\n\nお手数ですが該当箇所を削除・打ち直してください。`,
  });
  if (fieldId) shake(fieldId);
  return true;
}

// ============================================================
//  ★ 追加：理数モード（分数・ルートを「教科書と同じ普通の見た目」で入力・表示する）
//  ─────────────────────────────────────────────
//  ・入力欄（問題文・解答など）そのものには、常に「√(4)」「(3)/(4)」のような
//    読みやすい簡易記法だけを表示・保存する。\(\sqrt{4}\) のような生のLaTeX記法を
//    ユーザーの目に触れさせることは一切しない。
//  ・実際にきれいな見た目（分数の横線、根号が伸びるルートなど）で描画したい瞬間
//    （理数モードのプレビュー欄・プレイ画面）だけ、simpleMathToLatexで内部的に
//    LaTeXへ変換してからKaTeXに渡す。保存されるデータ自体は最後まで簡易記法のまま。
//  ・既に「\(\sqrt{...}\)」のような旧形式（生LaTeX）で保存済みの既存カードも、
//    simpleMathToLatexではパターンが一致しないためそのまま素通りし、
//    今まで通りKaTeXで正しく描画される（後方互換）。
//  ・上付き・下付き文字や±などの記号は、単独でも問題なく表示できるよう
//    従来どおりUnicode文字をそのまま挿入する方式のままにしている。
// ============================================================

// 文字列 s の位置 openIdx にある '(' に対応する ')' の位置を返す（ネスト対応）。見つからなければ -1。
function findMatchingParen(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// simpleMathToLatexの内部再帰用：\( \) を付けない「素の」LaTeXへの変換。
// √の中に分数がある等、ネストした数式の内側で使う（KaTeXの引数の中に\(\)を
// 再度差し込むと壊れるため、ネスト部分には区切り記号を付けない）。
function simpleMathToLatexRaw(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if ((s[i] === '√' || s[i] === '∛') && s[i+1] === '(') {
      const isCube = s[i] === '∛';
      const closeIdx = findMatchingParen(s, i+1);
      if (closeIdx !== -1) {
        const inner = simpleMathToLatexRaw(s.slice(i+2, closeIdx));
        out += isCube ? `\\sqrt[3]{${inner}}` : `\\sqrt{${inner}}`;
        i = closeIdx + 1;
        continue;
      }
    }
    if (s[i] === '(') {
      const closeIdx = findMatchingParen(s, i);
      if (closeIdx !== -1 && s[closeIdx+1] === '/' && s[closeIdx+2] === '(') {
        const closeIdx2 = findMatchingParen(s, closeIdx+2);
        if (closeIdx2 !== -1) {
          const num = simpleMathToLatexRaw(s.slice(i+1, closeIdx));
          const den = simpleMathToLatexRaw(s.slice(closeIdx+3, closeIdx2));
          out += `\\frac{${num}}{${den}}`;
          i = closeIdx2 + 1;
          continue;
        }
      }
    }
    out += s[i];
    i++;
  }
  return out;
}

// 簡易記法（√(...) ・ ∛(...) ・ (分子)/(分母)）を、KaTeXが描画できるLaTeX記法へ変換する。
// 内側にネストした数式（√の中に分数がある等）も再帰的に変換する。
// 該当するパターンが無い部分（旧形式の生LaTeXや、普通の文章）はそのまま素通しする。
function simpleMathToLatex(raw) {
  if (raw == null) return '';
  const s = String(raw);
  let out = '';
  let i = 0;
  while (i < s.length) {
    // √(...) ・ ∛(...)
    if ((s[i] === '√' || s[i] === '∛') && s[i+1] === '(') {
      const isCube = s[i] === '∛';
      const closeIdx = findMatchingParen(s, i+1);
      if (closeIdx !== -1) {
        const inner = simpleMathToLatexRaw(s.slice(i+2, closeIdx));
        out += isCube ? `\\(\\sqrt[3]{${inner}}\\)` : `\\(\\sqrt{${inner}}\\)`;
        i = closeIdx + 1;
        continue;
      }
    }
    // (分子)/(分母)
    if (s[i] === '(') {
      const closeIdx = findMatchingParen(s, i);
      if (closeIdx !== -1 && s[closeIdx+1] === '/' && s[closeIdx+2] === '(') {
        const closeIdx2 = findMatchingParen(s, closeIdx+2);
        if (closeIdx2 !== -1) {
          const num = simpleMathToLatexRaw(s.slice(i+1, closeIdx));
          const den = simpleMathToLatexRaw(s.slice(closeIdx+3, closeIdx2));
          out += `\\(\\frac{${num}}{${den}}\\)`;
          i = closeIdx2 + 1;
          continue;
        }
      }

    }
    out += s[i];
    i++;
  }
  return out;
}

// 生のテキスト（√(4)のような簡易記法、または旧形式の\(\frac{}{}\)なども含む）を、
// 指定要素に「普通の数式の見た目」で描画する。
// KaTeXが読み込めていない場合（オフライン等）は記法そのままの文章として表示する。
function setMathText(el, raw) {
  if (!el) return;
  el.textContent = simpleMathToLatex(raw || '');
  if (window.renderMathInElement) {
    try {
      renderMathInElement(el, {
        delimiters: [{ left: '\\(', right: '\\)', display: false }],
        throwOnError: false,
      });
    } catch (e) { /* 描画に失敗しても元のプレーンテキストのまま表示される */ }
  }
}

// 一覧などの1行プレビュー（改行・スタック表示ができない場所）用に、
// 記法をできるだけ読みやすいプレーンテキストへ変換する簡易版。
// ★ 新形式（√(4)など）は既にそのまま読みやすい形なので無変換で素通しし、
//   旧形式（\(\sqrt{4}\)など）だけをここで読みやすい形へ変換する。
const MATH_SUP_MAP = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻','n':'ⁿ'};
const MATH_SUB_MAP = {'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','+':'₊','-':'₋'};
function mathToPlainText(raw) {
  if (raw == null) return '';
  let s = String(raw);
  s = s.replace(/\\\(|\\\)/g, '');
  s = s.replace(/\\sqrt\[(.*?)\]\{([^{}]*)\}/g, (m, n, a) => `${n}√(${a})`);
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, (m, a) => `√(${a})`);
  for (let i = 0; i < 3; i++) {
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (m, a, b) => `(${a})/(${b})`);
  }
  s = s.replace(/\^\{([^{}]*)\}/g, (m, a) => a.length === 1 && MATH_SUP_MAP[a] ? MATH_SUP_MAP[a] : `^${a}`);
  s = s.replace(/_\{([^{}]*)\}/g, (m, a) => a.length === 1 && MATH_SUB_MAP[a] ? MATH_SUB_MAP[a] : `_${a}`);
  return s;
}

// 学習画面など「編集ではなく表示するだけ」の場所で使う簡易表示用ヘルパー。
// KaTeXでの本描画はせず、mathToPlainTextで変換した崩れない文字列をそのまま入れる。
function setSimpleMathText(el, raw) {
  if (!el) return;
  el.textContent = mathToPlainText(raw);
}

const MATH_PAD_HTML = (function(){
  const supKeys = ['⁰','¹','²','³','⁴','⁵','⁶','⁷','⁸','⁹','⁺','⁻','⁽','⁾','ⁿ'];
  const subKeys = ['₀','₁','₂','₃','₄','₅','₆','₇','₈','₉','₊','₋','₍','₎'];
  const symKeys = ['±','∓','×','÷','≤','≥','≠','≈','∞','π','θ','°','∑','∫'];
  const keyBtn = c => `<button type="button" class="math-key" data-ch="${c}">${c}</button>`;
  return `
    <div class="math-pad-header">
      <span class="math-pad-title">${Icons.cmHtml('tally', {size:15})} 理数モード</span>
      <button type="button" class="math-pad-close" onclick="toggleMathPad(this.closest('.math-pad').id)" aria-label="閉じる">${Icons.html('close', {size:16})}</button>
    </div>
    <div class="math-pad-body">
      <div class="math-preview-label">プレビュー</div>
      <div class="math-preview"></div>
      <div class="math-row math-row-struct">
        <span class="math-row-label">分数・ルート（教科書と同じ見た目で表示されます）</span>
        <button type="button" class="math-key math-key-wide" data-action="frac">分数<span class="math-key-hint">(a)/(b)</span></button>
        <button type="button" class="math-key" data-action="sqrt">√</button>
        <button type="button" class="math-key" data-action="cbrt">∛</button>
      </div>
      <div class="math-row math-row-sup">
        <span class="math-row-label">上付き文字（乗数など）</span>
        ${supKeys.map(keyBtn).join('')}
      </div>
      <div class="math-row math-row-sub">
        <span class="math-row-label">下付き文字（添字など）</span>
        ${subKeys.map(keyBtn).join('')}
      </div>
      <div class="math-row math-row-sym">
        <span class="math-row-label">記号</span>
        ${symKeys.map(keyBtn).join('')}
      </div>
      <div class="math-pad-tip">${Icons.html('hint', {size:16})} 分数・ルートは、数字や文字を選択してからボタンを押すとその部分が中に入ります。</div>
    </div>`;
})();

function initMathPads() {
  document.querySelectorAll('.math-pad').forEach(pad => {
    if (pad.dataset.built) return;
    pad.innerHTML = MATH_PAD_HTML;
    pad.dataset.built = '1';
    const target  = document.getElementById(pad.dataset.target);
    const preview = pad.querySelector('.math-preview');
    if (target && preview) {
      const update = () => setMathText(preview, target.value);
      target.addEventListener('input', update);
      pad._mathUpdate = update;
    }
    if (target) attachInlineSimplePreview(target);
  });
}

// ★ 追加：問題文・解答などの入力欄（ta-q / modal-edit-q など）そのものの直下に、
//   \(\sqrt{}\) のような生のLaTeX記法ではなく「√()」のような読みやすい簡易表示を
//   常時プレビューする。理数記号パレットをわざわざ開かなくても、入力欄を
//   見ただけでどんな数式になっているかがひと目でわかるようにするため。
//   （教科書と同じ本格的な見た目のプレビューは、既存の理数モードパレット内の
//   プレビューが担当するので、ここでは崩れない軽量なテキスト表示にとどめる）
function attachInlineSimplePreview(target) {
  if (!target || target.dataset.simplePreviewAttached) return;
  target.dataset.simplePreviewAttached = '1';
  const preview = document.createElement('div');
  preview.className = 'math-inline-simple-preview';
  preview.style.cssText = 'margin-top:4px;padding:2px 0;font-size:13px;color:var(--text-secondary,#888);white-space:pre-wrap;word-break:break-word;';
  target.insertAdjacentElement('afterend', preview);
  const update = () => {
    const plain = mathToPlainText(target.value);
    // 数式記法を含んでいない（＝普通の文章のまま）場合は、二重表示を避けるため何も出さない
    preview.textContent = plain === target.value ? '' : plain;
  };
  target.addEventListener('input', update);
  update();
}

// 単純な1文字挿入（選択範囲があればそこを置き換える＝ふつうの文字入力と同じ挙動）
function mathInsertChar(el, ch) {
  const start = el.selectionStart != null ? el.selectionStart : el.value.length;
  const end   = el.selectionEnd   != null ? el.selectionEnd   : el.value.length;
  el.value = el.value.slice(0, start) + ch + el.value.slice(end);
  const pos = start + ch.length;
  el.focus();
  el.setSelectionRange(pos, pos);
  autoResize(el);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// 「囲み挿入」。選択範囲があればそれを openStr/closeStr で囲み、無ければ間にカーソルを置く。
// √・∛はこれ一本で、それぞれ \( \) ごと自己完結した数式として挿入される。
function mathInsertWrap(el, openStr, closeStr) {
  const start = el.selectionStart != null ? el.selectionStart : el.value.length;
  const end   = el.selectionEnd   != null ? el.selectionEnd   : el.value.length;
  const sel = el.value.slice(start, end);
  el.value = el.value.slice(0, start) + openStr + sel + closeStr + el.value.slice(end);
  const pos = sel ? (start + openStr.length + sel.length + closeStr.length) : (start + openStr.length);
  el.focus();
  el.setSelectionRange(pos, pos);
  autoResize(el);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// 分数専用：選択範囲を分子にして (分子)/(分母) という読みやすい記法を作る。
// 選択があれば分母側にカーソルを、無ければ分子側にカーソルを置く。
function mathInsertFraction(el) {
  const start = el.selectionStart != null ? el.selectionStart : el.value.length;
  const end   = el.selectionEnd   != null ? el.selectionEnd   : el.value.length;
  const sel = el.value.slice(start, end);
  const prefix = '(';
  const middle = `${sel})/(`;
  const suffix = ')';
  el.value = el.value.slice(0, start) + prefix + middle + suffix + el.value.slice(end);
  const numPos = start + prefix.length;
  const denPos = start + prefix.length + middle.length;
  const pos = sel ? denPos : numPos;
  el.focus();
  el.setSelectionRange(pos, pos);
  autoResize(el);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// パレットの表示・非表示を切り替える（ボタン側の onclick から呼ばれる）
// 開いたときは対応する切り替えボタン（data-btn で紐付け）もハイライトし、プレビューも更新する
function toggleMathPad(padId) {
  const pad = document.getElementById(padId);
  if (!pad) return;
  const opening = pad.style.display !== 'block';
  pad.style.display = opening ? 'block' : 'none';
  const btn = pad.dataset.btn ? document.getElementById(pad.dataset.btn) : null;
  if (btn) btn.classList.toggle('math-btn-active', opening);
  if (opening && pad._mathUpdate) pad._mathUpdate();
}

// ボタンタップは1か所に委任して処理（パレットは複数箇所に存在するため）
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.math-key');
  if (!btn) return;
  const pad = btn.closest('.math-pad');
  if (!pad) return;
  const target = document.getElementById(pad.dataset.target);
  if (!target) return;
  switch (btn.dataset.action) {
    case 'frac': mathInsertFraction(target); break;
    case 'sqrt': mathInsertWrap(target, '√(', ')'); break;
    case 'cbrt': mathInsertWrap(target, '∛(', ')'); break;
    default:     mathInsertChar(target, btn.dataset.ch || '');
  }
});

initMathPads();

// ── 起動 ──────────────────────────────
renderDeckList().then(() => { initPickModeFromUrl(); jumpToDeckFromUrl(); });
loadChunksInBackground(); // ★ 追加：初期表示をブロックせず、残りの機能チャンクを裏で順に読み込む
prefetchOtherPages(); // ★ 追加：メニューを開くのを待たず、初期表示後に自動で他ページを裏で先読み

// ===== Discord通知からのディープリンク対応 =====
// ★ 追加：通知メッセージのリンク（例: Cardmaker.html?deck=set_xxxx.json）から
//   開かれた場合、そのデッキがあるフォルダまで自動で移動し、該当デッキを
//   ハイライト表示して分かりやすくする。
//   ・renderDeckList() で最新のdecks/foldersを取得し終えた後に実行する
//     （まだ取得前だと該当デッキが見つからず何もできないため）。
//   ・一度処理したら history.replaceState で ?deck= をURLから消しておき、
//     その後リロードしたり通知を再度開いたりしても毎回飛ばないようにする。
async function jumpToDeckFromUrl() {
  const params = new URLSearchParams(location.search);
  const targetFilename = params.get('deck');
  if (!targetFilename) return;

  // URLをきれいな状態に戻しておく（ブックマーク・再読み込み時に毎回飛ばされないように）
  history.replaceState(null, '', location.pathname + location.hash);

  const deck = decks.find(d => d.filename === targetFilename);
  if (!deck) return; // 見つからなければ何もしない（削除された・未同期などのケース）

  // デッキが入っているフォルダ（ルートなら null）まで画面を移動する
  openFolder(deck.folderId || null);

  // renderDeckListUI() によるDOM再構築を待ってから、該当デッキまでスクロール＆ハイライトする
  requestAnimationFrame(() => {
    const grid = document.getElementById('deck-grid');
    const el = grid && grid.querySelector(`[data-key="deck:${CSS.escape(targetFilename)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.transition = 'box-shadow 0.3s ease, transform 0.3s ease';
    el.style.boxShadow = '0 0 0 3px #3b82f6, 0 4px 14px rgba(59,130,246,0.35)';
    el.style.transform = 'scale(1.02)';
    setTimeout(() => {
      el.style.boxShadow = '';
      el.style.transform = '';
    }, 2200);
  });
}

// ===== ★ リアルタイム更新（Server-Sent Events） =====
//   以前は list_cards / list_folders / list_order をそれぞれ10秒おきに
//   ポーリングしてハッシュ比較していたが、サーバーが実際に常時稼働している
//   ので、変更があった瞬間にpushしてもらい即座に再取得する方式に変える。
//   ・サーバー側は「何かが変わった」とだけ知らせてくる（中身は含まない）ので、
//     受け取ったら3つとも念のためチェックし直す（変わっていない分は
//     ハッシュ比較でそのままスキップされるので無駄にはならない）。
//   ・接続が切れていた場合に備え、10秒間隔のフォールバックポーリングも残す
//     （EventSourceは自動再接続するが、万一に備えた保険）。
function startRealtimeUpdates() {
  try {
    const es = new EventSource(`${API_BASE}events?guild_id=${GUILD_ID}`);
    es.onmessage = () => {
      checkCardsUpdate();
      checkFoldersUpdate();
      checkOrderUpdate();
    };
    // onerrorは特に何もしない（EventSourceが自動的に再接続を試みる）
  } catch (e) {
    // EventSource非対応環境などでも、下のフォールバックポーリングだけで動作を継続できる
  }
}
startRealtimeUpdates();

// ===== JSON変更監視（公開デッキ list_cards のみ） =====
let lastCardsHash = null;

// SHA-256 ハッシュ計算
async function digestMessage(message) {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// 公開デッキJSONの変更チェック
// ★ 変更点：location.reload() をやめ、画面を邪魔しない更新に変更。
//   ・一覧画面を見ている時だけ、その場で表示を更新
//   ・編集中／プレイ中の画面はそのままにして、リロードもしない
//     （データはバックグラウンドで decks / localStorage に反映されるので、
//       次に一覧へ戻った時には最新の状態になっている）
//   ・list_cards は軽量メタ情報のみなので、このポーリング自体も軽くなった。
async function checkCardsUpdate() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    // ★ cache: 'no-store' を追加：これが無いと、ハッシュ比較のための取得自体が
    //   キャッシュされたレスポンスを見てしまい、更新検知が機能しないことがあるため。
    const session = getLoginSession();
    const res = await fetch(`${API_BASE}list_cards?guild_id=${GUILD_ID}`, {
      signal: controller.signal, cache: 'no-store',
      headers: session?.session_token ? { 'Authorization': 'Bearer ' + session.session_token } : {},
    });
    clearTimeout(timer);
    const txt = await res.text();
    const hash = await digestMessage(txt);

    // 初回は保存だけ
    if (lastCardsHash === null) {
      lastCardsHash = hash;
      return;
    }

    // ハッシュが変わっていなければ何もしない
    if (hash === lastCardsHash) return;
    lastCardsHash = hash;

    // データをバックグラウンドでマージ（プレイ中・編集中の画面はそのまま）
    await fetchAndMergeDecks();

    // 一覧画面を見ている時だけ、その場で再描画する
    const activeScreen = document.querySelector('.screen.active')?.id;
    if (activeScreen === 'screen-list') {
      renderDeckListUI();
    }
  } catch(e) {}
}

// ★ 通常はSSEで即時反映される。これは接続が切れた場合の保険（10秒間隔）
setInterval(checkCardsUpdate, 10000);

// ===== ページ復帰時の強制リフレッシュ（Chromeのbfcache / バックグラウンド対策） =====
//   ・ドロワーで他のページに移動して「戻る」で復帰したとき、Chromeなどは
//     ページをスクリプト再実行せずそのまま凍結復元することがある（bfcache）。
//     この場合、setIntervalによるポーリングは次のタイミングまで動かないため、
//     他の人が更新した内容がすぐには反映されない。
//   ・スマホでアプリを切り替えて長時間バックグラウンドに置いた場合も、
//     復帰直後はまだ古いデータのままになりがち。
//   → ページが「再び見える状態になった瞬間」に、10秒待たず即座に
//     最新データを取りに行くことで解消する。
let isForceRefreshing = false;
async function forceRefreshOnReturn() {
  if (isForceRefreshing) return;
  isForceRefreshing = true;
  try {
    await Promise.all([fetchAndMergeDecks(), fetchAndMergeFolders(), fetchAndMergeOrder(), fetchAndMergeStudyData()]);
    if (document.querySelector('.screen.active')?.id === 'screen-list') {
      renderDeckListUI();
    }
    preloadUnsureBadges();
  } finally {
    isForceRefreshing = false;
  }
}

// bfcacheから復元された場合（persisted === true）に発火
window.addEventListener('pageshow', (e) => {
  if (e.persisted) forceRefreshOnReturn();
  // ★ 追加：ページ遷移ローディングの表示が残ったまま（＝他ページに移動しかけた
  //   状態のまま）bfcacheに入っていた場合、「戻る」で復元したときに画面が
  //   ローディングで覆われたまま固まって見えてしまうのを防ぐ。
  const overlay = document.getElementById('page-nav-loading');
  if (overlay) overlay.classList.remove('show');
});

// タブ／アプリがバックグラウンドから表示状態に戻った瞬間に発火
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') forceRefreshOnReturn();
});
// ===== JSON変更監視（共有フォルダ folders.json） =====
let lastFoldersHash = null;

async function checkFoldersUpdate() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    // ★ cache: 'no-store' を追加（list_cards側と同様の理由）
    const session = getLoginSession();
    const res = await fetch(`${API_BASE}list_folders?guild_id=${GUILD_ID}`, {
      signal: controller.signal, cache: 'no-store',
      headers: session?.session_token ? { 'Authorization': 'Bearer ' + session.session_token } : {},
    });
    clearTimeout(timer);
    const txt = await res.text();
    const hash = await digestMessage(txt);

    if (lastFoldersHash === null) { lastFoldersHash = hash; return; }
    if (hash === lastFoldersHash) return;
    lastFoldersHash = hash;

    await fetchAndMergeFolders();

    const activeScreen = document.querySelector('.screen.active')?.id;
    if (activeScreen === 'screen-list') {
      renderDeckListUI();
    }
  } catch(e) {}
}

// ★ 通常はSSEで即時反映される。これは接続が切れた場合の保険（10秒間隔）
setInterval(checkFoldersUpdate, 10000);

// ===== JSON変更監視（共有の並び順 list_order.json） =====
let lastOrderHash = null;

async function checkOrderUpdate() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const session = getLoginSession();
    const res = await fetch(`${API_BASE}list_order?guild_id=${GUILD_ID}`, {
      signal: controller.signal, cache: 'no-store',
      headers: session?.session_token ? { 'Authorization': 'Bearer ' + session.session_token } : {},
    });
    clearTimeout(timer);
    const txt = await res.text();
    const hash = await digestMessage(txt);

    if (lastOrderHash === null) { lastOrderHash = hash; return; }
    if (hash === lastOrderHash) return;
    lastOrderHash = hash;

    await fetchAndMergeOrder();

    const activeScreen = document.querySelector('.screen.active')?.id;
    if (activeScreen === 'screen-list') {
      renderDeckListUI();
    }
  } catch(e) {}
}

// ★ 通常はSSEで即時反映される。これは接続が切れた場合の保険（10秒間隔）
setInterval(checkOrderUpdate, 10000);

// ===== わからないマーク／続きから／完了記録（study_data）の他端末での変更を反映 =====
//   ★ list_order等と違って全ユーザー共通の1ファイルではなく生徒ごとのデータなので、
//     ハッシュ比較はせず、一覧画面を見ているときだけ一定間隔で取得し直す
//     （他端末でわからないマークを付けた／続きから再開した直後にも反映されるように）。
async function checkStudyDataUpdate() {
  const activeScreen = document.querySelector('.screen.active')?.id;
  if (activeScreen !== 'screen-list') return; // 一覧画面を見ているときだけでよい
  try {
    const changed = await fetchAndMergeStudyData();
    if (changed && document.querySelector('.screen.active')?.id === 'screen-list') {
      renderDeckListUI();
    }
  } catch (e) {}
}

// 15秒ごとにチェック
setInterval(checkStudyDataUpdate, 15000);

// ★ ここまでエラーなく実行できた＝JSが生きている合図として、<body>先頭の
//   「読み込み中…」代替表示（js-fail-fallback、Icons.js参照）を消す。
hideLoadingFallback();
