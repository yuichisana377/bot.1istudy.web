// ============================================================
//  Notice.js — お知らせページ用スクリプト
//  Notice.html から読み込む
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
if (!GUILD_ID) location.replace('/Login.html');
const LOGIN_PATH = '/Login.html'; // ★ Cardmaker.js と同じ基準のログインページパス

let notices = [];
let currentViewFilename = null;
let currentViewContent = null;
let isEditingNotice = false;
let editingOriginalFilename = null; // 編集開始時点のファイル名（リネーム検知用）
let pendingDraft = null;            // 復元候補の下書き（バナー表示中に保持）
let draftSaveTimer = null;
const DRAFT_KEY_NEW = 'notice_draft_new';

// ★ OS標準のconfirm()/alert()の代替（showAppConfirm/showAppAlert）は
//   全ページ共通の /Dialog.js に移した（Notice.html側で読み込み済み）。

// ── ログインセッション（Login.js / Cardmaker.js と共通） ──────
const SESSION_KEY = 'sl_session';
function getLoginSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}
// ★ 追加（2026/08/24）：以前は閲覧（GET）は誰でもOKだったが、「予定一覧
//   以外はサーバー参加済みの人だけ見られるように」というユーザーの明示的な
//   指示で、Cardmaker.js/StudyLog.js/Quiz.jsと同様、開いた瞬間に未ログイン
//   ならログイン画面へ誘導する全面ログイン必須のページに変更した。
(function() {
  var s = getLoginSession();
  if (!s || !s.session_token) {
    sessionStorage.setItem('post_login_redirect', location.href);
    location.replace(LOGIN_PATH);
  }
})();
// ★ 追加：変更系の操作（投稿・実行済み切替・削除）はサーバー側もログイン必須に
//   なった（2026/08/19）。以前あった「匿名のまま投稿する」選択肢は廃止し、
//   未ログインなら必ずログイン画面へ誘導する。
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

  // ★ 複数サーバー対応：別のDiscordサーバーへ切り替える（ログアウトしてから
  //   再度ログインしてもらう＝どのサーバーへ行くかはログイン時にサーバー側が
  //   自動判定する。Login.js参照）。実際に複数のBot導入済みサーバーに
  //   参加している人にだけ出す（ユーザーの明示的な指定）。
  let isMultiGuild = false;
  try { isMultiGuild = !!JSON.parse(localStorage.getItem('current_guild') || 'null')?.multi_guild; } catch {}
  if (isMultiGuild) {
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
  }

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

// ============================================================
//  起動
// ============================================================
window.addEventListener('load', () => {
  loadNotices();
  prefetchOtherPages(); // ★ 追加：メニューを開くのを待たず、初期表示後に自動で他ページを裏で先読み
  // ★ 変更監視用のハッシュを、初回読み込みの内容で起点合わせしておく
  //  （比較なしで保存するだけの「初回チェック」）
  checkNoticesUpdate();
  startRealtimeUpdates();
});

// ============================================================
//  API ヘルパー
// ============================================================
async function api(path, opts = {}) {
  // ★ 追加（2026/08/24）：list_notices/get_notice等の閲覧系APIがログイン
  //   必須になったため、他ページのapi()ヘルパーと同様、ログイン済みなら
  //   常にAuthorizationヘッダを自動で付ける（session_tokenをURLクエリに
  //   載せないためでもある）。
  const session = getLoginSession();
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    (session && session.session_token) ? { "Authorization": "Bearer " + session.session_token } : {},
    opts.headers || {}
  );
  const res = await fetch(API_BASE + path.replace(/^\/+/, ''), { cache: 'no-store', ...opts, headers });
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

// ★ セキュリティ：ファイル名・投稿者ニックネームは利用者が自由入力できる値
//   （HTMLタグを含められる）なので、テンプレート文字列でHTMLを組み立てて
//   innerHTMLに流し込む方式は絶対に使わない（XSSになる）。必ずDOM APIと
//   textContentで組み立て、文字列がそのままHTMLとして解釈されないようにする。
function renderNotices() {
  const el = document.getElementById('notice-content');
  el.innerHTML = ''; // ここは固定文字列のクリアのみなので安全

  if (!notices.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-msg';
    empty.textContent = 'お知らせはまだありません';
    el.appendChild(empty);
    return;
  }

  // ★ 「実行済み」にしたお知らせは一覧の一番下にまとめる
  //   （元々の並び順＝新しい順は、未実行・実行済みそれぞれのグループ内では維持する）
  const undone = notices.filter(n => !n.done);
  const done    = notices.filter(n => n.done);
  const ordered = [...undone, ...done];

  const list = document.createElement('div');
  list.className = 'notice-list';

  ordered.forEach(n => {
    const card = document.createElement('div');
    card.className = 'notice-card' + (n.done ? ' notice-done' : '');
    card.addEventListener('click', () => openViewModal(n.filename));

    const badge = document.createElement('span');
    badge.className = 'notice-badge ' + extBadgeClass(n.ext);
    badge.textContent = (n.ext || '').toUpperCase();

    const nameEl = document.createElement('span');
    nameEl.className = 'notice-name';
    nameEl.appendChild(document.createTextNode(n.filename));
    const metaParts = [];
    if (n.uploader) metaParts.push(`${n.uploader}さん`);
    if (n.uploaded_at) metaParts.push(n.uploaded_at);
    if (metaParts.length) {
      const meta = document.createElement('span');
      meta.className = 'notice-meta';
      meta.textContent = metaParts.join(' ・ ');
      nameEl.appendChild(meta);
    }

    const arrow = document.createElement('span');
    arrow.className = 'notice-arrow';
    arrow.textContent = '›';

    card.appendChild(badge);
    card.appendChild(nameEl);
    card.appendChild(arrow);
    list.appendChild(card);
  });

  el.appendChild(list);
}

// ★ 「実行済み」の切り替え本体。全員共有の状態として、押した瞬間に
//   一覧の下へ薄く移動する。詳細モーダルの「実行済みにする」ボタン
//   （編集する・削除するの並び）からのみ呼ばれる。
async function setNoticeDone(filename, nextDone) {
  const session = requireLoginOrRedirect();
  if (!session) return;
  const n = notices.find(x => x.filename === filename);
  if (!n) return;
  n.done = nextDone; // ★ 楽観的に即座に反映（サーバー応答を待たず見た目を切り替える）
  renderNotices();
  updateViewDoneBtn();
  try {
    const res = await api('/set_notice_done', {
      method: 'POST',
      body: JSON.stringify({ guild_id: GUILD_ID, session_token: session.session_token, filename, done: nextDone, nickname: session.nickname }),
    });
    if (!res.ok) throw new Error(res.error || '');
  } catch (e) {
    // ★ サーバーへの反映に失敗した場合は表示も元に戻す
    n.done = !nextDone;
    renderNotices();
    updateViewDoneBtn();
    showAppAlert({ title: '実行済みの切り替えに失敗しました', desc: '通信環境を確認してもう一度お試しください。' });
  }
}

// 詳細モーダルの「実行済みにする」ボタンから
function toggleNoticeDoneFromModal() {
  if (!currentViewFilename) return;
  const n = notices.find(x => x.filename === currentViewFilename);
  if (!n) return;
  setNoticeDone(currentViewFilename, !n.done);
}

// 詳細モーダルのボタン表示を、今開いているお知らせの実行済み状態に合わせる
function updateViewDoneBtn() {
  const btn = document.getElementById('view-done-btn');
  if (!btn || !currentViewFilename) return;
  const n = notices.find(x => x.filename === currentViewFilename);
  const isDone = !!(n && n.done);
  btn.innerHTML = isDone ? (Icons.html('check', {size:14}) + ' 実行済み') : '実行済みにする';
  btn.classList.toggle('is-done', isDone);
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
  updateViewDoneBtn(); // ★ 追加：「実行済みにする」ボタンの表示を、このお知らせの状態に合わせる

  try {
    const data = await api(`/get_notice?guild_id=${GUILD_ID}&filename=${encodeURIComponent(filename)}`);
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
  // ★ セキュリティ：DOMPurifyが読み込めていない場合、サニタイズ無しでHTMLを
  //   描画する（＝XSS）フォールバックには絶対にしない。その場合はプレーン
  //   テキスト表示にとどめる（marked単体では危険なHTMLがそのまま通ってしまうため）。
  if (isMd && window.marked && window.DOMPurify) {
    bodyEl.classList.remove('notice-plain');
    bodyEl.classList.add('markdown-body');
    const rawHtml = marked.parse(content, { breaks: true, gfm: true });
    bodyEl.innerHTML = DOMPurify.sanitize(rawHtml);
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
    statusEl.innerHTML = Icons.html('save', {size:14}) + ' 下書きを自動保存しました（' + new Date().toLocaleTimeString('ja-JP') + '）';
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
  const session = requireLoginOrRedirect();
  if (!session) return;
  if (!currentViewFilename) return;
  const ok = await showAppConfirm({
    title: '削除しますか？', desc: `「${currentViewFilename}」を削除します。この操作は取り消せません。`,
    okLabel: '削除する', danger: true,
  });
  if (!ok) return;

  const btn = document.getElementById('view-delete-btn');
  btn.disabled = true;
  btn.textContent = '削除中…';
  try {
    const res = await api('/delete_notice', {
      method: 'POST',
      body: JSON.stringify({ guild_id: GUILD_ID, session_token: session.session_token, filename: currentViewFilename, nickname: session.nickname })
    });
    btn.disabled = false;
    btn.textContent = '削除する';
    if (res.ok) {
      closeNoticeModal('view');
      await loadNotices();
    } else if (res.error === 'creator_approval_required') {
      // ★ 追加：投稿者本人以外は直接削除できない（サーバー側の作成者確認機能）。
      //   代わりに投稿者への削除依頼フォームを開く。
      openRequestDeleteModal(currentViewFilename, res.owner_nickname);
    } else {
      showAppAlert({ title: '削除に失敗しました', desc: res.error || '' });
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '削除する';
    showAppAlert({ title: 'サーバーに接続できませんでした' });
  }
}

// ── 削除の確認依頼（投稿者本人以外が削除しようとしたとき） ──
// サーバーが creator_approval_required を返したときに deleteCurrentNotice()
// から呼ばれる。ここでは何も削除せず、理由を添えて /request_delete を叩き、
// 投稿者にDiscordで確認してもらうだけ。
let requestDeleteFilename = null;

function openRequestDeleteModal(filename, ownerNickname) {
  requestDeleteFilename = filename;
  document.getElementById('request-delete-desc').textContent =
    `「${filename}」の投稿者（${ownerNickname || '投稿者'}さん）に削除の確認が必要です。理由を書いて送信すると、投稿者にDiscordで確認が届きます。`;
  document.getElementById('request-delete-reason').value = '';
  const errEl = document.getElementById('request-delete-err');
  errEl.style.display = 'none';
  const btn = document.getElementById('request-delete-submit-btn');
  btn.disabled = false; btn.textContent = '送信する';
  document.getElementById('modal-request-delete').classList.add('open');
}

async function submitRequestDelete() {
  const session = requireLoginOrRedirect();
  if (!session) return;
  if (!requestDeleteFilename) return;
  const reason = document.getElementById('request-delete-reason').value.trim();
  const errEl = document.getElementById('request-delete-err');
  errEl.style.display = 'none';
  if (!reason) {
    errEl.textContent = '理由を入力してください';
    errEl.style.display = 'block';
    return;
  }
  const btn = document.getElementById('request-delete-submit-btn');
  btn.disabled = true;
  btn.textContent = '送信中…';
  try {
    const res = await api('/request_delete', {
      method: 'POST',
      body: JSON.stringify({
        guild_id: GUILD_ID, session_token: session.session_token,
        category: 'notice', filename: requestDeleteFilename, reason,
      }),
    });
    if (!res.ok) throw new Error(res.error || '送信に失敗しました');
    closeNoticeModal('request-delete');
    closeNoticeModal('view');
    showAppAlert({
      icon: Icons.html('mailSent', {size:18}),
      title: '削除の確認を送りました',
      desc: res.notified_via === 'web_pending'
        ? '投稿者がDiscord未連携のため、次回サイトを開いたときに確認されます。'
        : '投稿者にDiscordで確認を送りました。承認されると削除されます。',
    });
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '送信する';
    errEl.textContent = e.message;
    errEl.style.display = 'block';
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
  const session = requireLoginOrRedirect();
  if (!session) return;
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
    const overwriteOk = await showAppConfirm({
      title: '上書きしますか？',
      desc: `「${filename}」という名前のお知らせは既に存在します。\n上書きしてもよろしいですか？`,
      okLabel: '上書きする', danger: true,
    });
    if (!overwriteOk) return;
  }

  const uploader = session.nickname;

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
      body: JSON.stringify({ filename, content, uploader, guild_id: GUILD_ID, session_token: session.session_token })
    });
    btn.disabled = false;
    btn.textContent = btnLabel;
    if (res.ok) {
      // ★ 編集でファイル名（タイトル）が変更された場合は、新しい名前で保存した後に古いファイルを削除して「移動」を完成させる
      if (editing && editingOriginalFilename && editingOriginalFilename !== filename) {
        try {
          await api('/delete_notice', {
            method: 'POST',
            body: JSON.stringify({ guild_id: GUILD_ID, session_token: session.session_token, filename: editingOriginalFilename, nickname: uploader })
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
  el.innerHTML = Icons.html('close', {size:14}) + ' ' + String(msg).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
//  ★ リアルタイム更新（Server-Sent Events）
//  ─────────────────────────────
//  以前は初回読み込み時にしか一覧を取得しておらず、他の人がお知らせを
//  追加・編集・削除しても、ページを開き直すまで反映されなかった。
//  サーバーが実際に常時稼働しているので、変更があった瞬間にpushで
//  知らせてもらい、その場で一覧だけ静かに更新し直す。編集中のフォームや
//  開いているプレビューモーダルはそのまま触らない（一覧の再描画だけ行う）。
//  ・SSE接続が切れていた場合に備え、10秒間隔のフォールバックポーリングも残す。
// ============================================================
async function digestMessage(message) {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

let lastNoticesHash = null;

async function checkNoticesUpdate() {
  try {
    const session = getLoginSession();
    const res = await fetch(`${API_BASE}list_notices?guild_id=${GUILD_ID}`, {
      cache: 'no-store',
      headers: session?.session_token ? { 'Authorization': 'Bearer ' + session.session_token } : {},
    });
    const txt = await res.text();
    const hash = await digestMessage(txt);

    // 初回は保存だけ
    if (lastNoticesHash === null) { lastNoticesHash = hash; return; }
    // ハッシュが変わっていなければ何もしない
    if (hash === lastNoticesHash) return;
    lastNoticesHash = hash;

    let data;
    try { data = JSON.parse(txt); } catch (e) { return; }
    if (!data.ok) return;
    notices = data.notices;
    renderNotices();
  } catch (e) {}
}

function startRealtimeUpdates() {
  try {
    const es = new EventSource(`${API_BASE}events?guild_id=${GUILD_ID}`);
    es.onmessage = () => { checkNoticesUpdate(); };
  } catch (e) {
    // EventSource非対応環境などでも、下のフォールバックポーリングだけで動作を継続できる
  }
}

// ★ 通常はSSEで即時反映される。これは接続が切れた場合の保険（10秒間隔）
setInterval(checkNoticesUpdate, 10000);

// ============================================================
//  ドロワー（他ページと共通の挙動）
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
    '/Plan.js',
    '/Timetable.js',
    '/Cardmaker.js', '/Cardmaker.css',
    '/StudyLog.js', '/StudyLog.css',
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

// ★ ここまでエラーなく実行できた＝JSが生きている合図として、<body>先頭の
//   「読み込み中…」代替表示（js-fail-fallback、Icons.js参照）を消す。
hideLoadingFallback();
