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
function getLoginSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function renderDrawerAccount() {
  const el = document.getElementById('drawer-account');
  if (!el) return;
  el.innerHTML = '';
  const s = getLoginSession();
  if (s && s.session_token && s.nickname) {
    const name = document.createElement('div');
    name.className = 'drawer-account-name';
    name.textContent = `👤 ${s.nickname}`;
    el.appendChild(name);
  } else {
    const link = document.createElement('a');
    link.className = 'drawer-account-login-link';
    link.href = '/Login.html';
    link.textContent = 'ログインしていません';
    el.appendChild(link);
  }
}
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
//    このページの他の情報と同じ扱いにしている）。
// ============================================================
const API_BASE = "https://chiro-ubuntuserver.tail1130ba.ts.net/";
const LOG_CATEGORY_ICON = {
  backup:    '💾',
  schedule:  '📘',
  timetable: '📒',
  card:      '📇',
  study:     '📊',
  notice:    '📢',
  task:      '✅',
  user:      '👤',
};
let logDisplayCount = 50; // ★「もっと見る」を押すたびに増やして再取得する（件数自体は多くないため単純な方式でよい）

function renderLogEntry(entry) {
  const li = document.createElement('li');
  li.className = 'log-item' + (entry.level === 'error' ? ' is-error' : '');

  const icon = document.createElement('span');
  icon.className = 'log-item-icon';
  icon.textContent = LOG_CATEGORY_ICON[entry.category] || '🛠️';

  const body = document.createElement('div');
  body.className = 'log-item-body';

  // ★ 追加：具体的に何が変更されたか（entry.detail）がある場合、要約文の
  //   横に開閉矢印を出し、行全体をタップすると詳細を展開できるようにする。
  //   detail が無いエントリ（従来通り）はタップ不可のまま。
  const hasDetail = !!(entry.detail && String(entry.detail).trim());

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
    // ★ 追加：detailが「+ 追加された内容」「- 削除された内容」形式の行を
    //   含む場合、GitHubのコミット差分のように行ごとに色分け表示する
    //   （bot.py側のdiff_cards/_text_diff_linesが生成する形式）。
    //   どちらでもない行（例：「…ほかN件」）はそのまま表示する。
    String(entry.detail).split('\n').forEach(line => {
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
      detail.appendChild(lineEl);
    });
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

async function loadSystemLog() {
  const listEl = document.getElementById('log-list');
  const btn = document.getElementById('log-refresh-btn');
  if (btn) btn.classList.add('is-loading');
  // ★ 前回描画時の「もっと見る」ボタン（<ul>の外、カード内に追加している）が
  //   残ったまま重複しないよう、再読み込みのたびに一旦取り除く
  const oldMore = listEl.parentElement.querySelector('.log-load-more');
  if (oldMore) oldMore.remove();
  try {
    const res = await fetch(`${API_BASE}system_log?limit=${logDisplayCount}`, { cache: 'no-store' });
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
