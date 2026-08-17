// ============================================================
//  Notice.js — お知らせページ用スクリプト
//  Notice.html から読み込む
// ============================================================

const API_BASE = "https://chiro-ubuntuserver.tail1130ba.ts.net/";
const GUILD_ID = "1509880344806162544";
const LOGIN_PATH = '/Login.html'; // ★ Cardmaker.js と同じ基準のログインページパス

let notices = [];
let currentViewFilename = null;
let currentViewContent = null;
let isEditingNotice = false;
let editingOriginalFilename = null; // 編集開始時点のファイル名（リネーム検知用）
let pendingDraft = null;            // 復元候補の下書き（バナー表示中に保持）
let draftSaveTimer = null;
const DRAFT_KEY_NEW = 'notice_draft_new';

// ── ログインセッション（Login.js / Cardmaker.js と共通） ──────
const SESSION_KEY = 'sl_session';
function getLoginSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

// ============================================================
//  起動
// ============================================================
window.addEventListener('load', () => {
  loadNotices();
});

// ============================================================
//  API ヘルパー
// ============================================================
async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json" }, ...opts
  });
  return res.json();
}

// ============================================================
//  一覧読み込み・描画
// ============================================================
async function loadNotices() {
  document.getElementById('notice-loading').style.display = 'block';
  document.getElementById('notice-content').innerHTML = '';
  try {
    const data = await api(`/list_notices?guild_id=${GUILD_ID}`);
    notices = data.ok ? data.notices : [];
  } catch (e) {
    notices = [];
  }
  document.getElementById('notice-loading').style.display = 'none';
  renderNotices();
}

function extBadgeClass(ext) {
  return ext === 'md' ? 'notice-badge-md' : 'notice-badge-txt';
}

function renderNotices() {
  const el = document.getElementById('notice-content');
  if (!notices.length) {
    el.innerHTML = '<div class="empty-msg">お知らせはまだありません</div>';
    return;
  }

  el.innerHTML = `<div class="notice-list">` + notices.map(n => {
    const metaParts = [];
    if (n.uploader) metaParts.push(`${n.uploader}さん`);
    if (n.uploaded_at) metaParts.push(n.uploaded_at);
    const meta = metaParts.length ? `<span class="notice-meta">${metaParts.join(' ・ ')}</span>` : '';
    return `
    <div class="notice-card" onclick="openViewModal('${n.filename.replace(/'/g, "\\'")}')">
      <span class="notice-badge ${extBadgeClass(n.ext)}">${n.ext.toUpperCase()}</span>
      <span class="notice-name">${n.filename}${meta}</span>
      <span class="notice-arrow">›</span>
    </div>`;
  }).join('') + `</div>`;
}

// ============================================================
//  詳細（プレビュー）モーダル
// ============================================================
async function openViewModal(filename) {
  currentViewFilename = filename;
  document.getElementById('view-filename').textContent = filename;
  document.getElementById('view-meta').textContent = '';
  const bodyEl = document.getElementById('view-body');
  bodyEl.innerHTML = '';
  document.getElementById('view-loading').style.display = 'block';
  document.getElementById('modal-view').classList.add('open');

  try {
    const data = await api(`/get_notice?filename=${encodeURIComponent(filename)}`);
    document.getElementById('view-loading').style.display = 'none';
    if (data.ok) {
      currentViewContent = data.content;
      renderNoticeBody(bodyEl, filename, data.content);
      const metaParts = [];
      if (data.uploader) metaParts.push(`${data.uploader}さん`);
      if (data.uploaded_at) metaParts.push(data.uploaded_at);
      document.getElementById('view-meta').textContent = metaParts.join(' ・ ');
    } else {
      bodyEl.classList.add('notice-plain');
      bodyEl.textContent = '読み込みに失敗しました: ' + (data.error || '');
    }
  } catch (e) {
    document.getElementById('view-loading').style.display = 'none';
    bodyEl.classList.add('notice-plain');
    bodyEl.textContent = 'サーバーに接続できませんでした';
  }
}

/** .md は GitHub 風に Markdown レンダリング、.txt はプレーンテキスト表示 */
function renderNoticeBody(bodyEl, filename, content) {
  const isMd = /\.md$/i.test(filename);
  if (isMd && window.marked) {
    bodyEl.classList.remove('notice-plain');
    bodyEl.classList.add('markdown-body');
    const rawHtml = marked.parse(content, { breaks: true, gfm: true });
    bodyEl.innerHTML = window.DOMPurify ? DOMPurify.sanitize(rawHtml) : rawHtml;
  } else {
    bodyEl.classList.remove('markdown-body');
    bodyEl.classList.add('notice-plain');
    bodyEl.textContent = content;
  }
}

// ============================================================
//  プレビュー（アップロード／編集モーダル内）
// ============================================================
function switchNoticeTab(tab) {
  const editBtn = document.getElementById('tab-edit-btn');
  const previewBtn = document.getElementById('tab-preview-btn');
  const textarea = document.getElementById('upload-content');
  const previewEl = document.getElementById('upload-preview');

  if (tab === 'preview') {
    const filename = document.getElementById('upload-filename').value.trim();
    const content = textarea.value;
    // renderNoticeBody は .md 拡張子のときのみ Markdown レンダリング、それ以外はプレーン表示
    previewEl.innerHTML = '';
    previewEl.className = 'notice-body';
    renderNoticeBody(previewEl, filename, content || '（内容がありません）');
    previewEl.style.display = 'block';
    textarea.style.display = 'none';
    previewBtn.classList.add('active');
    editBtn.classList.remove('active');
  } else {
    previewEl.style.display = 'none';
    textarea.style.display = 'block';
    editBtn.classList.add('active');
    previewBtn.classList.remove('active');
  }
}

// ============================================================
//  下書き（ローカル一時保存）
// ============================================================
function draftKeyForEdit(originalFilename) {
  return 'notice_draft_edit_' + originalFilename;
}

function scheduleDraftSave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveDraftNow, 600);
}

function saveDraftNow() {
  const filename = document.getElementById('upload-filename').value;
  const content = document.getElementById('upload-content').value;
  const statusEl = document.getElementById('draft-status');

  if (!filename.trim() && !content.trim()) return; // 空なら保存しない

  const key = isEditingNotice ? draftKeyForEdit(editingOriginalFilename) : DRAFT_KEY_NEW;
  try {
    localStorage.setItem(key, JSON.stringify({ filename, content, ts: Date.now() }));
    statusEl.textContent = '💾 下書きを自動保存しました（' + new Date().toLocaleTimeString('ja-JP') + '）';
  } catch (e) {
    // localStorage が使えない環境では何もしない
  }
}

function checkForDraft(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) { document.getElementById('draft-banner').style.display = 'none'; return; }
    pendingDraft = JSON.parse(raw);
    document.getElementById('draft-banner').style.display = 'flex';
  } catch (e) {
    document.getElementById('draft-banner').style.display = 'none';
  }
}

function restoreDraft() {
  if (!pendingDraft) return;
  document.getElementById('upload-filename').value = pendingDraft.filename || '';
  document.getElementById('upload-content').value = pendingDraft.content || '';
  onFilenameInput();
  document.getElementById('draft-banner').style.display = 'none';
}

function discardDraft() {
  const key = isEditingNotice ? draftKeyForEdit(editingOriginalFilename) : DRAFT_KEY_NEW;
  try { localStorage.removeItem(key); } catch (e) {}
  pendingDraft = null;
  document.getElementById('draft-banner').style.display = 'none';
}

function clearDraftAfterSubmit() {
  const key = isEditingNotice ? draftKeyForEdit(editingOriginalFilename) : DRAFT_KEY_NEW;
  try { localStorage.removeItem(key); } catch (e) {}
  document.getElementById('draft-status').textContent = '';
}

async function deleteCurrentNotice() {
  if (!currentViewFilename) return;
  if (!confirm(`「${currentViewFilename}」を削除しますか？`)) return;

  const btn = document.getElementById('view-delete-btn');
  btn.disabled = true;
  btn.textContent = '削除中…';
  try {
    const res = await api('/delete_notice', {
      method: 'POST',
      body: JSON.stringify({ filename: currentViewFilename })
    });
    btn.disabled = false;
    btn.textContent = '削除する';
    if (res.ok) {
      closeNoticeModal('view');
      await loadNotices();
    } else {
      alert('削除に失敗しました: ' + (res.error || ''));
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '削除する';
    alert('サーバーに接続できませんでした');
  }
}

// ============================================================
//  アップロードモーダル
// ============================================================
function openUploadModal() {
  isEditingNotice = false;
  editingOriginalFilename = null;

  document.getElementById('upload-filename').value = '';
  document.getElementById('upload-filename').disabled = false;
  document.getElementById('upload-content').value = '';
  document.getElementById('upload-file-input').value = '';
  document.getElementById('upload-file-input').closest('.field').style.display = '';
  document.getElementById('upload-ok').style.display = 'none';
  document.getElementById('upload-err').style.display = 'none';
  document.getElementById('filename-hint').textContent = '';
  document.getElementById('draft-status').textContent = '';

  document.querySelector('#modal-upload .modal-header h3').textContent = 'お知らせをアップロード';
  document.querySelector('#modal-upload .btn-primary').textContent = 'アップロードする';

  const session = getLoginSession();
  const display = document.getElementById('upload-uploader-display');
  display.textContent = session ? `${session.nickname} さん` : '未ログイン（匿名として投稿されます）';

  switchNoticeTab('edit');
  checkForDraft(DRAFT_KEY_NEW);

  document.getElementById('modal-upload').classList.add('open');
}

/** 詳細モーダルの「編集する」から呼ばれる：既存の内容をアップロードモーダルに読み込んで編集モードにする */
function openEditModal() {
  if (!currentViewFilename) return;

  isEditingNotice = true;
  editingOriginalFilename = currentViewFilename;
  closeNoticeModal('view');

  document.getElementById('upload-filename').value = currentViewFilename;
  document.getElementById('upload-filename').disabled = false; // ★ 編集時もファイル名（タイトル）を変更可能に
  document.getElementById('upload-content').value = currentViewContent || '';
  document.getElementById('upload-file-input').value = '';
  document.getElementById('upload-file-input').closest('.field').style.display = 'none';
  document.getElementById('upload-ok').style.display = 'none';
  document.getElementById('upload-err').style.display = 'none';
  document.getElementById('filename-hint').textContent = '';
  document.getElementById('draft-status').textContent = '';

  document.querySelector('#modal-upload .modal-header h3').textContent = 'お知らせを編集';
  document.querySelector('#modal-upload .btn-primary').textContent = '更新する';

  const session = getLoginSession();
  const display = document.getElementById('upload-uploader-display');
  display.textContent = session ? `${session.nickname} さん` : '未ログイン（匿名として更新されます）';

  switchNoticeTab('edit');
  checkForDraft(draftKeyForEdit(editingOriginalFilename));

  document.getElementById('modal-upload').classList.add('open');
}

function onFilenameInput() {
  const hintEl = document.getElementById('filename-hint');
  const filename = document.getElementById('upload-filename').value.trim();
  if (isEditingNotice && editingOriginalFilename && filename && filename !== editingOriginalFilename) {
    hintEl.textContent = `「${editingOriginalFilename}」から名前が変更されます（保存時に移動されます）`;
  } else {
    hintEl.textContent = '';
  }
  scheduleDraftSave();
}

function onContentInput() {
  scheduleDraftSave();
}

function onLocalFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  const nameEl = document.getElementById('upload-filename');
  if (!nameEl.value.trim()) nameEl.value = file.name;

  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('upload-content').value = reader.result;
  };
  reader.readAsText(file, 'utf-8');
}

async function submitUpload() {
  const filename = document.getElementById('upload-filename').value.trim();
  const content  = document.getElementById('upload-content').value;

  if (!filename) { showNoticeErr('upload-err', 'ファイル名を入力してください'); return; }
  if (!/\.(md|txt)$/i.test(filename)) { showNoticeErr('upload-err', 'ファイル名は .md か .txt にしてください'); return; }
  if (!content.trim()) { showNoticeErr('upload-err', '内容が空です'); return; }

  // ★ 同じ名前（既存の別お知らせと同名）で保存しようとした場合は上書き確認する
  //   ・新規投稿で既存と同名 → 上書きするか確認
  //   ・編集でタイトルを既存の別名に変更 → 上書きするか確認
  //   ・編集で元の名前のまま（変更なし） → 確認不要（通常の更新）
  const excludeName = isEditingNotice ? editingOriginalFilename : null;
  const isDuplicate = notices.some(n => n.filename === filename && n.filename !== excludeName);
  if (isDuplicate) {
    const overwriteOk = confirm(
      `「${filename}」という名前のお知らせは既に存在します。\n上書きしてもよろしいですか？`
    );
    if (!overwriteOk) return;
  }

  // ★ Cardmaker.js と同じ考え方：未ログインなら「匿名のまま投稿」か「ログイン画面へ」を確認する
  const session = getLoginSession();
  if (!session) {
    const proceedAnon = confirm(
      'ログインしていません。\n' +
      'このまま投稿すると「匿名」として投稿されます。\n\n' +
      'OK：匿名のまま投稿する\nキャンセル：ログイン画面へ移動する'
    );
    if (!proceedAnon) {
      sessionStorage.setItem('post_login_redirect', location.href); // ログイン後に戻ってくる先を記憶
      location.href = LOGIN_PATH;
      return;
    }
  }
  const uploader = session ? session.nickname : '匿名';

  const editing = isEditingNotice;
  const btnLabel = editing ? '更新する' : 'アップロードする';

  const btn = document.querySelector('#modal-upload .btn-primary');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>${editing ? '更新中…' : 'アップロード中…'}`;
  try {
    // /upload_notice は同名ファイルなら自動的に上書き（更新）してくれるため、
    // 新規投稿・編集どちらもこのエンドポイントを使う
    const res = await api('/upload_notice', {
      method: 'POST',
      body: JSON.stringify({ filename, content, uploader, guild_id: GUILD_ID })
    });
    btn.disabled = false;
    btn.textContent = btnLabel;
    if (res.ok) {
      // ★ 編集でファイル名（タイトル）が変更された場合は、新しい名前で保存した後に古いファイルを削除して「移動」を完成させる
      if (editing && editingOriginalFilename && editingOriginalFilename !== filename) {
        try {
          await api('/delete_notice', {
            method: 'POST',
            body: JSON.stringify({ filename: editingOriginalFilename })
          });
        } catch (e) {
          // 古いファイルの削除に失敗しても、新しい内容の保存自体は成功しているため処理は続行する
        }
      }
      clearDraftAfterSubmit();
      showNoticeOk('upload-ok');
      if (editing) {
        currentViewContent = content;
        currentViewFilename = filename;
        editingOriginalFilename = filename;
      }
      await loadNotices();
      setTimeout(() => closeNoticeModal('upload'), 700);
    } else {
      showNoticeErr('upload-err', res.error || 'エラーが発生しました');
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = btnLabel;
    showNoticeErr('upload-err', 'サーバーに接続できませんでした');
  }
}

// ============================================================
//  UI ヘルパー
// ============================================================
function showNoticeOk(id) {
  const el = document.getElementById(id);
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 3000);
}
function showNoticeErr(id, msg) {
  const el = document.getElementById(id);
  el.textContent = '✕ ' + msg;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 4000);
}
function closeNoticeModal(name) {
  document.getElementById('modal-' + name).classList.remove('open');
}
function onBgClickNotice(e, name) {
  if (e.target === document.getElementById('modal-' + name)) closeNoticeModal(name);
}

// ============================================================
//  ドロワー（他ページと共通の挙動）
// ============================================================
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}
