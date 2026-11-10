/*@ver*/(window.__jsVer=window.__jsVer||{})["Common.js"]="045bdb9afd";/*@end*/// ============================================================
//  Common.js — 複数ページで同一だった共通関数（ログインセッション・ドロワー等）
//  ★ 関数宣言のみ。SESSION_KEY / LOGIN_PATH / prefetchOtherPages は
//    各ページのJS側で定義されたものを呼び出し時に参照する。
//    const/let の新規宣言は、各ページと名前が衝突するのでここには置かないこと。
//    ページ固有の版（StudyLog.js・TanCheck.js の openDrawer 等、Cardmaker.js・
//    StudyLog.js・TanCheck.js の renderDrawerAccount）は各ページに残してある。
// ============================================================
function getLoginSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

async function digestMessage(message) {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
  prefetchOtherPages(); // ★ 追加：メニューを開いた瞬間に他ページを裏で先読み
}

function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}

function requireLoginOrRedirect() {
  const s = getLoginSession();
  if (!s || !s.session_token) {
    sessionStorage.setItem('post_login_redirect', location.href);
    location.href = LOGIN_PATH;
    return null;
  }
  return s;
}

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
    const ok = await showAppConfirm({ title: 'ログアウトしますか？', okLabel: 'ログアウト', danger: true });
    if (!ok) return;
    localStorage.removeItem(SESSION_KEY);
    location.href = LOGIN_PATH;
  });
  menu.appendChild(logoutBtn);

  el.appendChild(btn);
  el.appendChild(menu);
}

// ============================================================
//  エラーの自動通知（管理者へ）— 2026/11/08 追加
//  ─────────────────────────────────────────────
//  サーバーに届かなかった通信失敗・JSONでない応答を検知したら、
//  /api/report_error へ「どのページの・どのAPIが・どのエラーコードで」失敗したかと、
//  直近のJSエラー・直近の失敗履歴を送る。サーバー側が連番を振って保存し、
//  管理者のDiscord DMへ通知する（同じ失敗の連打は同一番号にまとめられる）。
//  ・session_token／Cookie／入力内容は送らない（Authorizationヘッダは「誰か」を
//    サーバーが引くためだけに付け、保存はされない）。
//  ・この関数自体の失敗は握りつぶす（報告のせいで画面が壊れてはいけない）。
//  ・関数宣言／var のみ（各ページの const と名前が衝突しないように）。
// ============================================================
var __rptSeen = {};
var __rptRecent = [];
var __rptFirstJsErr = '';
window.addEventListener('error', function (e) {
  if (__rptFirstJsErr) return;
  var t = (e.target && e.target.src) ? ('読込失敗: ' + e.target.src)
        : ((e.message || '') + ' @' + String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0));
  __rptFirstJsErr = t.slice(0, 200);
}, true);

function reportApiError(path, errorCode, status, extra) {
  try {
    var p = String(path || '').replace(/^\/+/, '').split('?')[0];
    if (!p || p === 'report_error' || errorCode === 'not_logged_in') return;
    __rptRecent.push(p + ':' + errorCode);
    if (__rptRecent.length > 5) __rptRecent.shift();
    var key = p + '|' + errorCode;
    if (__rptSeen[key]) return;            // 同じページ表示中の同じ失敗は1回だけ
    __rptSeen[key] = 1;
    var gid = null;
    try { gid = (typeof GUILD_ID !== 'undefined') ? GUILD_ID : null; } catch (e) {}
    if (!gid) return;
    var headers = { 'Content-Type': 'application/json' };
    var s = null;
    try { s = getLoginSession(); } catch (e) {}
    if (s && s.session_token) headers['Authorization'] = 'Bearer ' + s.session_token;
    var diag = [];
    if (__rptFirstJsErr) diag.push('最初のJSエラー: ' + __rptFirstJsErr);
    if (extra) diag.push(String(extra).slice(0, 200));
    diag.push('直近の失敗: ' + __rptRecent.join(', '));
    fetch('/api/report_error', {
      method: 'POST', headers: headers, keepalive: true,
      body: JSON.stringify({
        guild_id: gid,
        page: (location.pathname || '/').slice(0, 40),
        api: p, error: String(errorCode || 'unknown'), status: status || 0,
        diag: diag.join(' / ').slice(0, 900),
      }),
    }).catch(function () {});
  } catch (e) { /* 報告の失敗は無視 */ }
}
