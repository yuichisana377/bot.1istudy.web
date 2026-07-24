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

// ★ サーバーからフォルダ一覧を取得してキャッシュに反映する
async function fetchAndMergeFolders() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const res = await fetch(`${API_BASE}list_folders`, { signal: controller.signal });
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
    renderDeckListUI();
    setTimeout(() => renderDeckList(), 0);
  }
}

// ── デッキ一覧 ────────────────────────
function renderDeckListUI() {
  // 表示中のフォルダが（他端末での削除などで）無くなっていたらルートに戻す
  if (currentFolderId && !folders.find(f => f.id === currentFolderId)) currentFolderId = null;

  renderBreadcrumb();

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

  const folderHtml = childFolders.map(f => {
    const cnt = countDecksRecursive(f.id);
    return `
    <div class="deck-card folder-card" onclick="openFolder('${f.id}')">
      <div class="deck-card-info">
        <div class="deck-card-title">📁 ${esc(f.name)}</div>
        <div class="deck-card-meta">${cnt} 問</div>
      </div>
      <div class="deck-card-actions">
        <button class="icon-btn" onclick="event.stopPropagation();openFolderMenu('${f.id}')" title="メニュー">✏️</button>
      </div>
    </div>`;
  }).join('');

  // ★ 非公開・公開のグループ位置はそのまま、各グループ内だけ新しい順（下が古い）に反転
  const unpublished = childDecks.filter(d => !d.filename).slice().reverse();
  const published    = childDecks.filter(d =>  d.filename).slice().reverse();
  const orderedDecks = [...unpublished, ...published];

  const deckHtml = orderedDecks.map(d => {
    const unsureSet   = getUnsureSet(d.id);
    const unsureCount = d.cards.filter(c => unsureSet.has(cardKey(c))).length;
    const unsureBadge = unsureCount > 0 ? `<span class="unsure-badge">🔖 ${unsureCount}</span>` : '';
    const pubBadge = d.filename
      ? `<span class="pub-badge published">🔵 公開済み${d.published_by ? `（${esc(d.published_by)}）` : ''}</span>`
      : `<span class="pub-badge local">🔴 非公開</span>`;
    // ★ 公開済みかつ未完成としてマークされているデッキには未完成バッジを表示
    const draftBadge = (d.filename && d.incomplete)
      ? `<span class="pub-badge draft">🟡 未完成</span>`
      : '';
    return `
    <div class="deck-card">
      <div class="deck-card-info">
        <div class="deck-card-title">${esc(d.name)}</div>
        <div class="deck-card-meta">
          ${d.filename ? (d.count ?? d.cards.length) : d.cards.length} 問
          ${pubBadge}
          ${draftBadge}
          ${unsureBadge}
        </div>
      </div>
      <div class="deck-card-actions">
        <button class="btn btn-blue btn-sm" onclick="openPlayMode('${d.id}')"
          ${d.cards.length===0?'disabled':''}>▶ プレイ</button>
        <button class="icon-btn" onclick="openDeckMenu('${d.id}')" title="メニュー">✏️</button>
      </div>
    </div>`;
  }).join('');

  grid.innerHTML = folderHtml + deckHtml;
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
    chain.map(f => `<span class="crumb-sep">›</span><span class="crumb" onclick="openFolder('${f.id}')">${esc(f.name)}</span>`).join('');
}

// ── フォルダ間の移動 ──────────────────
function openFolder(id) {
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

// ★ list_cards を取得して decks にマージする共通処理（画面描画はしない）
async function fetchAndMergeDecks() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const res  = await fetch(`${API_BASE}list_cards`, { signal: controller.signal });
  clearTimeout(timer);
  const txt = await res.text();
  const data = JSON.parse(txt);
  if (!data.ok) return { changed: false, txt };
  const fetched = data.sets.map(s => {
    const existing = decks.find(d => d.filename === s.filename);
    return {
      id: existing ? existing.id : genId(),
      name: s.name,
      cards: s.cards,
      filename: s.filename,
      count: s.count,
      subject: s.subject || (existing && existing.subject) || null,
      published_by: s.published_by || (existing && existing.published_by) || null,
      // ★ 未完成フラグはサーバー側に無い情報なので、既存のローカル状態を引き継ぐ
      incomplete: existing ? !!existing.incomplete : false,
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
  const localOnly = decks.filter(d => !d.filename && !publishedNames.has(d.name));
  decks = [...localOnly, ...fetched];
  saveDecks(decks);
  return { changed: true, txt };
}

async function renderDeckList() {
  decks = loadDecks();
  folders = loadFoldersCache();
  renderDeckListUI();
  try {
    await Promise.all([fetchAndMergeDecks(), fetchAndMergeFolders()]);
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
function menuEdit()   { closeModal('modal-deck-menu'); openEditDeck(menuTargetId); }
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
  showScreen('new');
  loadSubjects();
  setTimeout(() => document.getElementById('new-set-name').focus(), 200);
}

async function loadSubjects() {
  const sel = document.getElementById('new-subject');
  sel.innerHTML = '<option value="">読み込み中…</option>';
  try {
    const res  = await fetch(`${API_BASE}channels?guild_id=${GUILD_ID}`);
    const data = await res.json();
    if (!data.ok || !data.channels.length) throw new Error();
    sel.innerHTML = '<option value="">科目を選択（任意）</option>' +
      data.channels.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  } catch(e) {
    sel.innerHTML = '<option value="">（科目を取得できませんでした）</option>';
  }
}

function startEdit() {
  const subject = document.getElementById('new-subject').value;
  const input   = document.getElementById('new-set-name').value.trim();
  if (!input) { shake('new-set-name'); return; }
  const name = subject ? `${subject} ${input}` : input;
  const deck = { id: genId(), name, subject, cards: [], folderId: currentFolderId };
  decks.push(deck); saveDecks(decks);
  openEditDeck(deck.id);
}

// ── カード編集画面 ────────────────────
function openEditDeck(deckId) {
  currentDeckId = deckId;
  const deck = decks.find(d => d.id === deckId);
  document.getElementById('edit-deck-title').textContent = deck.name;
  // ★ 公開済みデッキは「保存」（ローカルのみ）ボタンを隠し、「保存して公開」だけにする
  document.getElementById('btn-save-local').style.display = deck.filename ? 'none' : '';
  document.getElementById('btn-done').textContent = deck.filename ? '公開して保存' : '保存して公開';
  clearEditor(); renderCreatedList(); showScreen('edit');
  setTimeout(() => document.getElementById('ta-q').focus(), 200);
}
function clearEditor() {
  ['q','a','e'].forEach(k => {
    document.getElementById('ta-'+k).value = '';
    autoResize(document.getElementById('ta-'+k));
    imgBuf[k] = [];
    document.getElementById('imgs-'+k).innerHTML = '';
  });
}

async function saveCard(mode) {
  const q = document.getElementById('ta-q').value.trim();
  const a = document.getElementById('ta-a').value.trim();
  const deck = decks.find(d => d.id === currentDeckId);
  if (q || a) {
    if (!q || !a) { shake(!q ? 'ta-q' : 'ta-a'); return; }
    deck.cards.push({ id:genId(), question:q, answer:a,
      explanation: document.getElementById('ta-e').value.trim(),
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
      target.published_by = session ? session.nickname : '匿名';
      target.incomplete = !isComplete; // ★ 一覧の未完成バッジ表示用に保持
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

function renderCreatedList() {
  const deck = decks.find(d => d.id === currentDeckId);
  const section = document.getElementById('created-section');
  const list    = document.getElementById('created-list');
  if (!deck||!deck.cards.length) { section.style.display='none'; return; }
  section.style.display='block';
  list.innerHTML = deck.cards.map((c,i) => `
    <div class="created-item">
      <div class="created-item-num">${i+1}</div>
      <div class="created-item-body">
        <div class="created-item-q">${esc(c.question)}</div>
        <div class="created-item-a">${esc(c.answer)}</div>
      </div>
      <div class="created-item-btns">
        <button class="btn btn-ghost btn-sm" onclick="openCardEditModal(${i})">編集</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCardFromDeck(${i})">削除</button>
      </div>
    </div>`).join('');
}

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

function openCardEditModal(idx) {
  const deck = decks.find(d => d.id === currentDeckId);
  openCardEditModalCommon(deck.id, deck.cards[idx], 'editor');
}

// ★ プレイ中に今表示しているカードを編集する
function editCurrentStudyCard() {
  const c = studyCards[studyIdx];
  if (!c) return;
  openCardEditModalCommon(studyDeckId, c, 'study');
}

function openCardEditModalCommon(deckId, c, context) {
  editingDeckId  = deckId;
  editingCardKey = cardKey(c);
  editingContext = context;
  document.getElementById('modal-edit-q').value = c.question;
  document.getElementById('modal-edit-a').value = c.answer;
  document.getElementById('modal-edit-e').value = c.explanation||'';
  ['modal-edit-q','modal-edit-a','modal-edit-e'].forEach(id => autoResize(document.getElementById(id)));
  document.getElementById('card-edit-ok').style.display  = 'none';
  document.getElementById('card-edit-err').style.display = 'none';
  openModal('modal-card-edit');
}

async function saveCardEdit() {
  const q = document.getElementById('modal-edit-q').value.trim();
  const a = document.getElementById('modal-edit-a').value.trim();
  const errBar = document.getElementById('card-edit-err');
  if (!q || !a) {
    errBar.textContent = '✕ 問題文と解答は必須です';
    errBar.style.display = 'block';
    setTimeout(() => errBar.style.display = 'none', 3000);
    return;
  }
  const deck = decks.find(d => d.id === editingDeckId);
  if (!deck) { closeModal('modal-card-edit'); return; }
  const idx = deck.cards.findIndex(c => cardKey(c) === editingCardKey);
  if (idx === -1) { closeModal('modal-card-edit'); return; }

  // 既存オブジェクトを直接書き換える
  // → studyCards 側も同じ参照を持っているので、これだけで学習画面にも反映される
  const card = deck.cards[idx];
  card.question    = q;
  card.answer      = a;
  card.explanation = document.getElementById('modal-edit-e').value.trim();

  saveDecks(decks);
  closeModal('modal-card-edit');

  if (editingContext === 'study') {
    refreshStudyCardDisplay(card);
  } else {
    renderCreatedList();
  }

  // ★ 公開済みならサーバー側にも反映する（通知はしない）
  if (deck.filename) {
    const ok = await syncDeckToServer(deck);
    if (!ok) showBanner('⚠ サーバーへの反映に失敗しました（ローカルには保存済み）', '#fffbeb', '#92400e');
  }
}

// プレイ中の表示だけを更新（めくり状態はそのまま維持）
function refreshStudyCardDisplay(c) {
  // ★ 反転モードなら問題⇔解答を入れ替えて表示する（データ自体は変えない）
  const qText = studyReverse ? c.answer   : c.question;
  const qImgs = studyReverse ? c.imgs_a   : c.imgs_q;
  const aText = studyReverse ? c.question : c.answer;
  const aImgs = studyReverse ? c.imgs_q   : c.imgs_a;

  document.getElementById('study-q-text').textContent = qText;
  document.getElementById('study-q-imgs').innerHTML = (qImgs||[]).map(s=>`<img src="${s}" alt="">`).join('');
  document.getElementById('study-a-text').textContent = aText;
  document.getElementById('study-a-imgs').innerHTML = (aImgs||[]).map(s=>`<img src="${s}" alt="">`).join('');
  const explWrap = document.getElementById('study-expl-wrap');
  if (c.explanation) {
    document.getElementById('study-e-text').textContent = c.explanation;
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
  const sel = document.getElementById('modal-rename-subject');
  sel.innerHTML = '<option value="">読み込み中…</option>';
  openModal('modal-rename');
  try {
    const res  = await fetch(`${API_BASE}channels?guild_id=${GUILD_ID}`);
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
  const deck = decks.find(d => d.id === renamingDeckId);
  const newName = subject ? `${subject} ${input}` : input;
  deck.subject = subject;
  deck.name    = newName;
  saveDecks(decks);
  closeModal('modal-rename');
  renderDeckListUI();

  // ★ 公開済みならサーバー側のファイルも更新する（通知はしない）
  if (deck.filename) {
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

let studyDeckId = null;

function openPlayMode(deckId) {
  const deck = decks.find(d => d.id === deckId);
  studyDeckId = deckId;
  document.getElementById('reverse-mode-checkbox').checked = false; // ★ プレイモード選択のたびに未チェックへリセット
  document.getElementById('play-mode-deck-name').textContent = deck.name;
  document.getElementById('play-mode-all-sub').textContent = `${deck.cards.length} 問`;
  const unsure = getUnsureSet(deckId);
  const unsureCount = deck.cards.filter(c => unsure.has(cardKey(c))).length;
  const unsureItem = document.getElementById('play-mode-unsure-item');
  if (unsureCount > 0) {
    document.getElementById('play-mode-unsure-sub').textContent = `${unsureCount} 問`;
    unsureItem.style.display = '';
    openModal('modal-play-mode');
  } else {
    startStudyMode('all');
  }
}

function startStudyMode(mode) {
  studyReverse = document.getElementById('reverse-mode-checkbox').checked; // ★ 反転モードかどうかを取得
  closeModal('modal-play-mode');
  const deck = decks.find(d => d.id === studyDeckId);
  if (mode === 'unsure') {
    const unsure = getUnsureSet(studyDeckId);
    studyCards = deck.cards.filter(c => unsure.has(cardKey(c)));
  } else {
    studyCards = [...deck.cards];
  }
  studyIdx = 0;
  document.getElementById('study-title').textContent = deck.name + (studyReverse ? ' 🔄' : ''); // ★ 反転中はタイトルに目印
  document.getElementById('study-done-sub').textContent = `全 ${studyCards.length} 問完了！`;
  showScreen('study');
  document.getElementById('study-done').style.display    = 'none';
  document.getElementById('study-content').style.display = 'flex';
  renderStudyCard();
}

function renderStudyCard() {
  if (studyIdx >= studyCards.length) {
    document.getElementById('study-content').style.display = 'none';
    document.getElementById('study-done').style.display    = 'flex';
    document.getElementById('study-prog-fill').style.width  = '100%';
    document.getElementById('study-prog-label').textContent = `${studyCards.length} / ${studyCards.length}`;
    return;
  }
  const c = studyCards[studyIdx];

  // ★ 反転モードなら「問題」欄に解答、「解答」欄に問題文を出す（解説はそのまま解答側に表示）
  const qText = studyReverse ? c.answer   : c.question;
  const qImgs = studyReverse ? c.imgs_a   : c.imgs_q;
  const aText = studyReverse ? c.question : c.answer;
  const aImgs = studyReverse ? c.imgs_q   : c.imgs_a;

  document.getElementById('study-q-text').textContent = qText;
  document.getElementById('study-q-imgs').innerHTML = (qImgs||[]).map(s=>`<img src="${s}" alt="">`).join('');
  document.getElementById('study-answer-panel').classList.remove('show');
  document.getElementById('study-reveal-bar').style.display = 'flex';
  document.getElementById('study-nav').style.display = 'none';
  document.getElementById('study-a-text').textContent = aText;
  document.getElementById('study-a-imgs').innerHTML = (aImgs||[]).map(s=>`<img src="${s}" alt="">`).join('');
  const explWrap = document.getElementById('study-expl-wrap');
  if (c.explanation) { document.getElementById('study-e-text').textContent = c.explanation; explWrap.style.display = ''; }
  else { explWrap.style.display = 'none'; }
  const pct = studyCards.length > 1 ? (studyIdx/(studyCards.length-1))*100 : 100;
  document.getElementById('study-prog-fill').style.width  = pct + '%';
  document.getElementById('study-prog-label').textContent = `${studyIdx+1} / ${studyCards.length}`;
  // ★ 答えを見る前・見た後、両方の「前へ」ボタンの有効/無効を同期
  document.getElementById('study-prev').disabled     = studyIdx === 0;
  document.getElementById('study-prev-pre').disabled = studyIdx === 0;
  document.getElementById('study-next').textContent = studyIdx === studyCards.length-1 ? '完了 ✓' : '次へ →';
  updateUnsureBtn();
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
  const unsure = getUnsureSet(studyDeckId);
  const btn = document.getElementById('unsure-btn');
  btn.textContent = 'わからない';
  btn.classList.toggle('marked', unsure.has(key));
}

function toggleUnsure() {
  const card = studyCards[studyIdx]; if (!card) return;
  const key = cardKey(card);
  const unsure = getUnsureSet(studyDeckId);
  if (unsure.has(key)) unsure.delete(key); else unsure.add(key);
  saveUnsureSet(studyDeckId, unsure);
  updateUnsureBtn();
}

function studyMove(dir) { studyIdx += dir; renderStudyCard(); }

function shuffleStudy() {
  for (let i=studyCards.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [studyCards[i],studyCards[j]]=[studyCards[j],studyCards[i]];
  }
  studyIdx = 0;
  document.getElementById('study-done').style.display    = 'none';
  document.getElementById('study-content').style.display = 'flex';
  renderStudyCard();
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
function addImage(t) { imgTarget=t; imgInput.click(); }
imgInput.addEventListener('change', async () => {
  const file = imgInput.files[0]; if (!file||!imgTarget) return;
  const target = imgTarget;
  imgInput.value = '';
  try {
    const dataUrl = await compressImageFile(file);
    imgBuf[target].push(dataUrl);
    renderImgStrip(target);
  } catch(e) {
    await showCmAlert({ title: '画像の読み込みに失敗しました', desc: '別の画像で試してください。' });
  }
});
function renderImgStrip(k) {
  document.getElementById('imgs-'+k).innerHTML = imgBuf[k].map((b,i)=>`
    <div class="img-thumb"><img src="${b}" alt="">
      <button class="img-thumb-del" onclick="removeImg('${k}',${i})">✕</button></div>`).join('');
}
function removeImg(k,i) { imgBuf[k].splice(i,1); renderImgStrip(k); }


// ── モーダル ──────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function onOverlayClick(e,id) { if(e.target===document.getElementById(id)) closeModal(id); }

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
async function checkCardsUpdate() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${API_BASE}list_cards`, { signal: controller.signal });
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

// ===== JSON変更監視（共有フォルダ folders.json） =====
let lastFoldersHash = null;

async function checkFoldersUpdate() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${API_BASE}list_folders`, { signal: controller.signal });
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
