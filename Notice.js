/*@ver*/(window.__jsVer=window.__jsVer||{})["Notice.js"]="cb8245a03f";/*@end*/// ============================================================
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
const LOGIN_PATH = '/Login.html'; // ★ Cardmaker.js と同じ基準のログインページパス

let notices = [];
let currentViewFilename = null;
let currentViewContent = null;
let isEditingNotice = false;
let editingOriginalFilename = null; // 編集開始時点のファイル名（リネーム検知用）
let pendingDraft = null;            // 復元候補の下書き（バナー表示中に保持）
let draftSaveTimer = null;
// ★ 複数サーバー対応：以前はguildを問わない共通キーだったため、
//   別サーバーに切り替えても他サーバーの下書きが「続きから書く？」に
//   出てきてしまっていた。キーにGUILD_IDを含めるよう修正。
// ★ 修正（不具合修正、2026/08/26）：Cardmaker.js等では移行処理
//   （migrateGuildScopedLocalKey、旧キーの中身を新キーへコピーする）を
//   入れていたが、Notice.jsでは入れ忘れていた。既にこのキー変更以前から
//   下書きを保存していた利用者は、「続きから書く？」バナーが二度と
//   出なくなっていた（データ自体はlocalStorageに残るが、新しい
//   GUILD_ID付きキーでしか読まなくなったため参照できないだけ＝
//   Cardmaker.jsの移行漏れ不具合と同じ原因）。
//   ★ GUILD_IDがまだ確定していない端末（current_guild未設定、この後
//   Login.htmlへ転送される）では移行しない（GUILD_IDが文字列"null"に
//   なってしまい、誤ったキーへ移行＆元データ削除してしまうため）。
function _migrateNoticeDraftKey(oldKey, newKey) {
  if (!GUILD_ID) return;
  try {
    if (localStorage.getItem(newKey) === null && localStorage.getItem(oldKey) !== null) {
      localStorage.setItem(newKey, localStorage.getItem(oldKey));
      localStorage.removeItem(oldKey);
    }
  } catch (e) {}
}
const DRAFT_KEY_NEW = 'notice_draft_new_' + GUILD_ID;
_migrateNoticeDraftKey('notice_draft_new', DRAFT_KEY_NEW);

// ★ OS標準のconfirm()/alert()の代替（showAppConfirm/showAppAlert）は
//   全ページ共通の /Dialog.js に移した（Notice.html側で読み込み済み）。

// ── ログインセッション（Login.js / Cardmaker.js と共通） ──────
const SESSION_KEY = 'sl_session';
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
// ★ 追加：ドロワー下部に「だれとしてログインしているか」を表示する（2026/08/19）
//   StudyLog.jsのヘッダーアバターと同じ見た目（色付き丸アバター＋ニックネーム）。
//   タップでミニメニュー（アカウント設定／ログアウト）を開閉する。
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

function legacyCopyText(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.readOnly = true;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;font-size:16px';
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

/** コードブロック(pre)をタップするとクリップボードへコピーできるようにする */
function setupCodeCopy(pre) {
  pre.classList.add('code-copyable');
  pre.title = 'タップでコピー';
  // バッジは横スクロールするpreの外（外枠）に置き、スクロールについてこないようにする
  const wrap = document.createElement('div');
  wrap.className = 'code-wrap';
  pre.parentNode.insertBefore(wrap, pre);
  wrap.appendChild(pre);
  const badge = document.createElement('span');
  badge.className = 'code-copy-badge';
  badge.textContent = 'コピー';
  wrap.appendChild(badge);
  pre.addEventListener('click', async () => {
    // バッジ以外の本文だけを取り出す（生HTMLの<pre>でもバッジ文字が混ざらないように）
    const text = pre.innerText || pre.textContent; // 見えている文字だけをコピー
    let ok = false;
    // iOS等ではawait後だとexecCommandが拒否されるため、先に同期のフォールバックを使う
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      ok = legacyCopyText(text);
    } else {
      try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { ok = legacyCopyText(text); }
    }
    badge.textContent = ok ? 'コピーしました' : 'コピー失敗';
    clearTimeout(badge._t);
    badge._t = setTimeout(() => { badge.textContent = 'コピー'; }, 1500);
  });
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
    // 改行コードを揃える（\r\n だと ``` の行判定が崩れる環境があるため）
    const rawHtml = marked.parse(String(content).replace(/\r\n?/g, '\n'), { breaks: true, gfm: true });
    bodyEl.innerHTML = DOMPurify.sanitize(rawHtml);
    bodyEl.querySelectorAll('pre').forEach(setupCodeCopy);
  } else {
    bodyEl.classList.remove('markdown-body');
    bodyEl.classList.add('notice-plain');
    bodyEl.textContent = content;
  }
}

// ============================================================
//  プレビュー（アップロード／編集モーダル内）
// ============================================================
/** プレビュー表示中に内容・ファイル名が変わったら（ファイル選択・下書き復元など）プレビューを描き直す */
function refreshNoticePreviewIfOpen() {
  const previewBtn = document.getElementById('tab-preview-btn');
  if (previewBtn && previewBtn.classList.contains('active')) switchNoticeTab('preview');
}

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
    renderNoticeBody(previewEl, filename || 'preview.md', expandNoticeImages(content) || '（内容がありません）');
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
  const key = 'notice_draft_edit_' + GUILD_ID + '_' + originalFilename;
  // ★ 修正：DRAFT_KEY_NEWと同じ移行漏れ（旧キー 'notice_draft_edit_' + originalFilename）。
  //   呼ばれるたびに（該当ファイルの下書きが無ければ何もしないので軽い）移行を試みる。
  _migrateNoticeDraftKey('notice_draft_edit_' + originalFilename, key);
  return key;
}

function scheduleDraftSave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveDraftNow, 600);
}

function saveDraftNow() {
  const filename = document.getElementById('upload-filename').value;
  const rawContent = document.getElementById('upload-content').value;
  const content = rawContent;
  const statusEl = document.getElementById('draft-status');

  if (!filename.trim() && !content.trim()) return; // 空なら保存しない

  const key = isEditingNotice ? draftKeyForEdit(editingOriginalFilename) : DRAFT_KEY_NEW;
  // 画像入りは数MBになり localStorage（他機能と共用）を圧迫するため、下書き保存しない
  if (expandNoticeImages(rawContent) !== rawContent || /data:image\//.test(rawContent) || rawContent.length > 200000) {
    try { localStorage.removeItem(key); } catch (e) {}
    statusEl.textContent = '画像を含むお知らせは下書き自動保存の対象外です';
    return;
  }
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
  setBtnBusy(btn, true, '削除中…');
  try {
    const res = await api('/delete_notice', {
      method: 'POST',
      body: JSON.stringify({ guild_id: GUILD_ID, session_token: session.session_token, filename: currentViewFilename, nickname: session.nickname })
    });
    setBtnBusy(btn, false);
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
    setBtnBusy(btn, false);
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
  setBtnBusy(btn, false); btn.disabled = false; btn.textContent = '送信する';
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
  setBtnBusy(btn, true, '送信中…');
  try {
    const res = await api('/request_delete', {
      method: 'POST',
      body: JSON.stringify({
        guild_id: GUILD_ID, session_token: session.session_token,
        category: 'notice', filename: requestDeleteFilename, reason,
      }),
    });
    if (!res.ok) throw new Error(res.error || '送信に失敗しました');
    setBtnBusy(btn, false);
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
    setBtnBusy(btn, false);
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
  noticeImages = {};
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
  noticeImages = {};
  document.getElementById('upload-content').value = /\.md$/i.test(currentViewFilename) ? collapseNoticeImages(currentViewContent || '') : (currentViewContent || '');
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
  refreshNoticePreviewIfOpen();
}

function onContentInput() {
  clearNoticeBugHighlight();
  scheduleDraftSave();
}

// ============================================================
//  画像の添付（本文のMarkdownに data URI として埋め込む）
//  ・編集中のテキスト欄には短い目印 `![名前](img:ID)` だけを置き、実データは
//    noticeImages に保持する（巨大なbase64で入力欄が重くならないように）。
//  ・プレビュー・投稿の時だけ実データに展開する（画像入りは下書き保存しない）。
// ============================================================
let noticeImages = {};            // ID → data URI
const NOTICE_IMG_MAX_SIDE = 1280; // 長辺の上限px（超えたら縮小）
const NOTICE_IMG_MAX_TOTAL = 6000000; // 本文全体（画像込み）の上限文字数（サーバー側と同値）

function expandNoticeImages(text) {
  return String(text || '').replace(/\]\(img:(\w+)\)/g, (m, id) => noticeImages[id] ? '](' + noticeImages[id] + ')' : m);
}

function collapseNoticeImages(text) {
  return String(text || '').replace(/\]\((data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+\/=]+)\)/g, (m, uri) => {
    let id = Object.keys(noticeImages).find(k => noticeImages[k] === uri);
    if (!id) { id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); noticeImages[id] = uri; }
    return '](img:' + id + ')';
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** 画像ファイルを長辺NOTICE_IMG_MAX_SIDE以内に縮小し、JPEGのdata URIにする（透過PNGは白背景になる） */
async function compressNoticeImage(file) {
  const src = await readFileAsDataURL(file);
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('decode'));
    im.src = src;
  });
  const scale = Math.min(1, NOTICE_IMG_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.8);
}

async function onNoticeImagesSelected(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  const filename = document.getElementById('upload-filename').value.trim();
  if (/\.txt$/i.test(filename)) {
    showNoticeErr('upload-err', '画像は .md のお知らせでのみ使えます（ファイル名を .md にしてください）');
    return;
  }
  const ta = document.getElementById('upload-content');
  for (const file of files) {
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) {
      showNoticeErr('upload-err', `「${file.name}」は対応していない形式です（JPEG/PNG/WebP/GIF）`);
      continue;
    }
    try {
      const uri = await compressNoticeImage(file);
      const id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      noticeImages[id] = uri;
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\[\]()]/g, '');
      const tag = `![${alt}](img:${id})`;
      const pos = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
      const before = ta.value.slice(0, pos), after = ta.value.slice(pos);
      const pre = before && !before.endsWith('\n') ? '\n\n' : '';
      ta.value = before + pre + tag + '\n\n' + after;
      ta.selectionStart = ta.selectionEnd = (before + pre + tag + '\n\n').length;
    } catch (err) {
      showNoticeErr('upload-err', `「${file.name}」を読み込めませんでした`);
    }
  }
  onContentInput();
  refreshNoticePreviewIfOpen();
}

function onLocalFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  const nameEl = document.getElementById('upload-filename');
  if (!nameEl.value.trim()) nameEl.value = file.name;

  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('upload-content').value = /\.md$/i.test(file.name) ? collapseNoticeImages(reader.result) : reader.result;
    refreshNoticePreviewIfOpen();
  };
  reader.readAsText(file, 'utf-8');
}

// サーバー（bot.py の find_bug_chars）と同じ判定基準
function isNoticeBugChar(cp) {
  if (cp === 0x200D || (cp >= 0xFE00 && cp <= 0xFE0F) || (cp >= 0xE0100 && cp <= 0xE01EF)) return false;
  if (cp < 0x20) return cp !== 9 && cp !== 10 && cp !== 13;
  if (cp === 0x7F || cp === 0xFFFE || cp === 0xFFFF || cp === 0x00AD || cp === 0x180E || cp === 0xFEFF) return true;
  return (cp >= 0xD800 && cp <= 0xDFFF) || (cp >= 0xE000 && cp <= 0xF8FF) || (cp >= 0xFDD0 && cp <= 0xFDEF)
      || (cp >= 0x200B && cp <= 0x200C) || (cp >= 0x2060 && cp <= 0x2064) || (cp >= 0x2066 && cp <= 0x2069)
      || (cp >= 0x202A && cp <= 0x202E) || (cp >= 0xE0000 && cp <= 0xE007F);
}
function findNoticeBugChars(str) {
  const counts = new Map();
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (isNoticeBugChar(cp)) counts.set(cp, (counts.get(cp) || 0) + 1);
  }
  return [...counts].map(([cp, count]) => ({ cp, count }));
}
function stripNoticeBugChars(str) {
  let out = '';
  for (const ch of String(str)) if (!isNoticeBugChar(ch.codePointAt(0))) out += ch;
  return out;
}

// 自動削除を断られたとき、混ざっている文字の位置を本文の下にハイライト表示し、最初の1つを選択状態にする
function clearNoticeBugHighlight() {
  const p = document.getElementById('upload-bug-panel');
  if (p) p.remove();
}
function showNoticeBugHighlight(content) {
  clearNoticeBugHighlight();
  const ta = document.getElementById('upload-content');
  const panel = document.createElement('div');
  panel.id = 'upload-bug-panel';
  panel.style.cssText = 'margin-top:8px;padding:10px 12px;border:1px solid #fca5a5;background:#fef2f2;border-radius:8px;font-size:13px;line-height:1.7;color:#7f1d1d;';
  const head = document.createElement('div');
  head.style.cssText = 'font-weight:600;margin-bottom:4px;';
  head.textContent = '見えない文字の場所（赤い部分）。消して打ち直してください';
  panel.appendChild(head);

  let firstIdx = -1, shown = 0, total = 0, idx = 0;
  content.split('\n').forEach((line, li) => {
    const chars = Array.from(line);
    chars.forEach((ch, ci) => {
      const cp = ch.codePointAt(0);
      if (isNoticeBugChar(cp)) {
        total++;
        if (firstIdx < 0) firstIdx = idx + chars.slice(0, ci).join('').length;
        if (shown < 8) {
          shown++;
          const row = document.createElement('div');
          row.style.cssText = 'font-family:ui-monospace,Menlo,Consolas,monospace;word-break:break-all;';
          row.appendChild(document.createTextNode(`${li + 1}行目: …${chars.slice(Math.max(0, ci - 12), ci).join('')}`));
          const mark = document.createElement('mark');
          mark.style.cssText = 'background:#dc2626;color:#fff;padding:0 4px;border-radius:4px;margin:0 2px;';
          mark.textContent = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
          row.appendChild(mark);
          row.appendChild(document.createTextNode(`${chars.slice(ci + 1, ci + 13).join('')}…`));
          panel.appendChild(row);
        }
      }
    });
    idx += line.length + 1;
  });
  if (total > shown) {
    const more = document.createElement('div');
    more.textContent = `ほか${total - shown}件`;
    panel.appendChild(more);
  }
  ta.insertAdjacentElement('afterend', panel);
  if (firstIdx >= 0) {
    ta.focus();
    ta.setSelectionRange(firstIdx, firstIdx + 1);
  }
}

async function submitUpload() {
  const session = requireLoginOrRedirect();
  if (!session) return;
  const filename = document.getElementById('upload-filename').value.trim();
  let content    = document.getElementById('upload-content').value;

  if (!filename) { showNoticeErr('upload-err', 'ファイル名を入力してください'); return; }
  if (!/\.(md|txt)$/i.test(filename)) { showNoticeErr('upload-err', 'ファイル名は .md か .txt にしてください'); return; }
  if (!content.trim()) { showNoticeErr('upload-err', '内容が空です'); return; }

  // ★ 目に見えない文字・制御文字が混ざっていたら、投稿前に警告して自動削除を選べるようにする
  //   （サーバー側でも同じ基準で弾くため、ここで先に整えておく。ZWJ・異体字セレクタは許可）
  const bugs = findNoticeBugChars(content);
  if (bugs.length) {
    const list = bugs.map(b => `U+${b.cp.toString(16).toUpperCase().padStart(4, '0')}（${b.count}個）`).join('、');
    const ok = await showAppConfirm({
      title: '見えない文字が含まれています',
      desc: `本文に画面では見えない特殊な文字が混ざっています。\n${list}\n\nコピー元から紛れ込んだ可能性があります。自動で削除して投稿しますか？`,
      okLabel: '削除して投稿',
    });
    if (!ok) { showNoticeBugHighlight(content); return; }
    clearNoticeBugHighlight();
    content = stripNoticeBugChars(content);
    document.getElementById('upload-content').value = content;
    refreshNoticePreviewIfOpen();
    if (!content.trim()) { showNoticeErr('upload-err', '内容が空です'); return; }
  }

  // ★ 画像の目印を実データ（data URI）に戻して送る
  const sendContent = expandNoticeImages(content);
  if (sendContent !== content && /\.txt$/i.test(filename)) { showNoticeErr('upload-err', '画像は .md のお知らせでのみ使えます'); return; }
  if (sendContent.length > NOTICE_IMG_MAX_TOTAL) { showNoticeErr('upload-err', '画像が大きすぎます。枚数を減らしてください'); return; }

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
      body: JSON.stringify({ filename, content: sendContent, uploader, guild_id: GUILD_ID, session_token: session.session_token })
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
        currentViewContent = sendContent;
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
  setTimeout(() => el.style.display = 'none', Math.max(4000, String(msg).length * 150));
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
  // ★ SSE接続・保険のポーリング・非表示中の停止は Common.js の startLiveUpdates() に
  //   まとめた（SSEがつながっている間のポーリングは60秒に1回、切れている間は10秒に1回。
  //   タブが見えていない間は取得せず、見える状態に戻った瞬間に1回チェックする）。
  startLiveUpdates(checkNoticesUpdate);
  // （以前はここで EventSource を直接作り、下で10秒ごとの setInterval を回していた。
  //   取得の中身＝各チェック関数は変えていない）
}

// ★ 通常はSSEで即時反映される。接続が切れた場合の保険のポーリングも
//   startLiveUpdates() の中で行う（以前はここで10秒ごとの setInterval を回していた）。

// ============================================================
//  ドロワー（他ページと共通の挙動）
// ============================================================
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
    link.href = href + (window.APP_VERSION ? '?v=' + encodeURIComponent(window.APP_VERSION) : '');   // 版付きURLでないと実際の読み込みと一致せず先読みが無駄になる
    document.head.appendChild(link);
  });
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
