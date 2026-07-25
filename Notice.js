// ============================================================
//  Notice.js — お知らせページ用スクリプト
//  Notice.html から読み込む
// ============================================================

const API_BASE = "https://python-bot-1istudy.onrender.com/";
const GUILD_ID = "1509880344806162544";

let notices = [];
let currentViewFilename = null;

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

  el.innerHTML = `<div class="notice-list">` + notices.map(n => `
    <div class="notice-card" onclick="openViewModal('${n.filename.replace(/'/g, "\\'")}')">
      <span class="notice-badge ${extBadgeClass(n.ext)}">${n.ext.toUpperCase()}</span>
      <span class="notice-name">${n.filename}</span>
      <span class="notice-arrow">›</span>
    </div>
  `).join('') + `</div>`;
}

// ============================================================
//  詳細（プレビュー）モーダル
// ============================================================
async function openViewModal(filename) {
  currentViewFilename = filename;
  document.getElementById('view-filename').textContent = filename;
  const bodyEl = document.getElementById('view-body');
  bodyEl.innerHTML = '';
  document.getElementById('view-loading').style.display = 'block';
  document.getElementById('modal-view').classList.add('open');

  try {
    const data = await api(`/get_notice?filename=${encodeURIComponent(filename)}`);
    document.getElementById('view-loading').style.display = 'none';
    if (data.ok) {
      renderNoticeBody(bodyEl, filename, data.content);
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
  document.getElementById('upload-filename').value = '';
  document.getElementById('upload-uploader').value = '';
  document.getElementById('upload-content').value = '';
  document.getElementById('upload-file-input').value = '';
  document.getElementById('upload-ok').style.display = 'none';
  document.getElementById('upload-err').style.display = 'none';
  document.getElementById('modal-upload').classList.add('open');
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
  const uploader = document.getElementById('upload-uploader').value.trim();
  const content  = document.getElementById('upload-content').value;

  if (!filename) { showNoticeErr('upload-err', 'ファイル名を入力してください'); return; }
  if (!/\.(md|txt)$/i.test(filename)) { showNoticeErr('upload-err', 'ファイル名は .md か .txt にしてください'); return; }
  if (!content.trim()) { showNoticeErr('upload-err', '内容が空です'); return; }

  const btn = document.querySelector('#modal-upload .btn-primary');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>アップロード中…';
  try {
    const res = await api('/upload_notice', {
      method: 'POST',
      body: JSON.stringify({ filename, content, uploader, guild_id: GUILD_ID })
    });
    btn.disabled = false;
    btn.textContent = 'アップロードする';
    if (res.ok) {
      showNoticeOk('upload-ok');
      await loadNotices();
      setTimeout(() => closeNoticeModal('upload'), 700);
    } else {
      showNoticeErr('upload-err', res.error || 'エラーが発生しました');
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'アップロードする';
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
