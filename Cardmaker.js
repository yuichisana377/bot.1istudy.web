// ============================================================
//  Cardmaker.js — CardMaker専用スクリプト
//  Cardmaker.html から読み込む
// ============================================================

const API_BASE = "https://python-bot-1istudy.onrender.com/";
const GUILD_ID = "1509880344806162544";
const LOGIN_PATH = '/Login.html'; // ★ ログインページのパス（Login.jsのREDIRECT_PATHと同じ基準）

const STORE_KEY = 'cardmaker_decks_v1';
function loadDecks() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; } }
function saveDecks(d) { localStorage.setItem(STORE_KEY, JSON.stringify(d)); }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

// ── フォルダ（最大3階層・みんなで共有） ──
// フォルダの本体はサーバー（GitHub上の folders.json）に保存され、全員で共有される。
// ローカルのキャッシュは「サーバーから取得できるまでの間、即座に表示するため」だけに使う。
const FOLDER_CACHE_KEY = 'cardmaker_folders_cache_v1';
function loadFoldersCache() { try { return JSON.parse(localStorage.getItem(FOLDER_CACHE_KEY)) || []; } catch { return []; } }
function saveFoldersCache(f) { localStorage.setItem(FOLDER_CACHE_KEY, JSON.stringify(f)); }
const MAX_FOLDER_DEPTH = 3;

let folders = loadFoldersCache(); // { id, name, parentId }
let currentFolderId = null; // null = ルート

// ── 一覧（ホーム画面）の並び順 ──────────────
//   フォルダ・公開済みデッキの並び順は、サーバー（GitHub上の list_order.json）に
//   保存され全員で共有される。folders.json と同じく「サーバーが正で、ローカルの
//   キャッシュは届くまでの間だけ即座に表示するために使う」という考え方。
//   ─ 一方、未公開（自分だけの下書き）デッキは他人からは見えないデータなので、
//     その並び順はサーバーへは送らず、この端末だけのローカル保存にとどめる。
const LIST_ORDER_KEY = 'cardmaker_list_order_v1';                 // この端末で最終的に表示する並び順（共有分＋自分の下書き分）
const SHARED_ORDER_CACHE_KEY = 'cardmaker_shared_order_cache_v1'; // サーバーから取得した「みんなの並び順」のキャッシュ
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

// ★ サーバーから「みんなの並び順」を取得してキャッシュに反映する
async function fetchAndMergeOrder() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const res = await fetch(`${API_BASE}list_order`, { signal: controller.signal, cache: 'no-store' });
  clearTimeout(timer);
  const data = await res.json();
  if (!data.ok) return false;
  sharedOrderCache = data.order || {};
  saveSharedOrderCache(sharedOrderCache);
  return true;
}

// ★ この端末でドラッグして決めた並び順のうち「みんなで共有される部分」だけを
//   サーバーへ反映する（自分だけの下書きデッキの並びは送らない）。
async function pushSharedOrderToServer(folderId, keys) {
  const sharedKeys = keys.filter(isSharedOrderKey);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${API_BASE}save_order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: orderScopeKey(folderId), keys: sharedKeys }),
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
  const res = await fetch(`${API_BASE}list_folders`, { signal: controller.signal, cache: 'no-store' });
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
  const descIds = folderDescendants(folderId).map(f => f.id);
  if (newParentId && descIds.includes(newParentId)) return false;
  const oldLevel = folderLevel(folderId);
  const newLevel = folderLevel(newParentId) + 1;
  const shift = newLevel - oldLevel;
  return (maxLevelInSubtree(folderId) + shift) <= MAX_FOLDER_DEPTH;
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

// ── ログインセッション（Login.js と共通） ──────
const SESSION_KEY = 'sl_session';
function getLoginSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

let decks = loadDecks();
let currentDeckId  = null;
let menuTargetId   = null;
let imgBuf = { q:[], a:[], e:[] };
let studyCards = [], studyIdx = 0;
let studyReverse = false; // ★ 追加：問題と解答を逆にするモードかどうか
let studyMode = 'all'; // ★ 追加：'all' | 'unsure'（続きから再開時に同じ絞り込みを再現するため）

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

  const grid  = document.getElementById('deck-grid');
  const empty = document.getElementById('deck-list-empty');

  const childFolders = folderChildren(currentFolderId);
  const childDecks   = decks.filter(d => (d.folderId || null) === currentFolderId);

  if (!childFolders.length && !childDecks.length) {
    grid.style.display='none'; empty.style.display='block';
    document.getElementById('deck-list-empty-text').textContent =
      currentFolderId ? 'このフォルダにはまだ何もありません' : 'まだデッキがありません';
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
    ? `<span class="unsure-badge">🔖 ${unsureCount}</span>` : '';
  return { key: `folder:${f.id}`, html: `
  <div class="deck-card folder-card" data-key="folder:${f.id}" onclick="openFolder('${f.id}')">
    <div class="deck-card-info">
      <div class="deck-card-title">📁 ${esc(f.name)}</div>
      <div class="deck-card-meta">${cnt} デッキ・${totalCards} 問${folderUnsureBadge}</div>
    </div>
    <div class="deck-card-actions">
      <button class="btn btn-blue btn-sm" onclick="event.stopPropagation();openFolderPlayMode('${f.id}')"
        ${folderPlayDisabled?'disabled':''}>${isLoadingThisFolder ? '読み込み中…' : '▶ プレイ'}</button>
      <button class="icon-btn" onclick="event.stopPropagation();openFolderMenu('${f.id}')" title="メニュー">✏️</button>
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
      unsureBadge = unsureCount > 0 ? `<span class="unsure-badge">🔖 ${unsureCount}</span>` : '';
    }
    // ★ 問題数は常にサーバー側の count（軽量メタ情報）を優先して表示する。
    //   d.cards はカード本体が未読み込みの間は空配列なので、そちらを見てはいけない。
    //   （pubBadge の判定でも使うため、先に計算しておく）
    const questionCount = d.filename ? (d.count ?? d.cards.length) : d.cards.length;
    // ★ 公開状態バッジ：作成中／非公開／公開済み／未完成 のいずれか1つだけを表示する。
    //   （以前は「公開済み」と「未完成」を別々のバッジとして両方表示していたが、
    //   分かりにくいので同じ場所に1つだけ出すよう統合した）
    //   ★ 追加：
    //   ・まだ公開していないデッキ（filenameなし）のうち、作成時に「公開予定」を
    //     選んだもの（d.planPublish が false 以外＝未設定の既存デッキも含めてデフォルトtrue扱い）は
    //     「作成中」バッジを出す（この端末だけの表示。サーバーへの登録に失敗した場合など）。
    //   ・サーバーには既に登録済み（filenameあり）だが、まだカードが1枚も無く「未完成」
    //     フラグが立っている＝作成ボタンを押した直後でまだ内容を作っている最中のデッキも
    //     同じく「作成中」として扱い、他の人の一覧にも同じバッジで表示させる。
    const pubBadge = !d.filename
      ? (d.planPublish !== false
          ? `<span class="pub-badge inprogress">🟠 作成中</span>`
          : `<span class="pub-badge local">🔴 非公開</span>`)
      : (d.incomplete && questionCount === 0)
        ? `<span class="pub-badge inprogress">🟠 作成中${d.published_by ? `（${esc(d.published_by)}）` : ''}</span>`
        : d.incomplete
          ? `<span class="pub-badge draft">🟡 未完成${d.published_by ? `（${esc(d.published_by)}）` : ''}</span>`
          : `<span class="pub-badge published">🔵 公開済み${d.published_by ? `（${esc(d.published_by)}）` : ''}</span>`;
    // ★ カード本体が未読み込みの間、プレイ／編集ボタンを押した瞬間に
    //   ネットワーク取得が走ることをユーザーに知らせるためのローディング表示。
    const isLoadingThis = loadingDeckIds.has(d.id);
    const playDisabled = questionCount === 0 || isLoadingThis;
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
    return { key: orderKey, html: `
    <div class="deck-card" data-key="${orderKey}">
      <div class="deck-card-info">
        ${subjectLabel}
        <div class="deck-card-title">${esc(displayName)}</div>
        <div class="deck-card-meta">
          ${questionCount} 問
          ${pubBadge}
          ${unsureBadge}
        </div>
      </div>
      <div class="deck-card-actions">
        <button class="btn btn-blue btn-sm" onclick="openPlayMode('${d.id}')"
          ${playDisabled?'disabled':''}>${isLoadingThis ? '読み込み中…' : '▶ プレイ'}</button>
        <button class="icon-btn" onclick="openDeckMenu('${d.id}')" title="メニュー" ${isLoadingThis?'disabled':''}>✏️</button>
      </div>
    </div>` };
  });

  // ★ フォルダ・デッキを合わせ、保存済みの並び順（ユーザーがドラッグして決めた順）があれば適用する
  const combinedItems = applySavedListOrder([...folderItems, ...deckItems], currentFolderId);
  grid.innerHTML = combinedItems.map(it => it.html).join('');
}

// ── パンくずリスト ────────────────────
function renderBreadcrumb() {
  const bar = document.getElementById('folder-breadcrumb');
  if (!currentFolderId) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  const chain = [];
  let cur = folders.find(f => f.id === currentFolderId);
  while (cur) { chain.unshift(cur); cur = folders.find(f => f.id === cur.parentId); }
  bar.style.display = 'flex';
  bar.innerHTML = `<span class="crumb" onclick="openFolder(null)">🏠 ホーム</span>` +
    chain.map(f => `<span class="crumb-sep">/</span><span class="crumb" onclick="openFolder('${f.id}')">${esc(f.name)}</span>`).join('');
}

// ── プレイ中（続きから再開できる）デッキ・フォルダ ────────────────────
//   ★ 追加：localStorage に保存されている学習進捗（cm_progress_deck_ / cm_progress_folder_）を
//     すべて拾い出し、まだ存在するデッキ・フォルダに紐づくものだけを表示する。
//   scopeFolderId: 表示範囲。null ならホーム（アプリ全体）、フォルダidならそのフォルダ配下（サブフォルダ含む）のみ。
function getInProgressItems(scopeFolderId) {
  const items = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    let isFolder, id;
    if (key.startsWith('cm_progress_deck_'))        { isFolder = false; id = key.slice('cm_progress_deck_'.length); }
    else if (key.startsWith('cm_progress_folder_'))  { isFolder = true;  id = key.slice('cm_progress_folder_'.length); }
    else continue;

    const data = loadStudyProgress(isFolder, id);
    if (!data) continue; // 壊れている・空のデータは無視

    if (isFolder) {
      const folder = folders.find(f => f.id === id);
      if (!folder) continue; // フォルダが削除済みなら無視
      if (!isFolderInFolderScope(id, scopeFolderId)) continue; // ★ 表示範囲外なら除外
      items.push({ isFolder: true, id, name: folder.name, subject: '', icon: '📁',
        idx: data.idx, total: data.order.length, updatedAt: data.updatedAt || 0 });
    } else {
      const deck = decks.find(d => d.id === id);
      if (!deck) continue; // デッキが削除済みなら無視
      if (!isDeckInFolderScope(id, scopeFolderId)) continue; // ★ 表示範囲外なら除外
      // ★ デッキ一覧のカードと同じく、科目名をタイトルの上に分けて表示する
      const displayName = (deck.subject && deck.name.startsWith(deck.subject + ' '))
        ? deck.name.slice(deck.subject.length + 1) : deck.name;
      items.push({ isFolder: false, id, name: displayName, subject: deck.subject || '', icon: '📇',
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
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    let isFolder, id;
    if (key.startsWith('cm_completed_deck_'))        { isFolder = false; id = key.slice('cm_completed_deck_'.length); }
    else if (key.startsWith('cm_completed_folder_'))  { isFolder = true;  id = key.slice('cm_completed_folder_'.length); }
    else continue;

    const data = loadCompletionRecord(isFolder, id);
    if (!data) continue; // 壊れている・空のデータは無視

    if (isFolder) {
      const folder = folders.find(f => f.id === id);
      if (!folder) continue; // フォルダが削除済みなら無視
      if (!isFolderInFolderScope(id, scopeFolderId)) continue; // ★ 表示範囲外なら除外
      items.push({ isFolder: true, id, name: folder.name, subject: '', icon: '📁',
        total: data.total, completedAt: data.completedAt });
    } else {
      const deck = decks.find(d => d.id === id);
      if (!deck) continue; // デッキが削除済みなら無視
      if (!isDeckInFolderScope(id, scopeFolderId)) continue; // ★ 表示範囲外なら除外
      // ★ デッキ一覧のカードと同じく、科目名をタイトルの上に分けて表示する
      const displayName = (deck.subject && deck.name.startsWith(deck.subject + ' '))
        ? deck.name.slice(deck.subject.length + 1) : deck.name;
      items.push({ isFolder: false, id, name: displayName, subject: deck.subject || '', icon: '📇',
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
      <div class="completed-meta">✅ ${it.total} 問 完了</div>
      <div class="completed-replay-btn">🔁 もう一度プレイ</div>
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
    name,
    parent_id: folderNameMode === 'rename' ? (targetFolder ? targetFolder.parentId : null) : currentFolderId,
  };
  if (folderNameMode === 'rename') body.id = folderNameTargetId;

  if (btn) btn.disabled = true;
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
    if (btn) btn.disabled = false;
  }
}

// ── フォルダメニュー ───────────────────
let folderMenuTargetId = null;
function openFolderMenu(id) {
  folderMenuTargetId = id;
  const f = folders.find(x => x.id === id);
  document.getElementById('folder-menu-name').textContent = f ? f.name : '';
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

  // 公開済みデッキはサーバー側からも削除
  for (const d of targetDecks) {
    if (d.filename) {
      try {
        await fetch(`${API_BASE}delete_cards`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: d.filename }),
        });
      } catch(e) {}
    }
  }

  // フォルダ自体もサーバー（みんなで共有）から削除
  try {
    const res = await fetch(`${API_BASE}delete_folder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: folder.id }), signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '不明なエラー');
  } catch(e) {
    await showCmAlert({ title: 'サーバーからのフォルダ削除に失敗しました', desc: e.message });
    return;
  }

  const removeIds = new Set(targetDecks.map(d => d.id));
  decks = decks.filter(d => !removeIds.has(d.id));
  if (allFolderIds.includes(currentFolderId)) currentFolderId = folder.parentId || null;
  saveDecks(decks);
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

  const rows = [];
  const rootDisabled = movePickerKind === 'folder' && !canMoveFolderTo(movePickerTargetId, null);
  rows.push({ id: null, label: '🏠 ルート', level: 0, disabled: rootDisabled });

  function walk(parentId, level) {
    folderChildren(parentId).forEach(f => {
      const disabled = movePickerKind === 'folder' && !canMoveFolderTo(movePickerTargetId, f.id);
      rows.push({ id: f.id, label: '📁 ' + f.name, level, disabled });
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
    return `<div class="${cls}" style="padding-left:${8 + r.level * 18}px"${clickAttr}>${esc(r.label)}${isCurrent ? ' <span class="move-picker-current-tag">現在</span>' : ''}</div>`;
  }).join('');
}

async function selectMoveTarget(targetId) {
  closeModal('modal-move-picker');

  if (movePickerKind === 'deck') {
    const d = decks.find(x => x.id === movePickerTargetId);
    if (!d) return;

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
      const ok = await syncDeckToServer(d);
      if (!ok) showBanner('⚠ サーバーへの移動の反映に失敗しました（ローカルには保存済み）', '#fffbeb', '#92400e');
    }
    return;
  }

  // フォルダの移動（みんなで共有）
  const f = folders.find(x => x.id === movePickerTargetId);
  if (!f || !canMoveFolderTo(f.id, targetId)) return;
  try {
    const res = await fetch(`${API_BASE}save_folder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: f.id, name: f.name, parent_id: targetId }),
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
  const res  = await fetch(`${API_BASE}list_cards`, { signal: controller.signal, cache: 'no-store' });
  clearTimeout(timer);
  const txt = await res.text();
  const data = JSON.parse(txt);
  if (!data.ok) return { changed: false, txt };
  const fetched = data.sets.map(s => {
    const existing = decks.find(d => d.filename === s.filename);
    // ★ この端末で既にカード本体を読み込み済みなら、それを引き継いで再取得を省く。
    //   未読み込みなら空配列のままにし、開いたときに取得する。
    const keepLoadedCards = existing && existing.cardsLoaded;
    return {
      id: existing ? existing.id : genId(),
      name: s.name,
      cards: keepLoadedCards ? existing.cards : [],
      cardsLoaded: !!keepLoadedCards,
      filename: s.filename,
      count: s.count,
      subject: s.subject || (existing && existing.subject) || null,
      published_by: s.published_by || (existing && existing.published_by) || null,
      // ★ 未完成フラグはサーバー側の索引（list_cards）にも保存されるようになったため、
      //   他人の端末でも同じ表示になるようサーバー値を信頼する。
      incomplete: !!s.incomplete,
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
async function ensureDeckCardsLoaded(deckId, force = false) {
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return { ok: false, reason: 'not_found' };
  if (!deck.filename) { deck.cardsLoaded = true; return { ok: true }; }
  if (deck.cardsLoaded && !force) return { ok: true };

  // ★ 直前まで一覧（list_cardsのメタ情報）で分かっていた問題数を控えておく。
  //   これと比べて、実際に取得できたカード数が不自然に少なければ
  //   「サーバーはok:trueを返したが、実は異常な状態だった」とみなして
  //   失敗扱いにする（＝空データでdeck.cardsを上書きしない）ための安全策。
  const expectedCount = typeof deck.count === 'number' ? deck.count : null;

  loadingDeckIds.add(deckId);
  if (document.querySelector('.screen.active')?.id === 'screen-list') renderDeckListUI();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    // ★ cache: 'no-store' を追加：公開直後のカード内容が古いキャッシュのまま
    //   返ってこないようにするため。
    const res = await fetch(`${API_BASE}get_card_set?filename=${encodeURIComponent(deck.filename)}`, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '不明なエラー');
    const fetchedCards = data.cards || [];

    // ★ 安全策：サーバーが ok:true を返していても、直前まで分かっていた問題数が
    //   1件以上あったのに、取得できたカードが0件の場合は、通信は成功していても
    //   内容としては信用できないので「失敗」として扱う。
    //   これにより、編集画面が空の状態で開いてしまい、そのまま公開して
    //   サーバー側の本物のカードを空データで上書きしてしまう事故を防ぐ。
    if (expectedCount !== null && expectedCount > 0 && fetchedCards.length === 0) {
      console.warn(`[cardmaker] get_card_set が0件を返しましたが、一覧では${expectedCount}件のはずです。 filename=${deck.filename}`);
      return { ok: false, reason: 'mismatch', expectedCount, fetchedCount: 0 };
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
          { icon: '🔄', label: 'もう一度試す', sub: 'まずはこちらをおすすめします', value: 'retry' },
          { icon: '⚠️', label: '空のまま開く（上級者向け）', sub: '保存すると中身が消える可能性があります', value: 'force' },
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
    await Promise.all([fetchAndMergeDecks(), fetchAndMergeFolders(), fetchAndMergeOrder()]);
    renderDeckListUI();
  } catch(e) {}
}

// ── デッキメニュー ─────────────────────
function openDeckMenu(id) {
  menuTargetId = id;
  const deck = decks.find(d => d.id === id);
  document.getElementById('menu-deck-name').textContent = deck.name;
  document.getElementById('menu-unpublish-item').style.display = deck.filename ? '' : 'none';
  openModal('modal-deck-menu');
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
      body: JSON.stringify({ filename: deck.filename }), signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '削除失敗');
    deck.filename = null; deck.count = undefined; deck.published_by = null; deck.incomplete = false;
    deck.planPublish = false; // ★ 追加：明示的に非公開へ戻した場合は「作成中」ではなく「非公開」表示にする
    saveDecks(decks); renderDeckListUI();
    showBanner('🔴 非公開に戻しました', '#f1f5f9', '#334155');
  } catch(e) {
    await showCmAlert({ title: 'GitHubからの削除に失敗しました', desc: e.message });
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
      await fetch(`${API_BASE}delete_cards`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: deck.filename }),
      });
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
      data.channels.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  } catch(e) {
    sel.innerHTML = '<option value="">（科目を取得できませんでした）</option>';
  }
}

async function startEdit() {
  const subject = document.getElementById('new-subject').value;
  const input   = document.getElementById('new-set-name').value.trim();
  if (!input) { shake('new-set-name'); return; }
  if (await warnIfBugChars(input, 'new-set-name')) return;
  const name = subject ? `${subject} ${input}` : input;
  // ★ 追加：このデッキを公開予定として作成するかどうか（デフォルトtrue＝公開予定）
  const planPublish = document.getElementById('new-plan-publish').checked;
  const deck = { id: genId(), name, subject, cards: [], cardsLoaded: true, folderId: currentFolderId, planPublish };
  decks.push(deck); saveDecks(decks);
  // ★ 追加：公開予定なら、この時点（作成ボタンを押した直後）でサーバーにも
  //   「まだ中身は空・作成中」として登録し、他の人の一覧にもすぐ表示されるようにする。
  //   （失敗しても致命的ではないので、その場合はこれまで通りこの端末だけの
  //     下書きとして続行する＝一覧のバッジは「作成中」のまま変わらない）
  if (planPublish) {
    await announceNewDeckToServer(deck.id);
  }
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
    const cards = deck.cards.map(c => ({
      id: c.id, question: c.question, answer: c.answer, explanation: c.explanation || '',
      imgs_q: c.imgs_q || [], imgs_a: c.imgs_a || [], imgs_e: c.imgs_e || [],
    }));
    const res = await fetch(`${API_BASE}save_cards`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: deck.name,
        cards,
        guild_id: GUILD_ID,
        subject: deck.subject || null,
        folder_id: deck.folderId || null,
        publisher_id: session ? session.student_id : null,
        publisher_nickname: session ? session.nickname : '匿名',
        silent: true,      // ★ 作成しただけなのでDiscord通知はしない
        incomplete: true,  // ★ まだ「保存して公開」を経ていないので「未完成（作成中）」扱いにする
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
  const ok = await loadDeckCardsWithRecovery(deckId);
  if (!ok) return; // ユーザーが「やめる」を選んだ場合は編集画面を開かない

  document.getElementById('edit-deck-title').textContent = deck.name;
  // ★ 公開済みデッキは「保存」（ローカルのみ）ボタンを隠し、「保存して公開」だけにする
  document.getElementById('btn-save-local').style.display = deck.filename ? 'none' : '';
  document.getElementById('btn-done').textContent = deck.filename ? '公開して保存' : '保存して公開';
  clearEditor(); renderCreatedList(); showScreen('edit');
  setTimeout(() => document.getElementById('ta-q').focus(), 200);
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
}

async function saveCard(mode) {
  const q = document.getElementById('ta-q').value.trim();
  const a = document.getElementById('ta-a').value.trim();
  const e = document.getElementById('ta-e').value.trim();
  const deck = decks.find(d => d.id === currentDeckId);
  if (q || a) {
    if (!q || !a) { shake(!q ? 'ta-q' : 'ta-a'); return; }
    if (await warnIfBugChars(q, 'ta-q')) return;
    if (await warnIfBugChars(a, 'ta-a')) return;
    if (await warnIfBugChars(e, 'ta-e')) return;
    deck.cards.push({ id:genId(), question:q, answer:a,
      explanation: e,
      imgs_q:[...imgBuf.q], imgs_a:[...imgBuf.a], imgs_e:[...imgBuf.e] });
    saveDecks(decks);
    document.getElementById('edit-counter').textContent = deck.cards.length + '枚';
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
        { icon: '✅', label: '完成として公開する',   sub: '通知が送信されます',   value: 'complete' },
        { icon: '🟡', label: '未完成として公開する', sub: '通知は送信されません', value: 'draft' },
      ],
    });
    if (!choice) return; // キャンセル
    // ★ deck.id だけを渡し、publishDeck 側で常に最新のdecks配列から探し直す
    //   （画面遷移で decks 配列が入れ替わっても更新が失われないようにするため）
    publishDeck(deck.id, choice === 'complete');
  } else if (mode === 'local') {
    saveDecks(decks); showScreen('list');
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
  const cards = deck.cards.map(c => ({
    id: c.id, // サーバーが対応していれば id を保持したまま返してもらうため付与
    question: c.question, answer: c.answer, explanation: c.explanation || '',
    imgs_q: c.imgs_q || [], imgs_a: c.imgs_a || [], imgs_e: c.imgs_e || [], // ★ 画像も公開する
  }));
  const body = {
    name: deck.name,
    cards,
    guild_id: GUILD_ID,
    subject: deck.subject || null,                       // ★ 科目ごとのチャンネル振り分け用
    folder_id: deck.folderId || null,                     // ★ フォルダ所属（みんなで共有）
    publisher_id: session ? session.student_id : null,     // ★ 公開者の学籍番号
    publisher_nickname: session ? session.nickname : '匿名', // ★ 公開者のニックネーム
    silent: !isComplete, // ★ 未完成として公開する場合は通知しない
    incomplete: !isComplete, // ★ 未完成フラグをサーバーに保存し、他の人の端末にも表示させる
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
      saveDecks(decks);
    }
    renderDeckListUI();
    showBanner(
      isComplete ? '✓ 保存して公開しました！' : '🟡 未完成として公開しました（通知なし）',
      isComplete ? '#dcfce7' : '#fef9c3',
      isComplete ? '#166534' : '#854d0e'
    );
  } catch(e) {
    showBanner('💾 ローカルに保存しました（GitHub同期失敗）', '#fffbeb', '#92400e');
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
//  ★ 追加：作成済みカードのドラッグ並び替え（Pointer Events）
//  ─────────────────────────────────────────────
//  ・マウス／タッチの両方を同じコードで扱える Pointer Events API を使用。
//    HTML5標準のdraggable属性はスマホでの挙動が不安定なため使わない。
//  ・renderCreatedList() は編集のたびに #created-list の中身を毎回
//    innerHTML で丸ごと再生成するので、各アイテムに直接リスナーを付けるのではなく
//    #created-list 自体に1回だけイベント委任（delegation）で登録する。
//  ・ドラッグ中はDOM上の要素を直接入れ替えて視覚的な並び替えを行い、
//    指を離した瞬間に「今のDOM上の並び順（data-key）」を読み取って
//    deck.cards を実際に並び替える。カードの内容そのものはcardKeyで
//    引き当てるので、インデックスのズレによる事故が起きない。
// ============================================================
(function setupCardDragReorder() {
  const list = document.getElementById('created-list');
  if (!list) return;

  let dragEl = null;
  let startY = 0;
  // ★ 追加：ドラッグ中の「指」を識別するID。
  //   これにより、ハンドルを掴んでいる指の動きだけをドラッグとして扱い、
  //   もう片方の指の動きはブラウザ標準のスクロールとして自由に使えるようにする。
  let dragTouchId = null;

  // ★ 追加：ドラッグ中に画面端（上下）に近づいたら自動スクロールするための状態。
  const scrollContainer = document.getElementById('edit-scroll');
  let lastClientY = 0;
  let autoScrollRAF = null;

  function getItems() {
    return Array.from(list.querySelectorAll('.created-item'));
  }

  // ★ 追加：ドラッグ中、指（またはマウス）が edit-scroll の上端／下端付近に
  //   あるあいだ、毎フレーム少しずつスクロールさせる。
  //   端に近いほど速くスクロールする（ratioで速度を調整）。
  //   スクロールした分だけ startY をずらし、指の位置に対するカードの
  //   見た目の位置（translateY）がズレないようにする。
  function autoScrollTick() {
    if (!dragEl || !scrollContainer) { autoScrollRAF = null; return; }
    const rect = scrollContainer.getBoundingClientRect();
    const edge = 60;      // 端から何pxでスクロールを開始するか
    const maxSpeed = 14;  // 1フレームあたりの最大スクロール量(px)
    let speed = 0;

    if (lastClientY < rect.top + edge) {
      const ratio = Math.min(1, (rect.top + edge - lastClientY) / edge);
      speed = -maxSpeed * ratio;
    } else if (lastClientY > rect.bottom - edge) {
      const ratio = Math.min(1, (lastClientY - (rect.bottom - edge)) / edge);
      speed = maxSpeed * ratio;
    }

    if (speed !== 0) {
      const before = scrollContainer.scrollTop;
      scrollContainer.scrollTop += speed;
      const actualDelta = scrollContainer.scrollTop - before; // 端まで来ていたらここが0になる
      if (actualDelta !== 0) {
        startY -= actualDelta;
        moveDrag(lastClientY);
      }
    }
    autoScrollRAF = requestAnimationFrame(autoScrollTick);
  }

  function beginDrag(item, clientY) {
    dragEl = item;
    startY = clientY;
    lastClientY = clientY;
    dragEl.classList.add('dragging');
    dragEl.style.position = 'relative';
    dragEl.style.zIndex = '10';
    dragEl.style.boxShadow = '0 4px 14px rgba(0,0,0,0.18)';
    dragEl.style.opacity = '0.92';
    if (autoScrollRAF === null) autoScrollRAF = requestAnimationFrame(autoScrollTick);
  }

  function moveDrag(clientY) {
    if (!dragEl) return;
    lastClientY = clientY;
    const dy = clientY - startY;
    dragEl.style.transform = `translateY(${dy}px)`;

    const dragRect = dragEl.getBoundingClientRect();
    const dragCenter = dragRect.top + dragRect.height / 2;

    const items = getItems();
    for (const other of items) {
      if (other === dragEl) continue;
      const r = other.getBoundingClientRect();
      const otherCenter = r.top + r.height / 2;
      const otherIsAfter = !!(dragEl.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING);

      if (otherIsAfter && dragCenter > otherCenter) {
        list.insertBefore(dragEl, other.nextSibling);
        // ★ 入れ替えのたびに基準点をリセットして、以降のtranslateYが
        //   新しい位置からの相対移動になるようにする（ジャンプを最小限にする）
        startY = clientY;
        dragEl.style.transform = 'translateY(0px)';
        break;
      } else if (!otherIsAfter && dragCenter < otherCenter) {
        list.insertBefore(dragEl, other);
        startY = clientY;
        dragEl.style.transform = 'translateY(0px)';
        break;
      }
    }
  }

  async function endDrag() {
    if (!dragEl) return;
    if (autoScrollRAF !== null) { cancelAnimationFrame(autoScrollRAF); autoScrollRAF = null; }
    dragEl.classList.remove('dragging');
    dragEl.style.transform = '';
    dragEl.style.zIndex = '';
    dragEl.style.boxShadow = '';
    dragEl.style.opacity = '';
    dragEl.style.position = '';
    dragEl = null;

    // ★ DOM上の最終的な並び順（data-key）から deck.cards を並び替える
    const orderedKeys = getItems().map(it => it.dataset.key);
    const deck = decks.find(d => d.id === currentDeckId);
    if (!deck) return;
    const byKey = new Map(deck.cards.map(c => [cardKey(c), c]));
    const newCards = orderedKeys.map(k => byKey.get(k)).filter(Boolean);
    if (newCards.length !== deck.cards.length) { renderCreatedList(); return; } // 念のための整合性チェック
    deck.cards = newCards;
    saveDecks(decks);
    renderCreatedList();

    // ★ 公開済みなら並び順もサーバーへ反映する（通知はしない）
    if (deck.filename) {
      const ok = await syncDeckToServer(deck);
      if (!ok) showBanner('⚠ 並び替えのサーバー反映に失敗しました（ローカルには保存済み）', '#fffbeb', '#92400e');
    }
  }

  // ── マウス操作（PC） ──
  function onMouseDown(e) {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const item = handle.closest('.created-item');
    if (!item) return;
    e.preventDefault();
    beginDrag(item, e.clientY);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp, { once: true });
  }
  function onMouseMove(e) { moveDrag(e.clientY); }
  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove);
    endDrag();
  }

  // ── タッチ操作（スマホ） ──
  // ★ ハンドルに触れた指の identifier だけを追跡し、その指のtouchmoveだけを
  //   ドラッグ処理として扱う（＝preventDefaultする）。もう片方の指のtouchmoveは
  //   ここで何もしないので、ブラウザ標準の縦スクロールがそのまま働く。
  //   これにより「片方の指でカードを移動させながら、もう片方の指でスクロール」ができる。
  function onTouchStart(e) {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    if (dragTouchId !== null) return; // 既に別の指でドラッグ中なら何もしない
    const item = handle.closest('.created-item');
    if (!item) return;
    const touch = e.changedTouches[0];
    dragTouchId = touch.identifier;
    e.preventDefault();
    beginDrag(item, touch.clientY);
  }
  function findDragTouch(touchList) {
    if (dragTouchId === null) return null;
    for (let i = 0; i < touchList.length; i++) {
      if (touchList[i].identifier === dragTouchId) return touchList[i];
    }
    return null;
  }
  function onTouchMove(e) {
    const t = findDragTouch(e.changedTouches);
    if (!t) return; // ドラッグ中の指以外の動き（＝スクロール用の指）はここで無視する
    e.preventDefault();
    moveDrag(t.clientY);
  }
  function onTouchEnd(e) {
    const t = findDragTouch(e.changedTouches);
    if (!t) return;
    dragTouchId = null;
    endDrag();
  }

  list.addEventListener('mousedown', onMouseDown);
  list.addEventListener('touchstart', onTouchStart, { passive: false });
  list.addEventListener('touchmove',  onTouchMove,  { passive: false });
  list.addEventListener('touchend',   onTouchEnd);
  list.addEventListener('touchcancel', onTouchEnd);
})();

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
  let autoScrollRAF = null;
  let scrollParent = null;

  // ★ 修正：iOS Safariなどは touch-action の値を「タッチ開始(touchstart)時点」で
  //   確定してしまい、その後にJSから書き換えても無視される（＝長押し成立後の
  //   beginDrag()内でtouchActionを'none'にしても手遅れで、指を動かすと
  //   ネイティブスクロールが優先されてドラッグに追従できなくなる）。
  //   そのため、タッチ開始と同時に対象カードだけ touch-action:none にしておき、
  //   長押しが成立する前に指が動いた場合（＝本来スクロールしたかった場合）は
  //   ネイティブスクロールの代わりにJSで手動的にスクロールさせる。
  let touchActionItem = null;   // touch-actionをnoneにした対象（後で元に戻すため）
  let manualScrollActive = false;
  let manualScrollParent = null;
  let manualScrollLastY = 0;
  let manualScrollPointerId = null; // ★ cancelPress()でpressPointerIdがnullになった後も
                                     //   同じ指の動きを追跡し続けるための専用ID

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
    if (lastClientY < rect.top + edge) {
      speed = -maxSpeed * Math.min(1, (rect.top + edge - lastClientY) / edge);
    } else if (lastClientY > rect.bottom - edge) {
      speed = maxSpeed * Math.min(1, (lastClientY - (rect.bottom - edge)) / edge);
    }
    if (speed !== 0) {
      const before = scrollParent.scrollTop;
      scrollParent.scrollTop += speed;
      const actualDelta = scrollParent.scrollTop - before;
      if (actualDelta !== 0) { startY -= actualDelta; moveDrag(lastClientY); }
    }
    autoScrollRAF = requestAnimationFrame(autoScrollTick);
  }

  function beginDrag(item, clientY) {
    dragEl = item;
    cmListDragActive = true; // ★ ドラッグ中は renderDeckListUI() 側で再描画をスキップさせる
    startY = clientY;
    lastClientY = clientY;
    scrollParent = findScrollParent(grid);
    dragEl.classList.add('dragging');
    dragEl.style.position = 'relative';
    dragEl.style.zIndex = '10';
    dragEl.style.boxShadow = '0 6px 18px rgba(0,0,0,.20)';
    dragEl.style.opacity = '0.92';
    dragEl.style.touchAction = 'none';
    dragEl.style.transform = 'scale(1.02)';
    if (navigator.vibrate) navigator.vibrate(12); // ★ つかんだ瞬間に軽い振動でフィードバック（対応端末のみ）
    if (autoScrollRAF === null) autoScrollRAF = requestAnimationFrame(autoScrollTick);
  }

  function moveDrag(clientY) {
    if (!dragEl) return;
    lastClientY = clientY;
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
  }

  function endDrag() {
    if (!dragEl) return;
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
        if (!ok) showBanner('⚠ 並び替えのサーバー反映に失敗しました（この端末には保存済み）', '#fffbeb', '#92400e');
      });
    }

    // ★ 指を離した瞬間に発生するクリックで意図せずフォルダが開かないようにするガード
    cmDragJustEndedAt = Date.now();
  }

  function cancelPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    pressItem = null; pressPointerId = null;
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

    if (e.pointerType === 'touch') {
      // ★ 長押し成立を待たず、タッチ開始と同時にnoneにするのがポイント
      //   （後から変更しても効かないため）
      touchActionItem = item;
      touchActionItem.style.touchAction = 'none';
      manualScrollParent = findScrollParent(item);
      manualScrollLastY = e.clientY;
      manualScrollActive = false;
    }

    pressTimer = setTimeout(() => {
      pressTimer = null;
      if (!pressItem) return;
      try { pressItem.setPointerCapture(pressPointerId); } catch (_) {}
      beginDrag(pressItem, pressStartY);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e) {
    if (dragEl && e.pointerId === pressPointerId) {
      e.preventDefault();
      moveDrag(e.clientY);
      return;
    }
    // ★ 長押し判定キャンセル後も、cancelPress()でpressPointerIdはnullに
    //   なってしまうため、同じ指の手動スクロールは別IDで追跡を続ける。
    if (manualScrollActive && e.pointerId === manualScrollPointerId) {
      e.preventDefault();
      const delta = manualScrollLastY - e.clientY; // 指を上に動かした→下にスクロール
      if (manualScrollParent) manualScrollParent.scrollTop += delta;
      manualScrollLastY = e.clientY;
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
        if (e.pointerType === 'touch') {
          manualScrollPointerId = e.pointerId;
          manualScrollActive = true;
        }
        cancelPress();
      }
    }
  }

  function resetTouchAction() {
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
  return await loadDeckCardsWithRecovery(deckId);
}

async function openCardEditModal(idx) {
  const deck = decks.find(d => d.id === currentDeckId);
  if (!deck) return;
  const key = cardKey(deck.cards[idx]);

  const ok = await reloadCardBeforeEdit(deck.id);
  if (!ok) return; // ユーザーが読み込みを中止した

  const freshDeck = decks.find(d => d.id === currentDeckId);
  if (!freshDeck) return;
  renderCreatedList(); // ★ 読み込み直した最新の内容を一覧にも反映しておく
  const freshCard = freshDeck.cards.find(c => cardKey(c) === key);
  if (!freshCard) {
    // 読み込み直した結果、このカードが既に削除されていた場合
    await showCmAlert({ title: 'このカードは既に削除されています', desc: '最新の内容に更新しました。' });
    return;
  }
  openCardEditModalCommon(freshDeck.id, freshCard, 'editor');
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

function openCardEditModalCommon(deckId, c, context) {
  editingDeckId  = deckId;
  editingCardKey = cardKey(c);
  editingContext = context;
  document.getElementById('modal-edit-q').value = mathToPlainText(c.question);
  document.getElementById('modal-edit-a').value = mathToPlainText(c.answer);
  document.getElementById('modal-edit-e').value = mathToPlainText(c.explanation||'');
  ['modal-edit-q','modal-edit-a','modal-edit-e'].forEach(id => {
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

  document.getElementById('card-edit-ok').style.display  = 'none';
  document.getElementById('card-edit-err').style.display = 'none';
  openModal('modal-card-edit');
}

async function saveCardEdit() {
  const q = document.getElementById('modal-edit-q').value.trim();
  const a = document.getElementById('modal-edit-a').value.trim();
  const e = document.getElementById('modal-edit-e').value.trim();
  const errBar = document.getElementById('card-edit-err');
  if (!q || !a) {
    errBar.textContent = '✕ 問題文と解答は必須です';
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
  } else {
    renderCreatedList();
  }

  // ★ 公開済みならサーバー（GitHub）側にも反映する
  if (deck.filename) {
    const ok = await syncDeckToServer(deck);
    if (ok) {
      showBanner('💾 保存しました', '#dcfce7', '#166534');
    } else {
      showBanner('⚠ サーバーへの反映に失敗しました（ローカルには保存済み）', '#fffbeb', '#92400e');
    }
  } else {
    // 未公開デッキはローカル保存のみ
    showBanner('💾 保存しました（ローカル）', '#dcfce7', '#166534');
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
  document.getElementById('study-q-imgs').innerHTML = (qImgs||[]).map(s=>`<img src="${s}" alt="" onclick="openImgLightbox(this.src)">`).join('');
  setMathText(document.getElementById('study-a-text'), aText);
  document.getElementById('study-a-imgs').innerHTML = (aImgs||[]).map(s=>`<img src="${s}" alt="" onclick="openImgLightbox(this.src)">`).join('');
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
        `<option value="${c.name}"${c.name === currentSubject ? ' selected' : ''}>${c.name}</option>`
      ).join('');
  } catch(e) {
    sel.innerHTML = `<option value="${currentSubject}">${currentSubject || '（取得失敗）'}</option>`;
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
    const loaded = await loadDeckCardsWithRecovery(deck.id);
    if (!loaded) {
      showBanner('⚠ 名前の変更はローカルには反映されています（サーバーへの反映は未実施）', '#fffbeb', '#92400e');
      return;
    }
    const ok = await syncDeckToServer(deck);
    if (!ok) showBanner('⚠ サーバーへの名前変更の反映に失敗しました', '#fffbeb', '#92400e');
  }
}

// ★ 公開済みデッキの内容をサーバーに反映する共通処理（通知なし）
async function syncDeckToServer(deck) {
  try {
    const cards = deck.cards.map(c => ({
      id: c.id, question: c.question, answer: c.answer, explanation: c.explanation || '',
      imgs_q: c.imgs_q || [], imgs_a: c.imgs_a || [], imgs_e: c.imgs_e || [], // ★ 画像も同期する
    }));
    const session = getLoginSession();
    const res = await fetch(`${API_BASE}save_cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: deck.name,
        cards,
        filename: deck.filename,
        guild_id: GUILD_ID,
        subject: deck.subject || null,
        folder_id: deck.folderId || null, // ★ フォルダ所属（みんなで共有）
        publisher_id: session ? session.student_id : null,
        publisher_nickname: deck.published_by || (session ? session.nickname : '匿名'),
        silent: true, // ★ 通知しない
        incomplete: !!deck.incomplete, // ★ 未完成フラグを維持したままサーバーへ反映する
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

// ── 学習 ─────────────────────────────
function getUnsureSet(deckId) {
  try { const raw = localStorage.getItem('unsure_' + deckId); return new Set(raw ? JSON.parse(raw) : []); }
  catch { return new Set(); }
}
function saveUnsureSet(deckId, set) {
  localStorage.setItem('unsure_' + deckId, JSON.stringify([...set]));
}

// ★ 追加：学習の続きから再開するための進捗保存・読込・削除
//   ・デッキ / フォルダそれぞれ独立したキーで保存する
//   ・保存するのは「そのときのカードの並び順（キー配列）」「今何問目か」
//     「'all'/'unsure' のどちらのモードだったか」「反転モードだったか」
//     「シャッフル済みだったか」
//   ・カードの内容自体は保存しない（常に最新の decks から引き直すため、
//     編集や画像追加をしても続きから再開したときにズレない）
function progressKey(isFolder, id) {
  return (isFolder ? 'cm_progress_folder_' : 'cm_progress_deck_') + id;
}
function saveStudyProgress() {
  const id = studyIsFolder ? studyFolderId : studyDeckId;
  if (!id || !studyCards.length) return;
  const data = {
    order: studyCards.map(c => cardKey(c)),
    idx: studyIdx,
    mode: studyMode,
    reverse: studyReverse,
    shuffled: studyShuffled, // ★ 追加：シャッフル済みの並びかどうかを保存し、再開時に区別できるようにする
    updatedAt: Date.now(),
  };
  try { localStorage.setItem(progressKey(studyIsFolder, id), JSON.stringify(data)); } catch(e) {}
}
function loadStudyProgress(isFolder, id) {
  try {
    const data = JSON.parse(localStorage.getItem(progressKey(isFolder, id)));
    if (!data || !Array.isArray(data.order) || !data.order.length) return null;
    if (typeof data.idx !== 'number' || data.idx >= data.order.length) return null;
    return data;
  } catch(e) { return null; }
}
function clearStudyProgress(isFolder, id) {
  try { localStorage.removeItem(progressKey(isFolder, id)); } catch(e) {}
}

// ★ 追加：学習を最後まで終えた（完了した）記録の保存・読込
//   ・「プレイ中（続きから）」とは別のキーで、完了した日時と問題数だけを保存する
function completedKey(isFolder, id) {
  return (isFolder ? 'cm_completed_folder_' : 'cm_completed_deck_') + id;
}
function saveCompletionRecord(isFolder, id, total) {
  if (!id || !total) return;
  const data = { total, completedAt: Date.now() };
  try { localStorage.setItem(completedKey(isFolder, id), JSON.stringify(data)); } catch(e) {}
}
function loadCompletionRecord(isFolder, id) {
  try {
    const data = JSON.parse(localStorage.getItem(completedKey(isFolder, id)));
    if (!data || typeof data.completedAt !== 'number' || !data.total) return null;
    return data;
  } catch(e) { return null; }
}

let studyDeckId = null;
let studyShuffled = false;   // ★ 追加：現在シャッフル済みの並びで学習中かどうか（続きから再開時の表示・保存用）
let studyIsFolder = false;   // ★ 追加：フォルダ単位のプレイ中かどうか
let studyFolderId = null;    // ★ 追加：プレイ中のフォルダid
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
  const results = await Promise.all(targetDecks.map(d => ensureDeckCardsLoaded(d.id, true)));

  loadingFolderIds.delete(folderId);
  renderDeckListUI();

  if (results.some(r => !r.ok)) {
    await showCmAlert({ title: '読み込みに失敗しました', desc: '通信環境を確認してもう一度お試しください。' });
    return;
  }

  folderPlayDecks = targetDecks;
  studyIsFolder = true;
  studyFolderId = folderId;
  studyDeckId = null;

  document.getElementById('reverse-mode-checkbox').checked = false;
  document.getElementById('play-mode-deck-name').textContent = folder ? `📁 ${folder.name}` : 'フォルダ';

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

  openModal('modal-play-mode');
}
// ★ プレイ開始のたびに、必ずサーバーから最新のカードを取り直す（force=true）。
//   ─────────────────────────────────────────────
//   以前は cardsLoaded=true（一度読み込み済み）のデッキはキャッシュのまま
//   プレイ画面を開いていたため、他の人が先に修正していても気づけず、
//   「同じ間違いをまた編集してしまう」「もう直っていたのに気づかない」
//   といったすれ違いが起きやすかった。プレイのたびに読み込み直すことで、
//   誰かが編集した直後でも次にプレイした人にはほぼ即座に反映される。
async function openPlayMode(deckId) {
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return;
  studyIsFolder = false;
  studyDeckId = deckId;

  const result = await ensureDeckCardsLoaded(deckId, true);
  if (!result.ok) {
    await showCmAlert({ title: '読み込みに失敗しました', desc: '通信環境を確認してもう一度お試しください。' });
    return;
  }

  document.getElementById('reverse-mode-checkbox').checked = false; // ★ プレイモード選択のたびに未チェックへリセット
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

  // ★ 反転トグルを必ず見せるため、わからないカードの有無に関わらずモーダルを開く
  openModal('modal-play-mode');
}

function startStudyMode(mode) {
  studyReverse = document.getElementById('reverse-mode-checkbox').checked;
  closeModal('modal-play-mode');
  const progressId = studyIsFolder ? studyFolderId : studyDeckId;

  let title;

  if (mode === 'resume') {
    // ★ 保存された進捗（カードキーの並び順・位置・モード・反転設定・シャッフル済みか）を復元する。
    //   カード本体は常に最新の decks / folderPlayDecks から引き直すので、
    //   編集や画像追加が続きから再開に影響しない。
    const saved = loadStudyProgress(studyIsFolder, progressId);
    if (!saved) return; // 万が一データが消えていた場合は何もしない
    studyReverse = saved.reverse;
    studyMode = saved.mode || 'all';
    studyShuffled = !!saved.shuffled; // ★ シャッフル済みだったかどうかを復元（タイトル表示用）

    let pool;
    if (studyIsFolder) {
      pool = [];
      folderPlayDecks.forEach(d => d.cards.forEach(c => pool.push({ ...c, __deckId: d.id })));
      const folder = folders.find(f => f.id === studyFolderId);
      title = folder ? `📁 ${folder.name}` : 'フォルダ';
    } else {
      const deck = decks.find(d => d.id === studyDeckId);
      pool = deck ? [...deck.cards] : [];
      title = deck ? deck.name : '';
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
      title = folder ? `📁 ${folder.name}` : 'フォルダ';
    } else {
      const deck = decks.find(d => d.id === studyDeckId);
      if (mode === 'unsure') {
        const unsure = getUnsureSet(studyDeckId);
        studyCards = deck.cards.filter(c => unsure.has(cardKey(c)));
      } else {
        studyCards = [...deck.cards];
      }
      title = deck.name;
    }
    studyIdx = 0;
    // ★ 「すべて」「わからないだけ」を新しく選び直した場合は、
    //   古い「続きから」データを破棄する（そのまま残すと内容と矛盾するため）
    clearStudyProgress(studyIsFolder, progressId);
  }

  document.getElementById('study-title').textContent = title + (studyReverse ? ' 🔄' : '') + (studyShuffled ? ' 🔀' : '');
  document.getElementById('study-done-sub').textContent = `全 ${studyCards.length} 問完了！`;
  showScreen('study');
  document.getElementById('study-done').style.display    = 'none';
  document.getElementById('study-content').style.display = 'flex';
  renderStudyCard();
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

  // ★ 反転モードなら「問題」欄に解答、「解答」欄に問題文を出す（解説はそのまま解答側に表示）
  const qText = studyReverse ? c.answer   : c.question;
  const qImgs = studyReverse ? c.imgs_a   : c.imgs_q;
  const aText = studyReverse ? c.question : c.answer;
  const aImgs = studyReverse ? c.imgs_q   : c.imgs_a;

  setMathText(document.getElementById('study-q-text'), qText);
  document.getElementById('study-q-imgs').innerHTML = (qImgs||[]).map(s=>`<img src="${s}" alt="" onclick="openImgLightbox(this.src)">`).join('');
  // ★ フォルダをまとめてプレイしている場合、この問題がどのカードデッキ由来かを表示する
  const deckTag = document.getElementById('study-deck-tag');
  if (studyIsFolder) {
    const srcDeck = decks.find(d => d.id === c.__deckId);
    if (srcDeck) {
      deckTag.textContent = `📇 ${srcDeck.name}`;
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
  setMathText(document.getElementById('study-a-text'), aText);
  document.getElementById('study-a-imgs').innerHTML = (aImgs||[]).map(s=>`<img src="${s}" alt="" onclick="openImgLightbox(this.src)">`).join('');
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
  document.getElementById('study-next').textContent = studyIdx === studyCards.length-1 ? '完了 ✓' : '次へ →';
  updateUnsureBtn();
  saveStudyProgress(); // ★ カードを表示するたびに現在位置を保存し、次回「続きから」を出せるようにする
}

function revealAnswer() {
  document.getElementById('study-answer-panel').classList.add('show');
  document.getElementById('study-reveal-bar').style.display = 'none';
  document.getElementById('study-nav').style.display = '';
  updateUnsureBtn();
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

// ★ 修正：editCurrentStudyCard は重複定義されていたため削除。
//   実体は上（reloadCardBeforeEdit の近く）で定義したものを使う。
function studyMove(dir) { studyIdx += dir; renderStudyCard(); }

function shuffleStudy() {
  for (let i=studyCards.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [studyCards[i],studyCards[j]]=[studyCards[j],studyCards[i]];
  }
  studyIdx = 0;
  studyShuffled = true; // ★ 追加：シャッフル済み状態にする。以降の saveStudyProgress で保存され、
                        //   「続きから」で再開したときもこのシャッフル順のまま復元される。
  document.getElementById('study-title').textContent =
    document.getElementById('study-title').textContent.replace(/\s*🔀$/, '') + ' 🔀'; // ★ タイトルにシャッフル中を表示
  document.getElementById('study-done').style.display    = 'none';
  document.getElementById('study-content').style.display = 'flex';
  renderStudyCard();
  saveStudyProgress(); // ★ 念のため即座に保存しておく（renderStudyCard内でも保存されるが二重に確実化）
}

document.addEventListener('keydown', e => {
  if (document.querySelector('.screen.active')?.id !== 'screen-study') return;
  if (e.key==='ArrowRight') studyMove(1);
  if (e.key==='ArrowLeft' && studyIdx>0) studyMove(-1);
  if (e.key===' ') { e.preventDefault(); revealAnswer(); }
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
function renderImgStrip(k) {
  document.getElementById('imgs-'+k).innerHTML = imgBuf[k].map((b,i)=>`
    <div class="img-thumb"><img src="${b}" alt="" onclick="openImgLightbox(this.src)">
      <button class="img-thumb-del" onclick="removeImg('${k}',${i})">✕</button></div>`).join('');
}
function removeImg(k,i) { imgBuf[k].splice(i,1); renderImgStrip(k); }

// ★ 追加：カード編集モーダル用の画像ストリップ描画・削除
function renderModalImgStrip(k) {
  document.getElementById('modal-imgs-'+k).innerHTML = editImgBuf[k].map((b,i)=>`
    <div class="img-thumb"><img src="${b}" alt="" onclick="openImgLightbox(this.src)">
      <button class="img-thumb-del" onclick="removeModalImg('${k}',${i})">✕</button></div>`).join('');
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
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}

// ── バナー ────────────────────────────
function showBanner(msg, bg, color) {
  const banner = document.getElementById('save-ok-banner');
  banner.textContent = msg;
  banner.style.background = bg;
  banner.style.color = color;
  banner.style.display = 'block';
  setTimeout(() => {
    banner.style.display = 'none';
    banner.style.background = '#dcfce7';
    banner.style.color = '#166534';
  }, 3500);
}

// ── ユーティリティ ────────────────────
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function autoResize(el) { el.style.height='auto'; el.style.height=el.scrollHeight+'px'; }
function shake(id) {
  const el=document.getElementById(id); el.style.borderColor='#EF4444'; el.focus();
  setTimeout(()=>el.style.borderColor='',700);
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
      <span class="math-pad-title">🧮 理数モード</span>
      <button type="button" class="math-pad-close" onclick="toggleMathPad(this.closest('.math-pad').id)" aria-label="閉じる">✕</button>
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
      <div class="math-pad-tip">💡 分数・ルートは、数字や文字を選択してからボタンを押すとその部分が中に入ります。</div>
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
renderDeckList();

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
    const res = await fetch(`${API_BASE}list_cards`, { signal: controller.signal, cache: 'no-store' });
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

// 10秒ごとにチェック
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
    await Promise.all([fetchAndMergeDecks(), fetchAndMergeFolders(), fetchAndMergeOrder()]);
    if (document.querySelector('.screen.active')?.id === 'screen-list') {
      renderDeckListUI();
    }
  } finally {
    isForceRefreshing = false;
  }
}

// bfcacheから復元された場合（persisted === true）に発火
window.addEventListener('pageshow', (e) => {
  if (e.persisted) forceRefreshOnReturn();
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
    const res = await fetch(`${API_BASE}list_folders`, { signal: controller.signal, cache: 'no-store' });
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

// 10秒ごとにチェック
setInterval(checkFoldersUpdate, 10000);

// ===== JSON変更監視（共有の並び順 list_order.json） =====
let lastOrderHash = null;

async function checkOrderUpdate() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${API_BASE}list_order`, { signal: controller.signal, cache: 'no-store' });
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

// 10秒ごとにチェック
setInterval(checkOrderUpdate, 10000);
