// ============================================================
//  サービス情報ページ
//  → 現状は静的なアップデート履歴を表示するだけなので、
//    ドロワー（他ページと共通の挙動）の開閉のみ実装
// ============================================================

// ★ このページ自体は閲覧にログイン不要（利用者11人の小規模運用のため、
//   このページの他の情報と同じ扱い）。ドロワー下部に「だれとしてログイン
//   しているか」を表示するためだけに、他ページと同じ sl_session を読む
//  （2026/08/19追加）。
const SESSION_KEY = 'sl_session';
const LOGIN_PATH = '/Login.html';
function getLoginSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}
// ★ ドロワー下部の「だれとしてログインしているか」表示。StudyLog.jsの
//   ヘッダーアバターと同じ見た目（色付き丸アバター＋ニックネーム）。
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
    '/Notice.js',
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
// ★ 追加：このページは静的なので読み込み待ちが無く、メニューを開くのを
//   待たずにスクリプト実行時点（＝ページ表示直後）で他ページを裏で先読みする。
prefetchOtherPages();

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
//  タブ切り替え（🤖 Bot / 🌐 Web / 🗂️ 運用ログ）
//  ・3つのカードを全部並べると縦にとても長くなるため、1つだけ表示する。
// ============================================================
function switchServiceTab(tab) {
  document.querySelectorAll('.service-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.service-tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.tabPanel === tab);
  });
  // ★ 運用ログタブを開いたタイミングで最新の内容に更新しておく
  if (tab === 'log') loadSystemLog();
}

// ============================================================
//  運用ログ（system_log） — bot.py側のprint出力の一部を、見やすい形でWebにも表示する
//  ・バックアップ実行結果・予定/時間割/カード/お知らせ等の変更を、
//    1つの操作＝1件のイベントとしてサーバー側でまとめて記録したもの。
//  ・ログインしていなくても閲覧できる（利用者11人の小規模運用のため、
//    このページの他の情報と同じ扱いにしている）。ただし、対象サーバーに
//    参加していない制限付きアカウントでログイン中の場合だけは見せない
//    （2026/08/20）。そのためログイン中はsession_tokenを一緒に送る。
// ============================================================
const API_BASE = "/api/";
const GUILD_ID  = '1509880344806162544';
const LOG_CATEGORY_ICON = {
  backup:    Icons.html('save', {size:15}),
  schedule:  Icons.html('plan', {size:15}),
  timetable: Icons.html('timetable', {size:15}),
  card:      Icons.html('cardmaker', {size:15}),
  study:     Icons.html('studylog', {size:15}),
  notice:    Icons.html('notice', {size:15}),
  task:      Icons.html('checkCircle', {size:15}),
  user:      Icons.html('person', {size:15}),
};
let logDisplayCount = 50; // ★「もっと見る」を押すたびに増やして再取得する（件数自体は多くないため単純な方式でよい）

function renderLogEntry(entry) {
  const li = document.createElement('li');
  li.className = 'log-item' + (entry.level === 'error' ? ' is-error' : '');

  const icon = document.createElement('span');
  icon.className = 'log-item-icon';
  icon.innerHTML = LOG_CATEGORY_ICON[entry.category] || Icons.html('tools', {size:15});

  const body = document.createElement('div');
  body.className = 'log-item-body';

  // ★ entry.detail は [{file, diff}, ...] 形式（bot.py側のfile_diff()が作る。
  //   fileは実際のデータファイルのパス、diffはGitHubのコミットのような
  //   +/-形式のテキスト）。要約文の横に開閉矢印を出し、行全体をタップすると
  //   詳細を展開できるようにする。detail が無いエントリはタップ不可のまま。
  const detailFiles = Array.isArray(entry.detail) ? entry.detail.filter(f => f && f.diff) : [];
  const hasDetail = detailFiles.length > 0;

  const summary = document.createElement('div');
  summary.className = 'log-item-summary';

  const summaryText = document.createElement('span');
  summaryText.className = 'log-item-summary-text';
  summaryText.textContent = entry.summary || '';
  summary.appendChild(summaryText);

  if (hasDetail) {
    const chevron = document.createElement('span');
    chevron.className = 'log-item-chevron';
    chevron.textContent = '▸';
    summary.appendChild(chevron);
  }

  // ★ 追加：日時（左）と実行者（右下）を1行に並べる。実行者が無い場合
  //   （バックアップ等サーバー主導の処理）は日時だけを表示する。
  const footer = document.createElement('div');
  footer.className = 'log-item-footer';

  const time = document.createElement('span');
  time.className = 'log-item-time';
  time.textContent = (entry.time || '').replace('T', ' ');
  footer.appendChild(time);

  if (entry.actor) {
    const actor = document.createElement('span');
    actor.className = 'log-item-actor';
    actor.textContent = entry.actor;
    footer.appendChild(actor);
  }

  body.appendChild(summary);
  body.appendChild(footer);

  if (hasDetail) {
    const detail = document.createElement('div');
    detail.className = 'log-item-detail';
    detailFiles.forEach(f => detail.appendChild(renderLogFileBlock(f)));
    body.appendChild(detail);

    li.classList.add('is-expandable');
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-expanded', 'false');
    const toggle = () => {
      const open = li.classList.toggle('is-open');
      li.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    li.addEventListener('click', toggle);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  }

  li.appendChild(icon);
  li.appendChild(body);
  return li;
}

// ★ 1ファイル分の差分ブロックを作る（GitHubのコミット画面の
//   「変更されたファイル」表示と同じ考え方）。file名があればファイル名を
//   見出しにして、その見出しをタップするとそのファイルだけ開閉できる
//   （2026/08/19、ユーザーの要望により既定を「閉じた状態」に変更。
//   タップして初めて+/-の差分行が見える）。file名が無い（削除依頼の
//   理由等、対象がファイル1つに対応しない）場合は見出し（＝開閉の
//   きっかけ）自体が無いため、常に中身を表示したままにする。
function renderLogFileBlock(f) {
  const wrap = document.createElement('div');
  wrap.className = 'log-item-file';

  if (f.file) {
    wrap.classList.add('is-collapsed'); // ★ 既定は閉じた状態
    const header = document.createElement('div');
    header.className = 'log-item-file-header';

    const chevron = document.createElement('span');
    chevron.className = 'log-item-file-chevron';
    chevron.textContent = '▾';
    header.appendChild(chevron);

    const name = document.createElement('span');
    name.className = 'log-item-file-name';
    name.textContent = f.file;
    header.appendChild(name);

    // ★ 追加：ファイル自体を新規作成/削除した場合はバッジを添える
    //   （GitHubの「new file」「deleted」表示と同じ考え方）。既存ファイルの
    //   中身を書き換えただけ（status: "modified"）の場合は何も付けない。
    if (f.status === 'added' || f.status === 'deleted') {
      const badge = document.createElement('span');
      badge.className = 'log-item-file-badge is-' + (f.status === 'added' ? 'add' : 'del');
      badge.textContent = f.status === 'added' ? '新規作成' : '削除';
      header.appendChild(badge);
    }

    header.addEventListener('click', (e) => {
      e.stopPropagation(); // ★ 親（ログ行全体の開閉）に伝播させない
      wrap.classList.toggle('is-collapsed');
    });
    wrap.appendChild(header);
  }

  const lines = document.createElement('div');
  lines.className = 'log-item-file-lines';
  String(f.diff).split('\n').forEach(line => {
    const lineEl = document.createElement('div');
    if (line.startsWith('+ ')) {
      lineEl.className = 'log-item-diff-line is-add';
      lineEl.textContent = line.slice(2);
    } else if (line.startsWith('- ')) {
      lineEl.className = 'log-item-diff-line is-del';
      lineEl.textContent = line.slice(2);
    } else {
      lineEl.className = 'log-item-diff-line';
      lineEl.textContent = line;
    }
    lines.appendChild(lineEl);
  });
  wrap.appendChild(lines);

  return wrap;
}

async function loadSystemLog() {
  const listEl = document.getElementById('log-list');
  const btn = document.getElementById('log-refresh-btn');
  if (btn) btn.classList.add('is-loading');
  // ★ 前回描画時の「もっと見る」ボタン（<ul>の外、カード内に追加している）が
  //   残ったまま重複しないよう、再読み込みのたびに一旦取り除く
  const oldMore = listEl.parentElement.querySelector('.log-load-more');
  if (oldMore) oldMore.remove();
  try {
    // ★ ログイン中なら guild_id + session_token も送る（制限付きアカウントの場合
    //   サーバー側で弾かれる。未ログインなら従来通り誰でも閲覧できる）。
    const session = getLoginSession();
    let url = `${API_BASE}system_log?limit=${logDisplayCount}`;
    const headers = {};
    if (session && session.session_token) {
      url += `&guild_id=${GUILD_ID}`;
      headers['Authorization'] = `Bearer ${session.session_token}`;
    }
    const res = await fetch(url, { cache: 'no-store', headers });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'unknown error');

    listEl.innerHTML = '';
    if (!data.entries || data.entries.length === 0) {
      const li = document.createElement('li');
      li.className = 'log-empty';
      li.textContent = 'まだログがありません。';
      listEl.appendChild(li);
      return;
    }
    data.entries.forEach(entry => listEl.appendChild(renderLogEntry(entry)));

    // ★ 取得件数が要求件数と同じ＝まだ続きがあるかもしれない、という簡易判定
    //   （サーバー側はoffsetに対応していないため、「もっと見る」は取得件数を
    //   増やして丸ごと再取得する単純な方式にしている。件数上限が300件程度の
    //   小規模運用なので、これで十分速い）。
    if (data.entries.length >= logDisplayCount) {
      const more = document.createElement('button');
      more.className = 'log-load-more';
      more.textContent = 'もっと見る';
      more.onclick = () => { logDisplayCount += 50; loadSystemLog(); };
      listEl.parentElement.appendChild(more);
    }
  } catch (e) {
    listEl.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'log-error';
    li.textContent = 'ログを読み込めませんでした。';
    listEl.appendChild(li);
  } finally {
    if (btn) btn.classList.remove('is-loading');
  }
}

loadSystemLog();

// ★ ここまでエラーなく実行できた＝JSが生きている合図として、<body>先頭の
//   「読み込み中…」代替表示（js-fail-fallback、Icons.js参照）を消す。
hideLoadingFallback();
