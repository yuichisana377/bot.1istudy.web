/*@ver*/(window.__jsVer=window.__jsVer||{})["TestPrep.js"]="4a5e545bc6";/*@end*/// ============================================================
//  TestPrep.js — テスト対策モード（試作・サーバー変更なし）
//  予定管理の【テスト】/【試験】予定 + CardMakerのデッキ(list_cards) +
//  自分の学習データ(get_study_data の seen/unsure) から、残り日数に応じた
//  進捗（見た率・残り枚数）を出し、範囲のデッキをまとめてプレイできるようにする。計画はlocalStorage('tp_plans_v1')に保存。
//  ★ ユーザー入力（科目名・デッキ名）は textContent / DOM API だけで表示する。
// ============================================================
const SESSION_KEY = 'sl_session';
const LOGIN_PATH = '/Login.html';
const API_BASE = '/api/';
const TP_KEY = 'tp_plans_v1';
const GUILD_ID = (function () {
  try { const g = JSON.parse(localStorage.getItem('current_guild')); return g && g.guild_id ? String(g.guild_id) : null; }
  catch (e) { return null; }
})();
if (!GUILD_ID || !(getLoginSession() && getLoginSession().session_token)) {
  try { sessionStorage.setItem('post_login_redirect', location.href); } catch (e) {}
  location.replace(LOGIN_PATH);
}
(function () {
  try {
    const g = JSON.parse(localStorage.getItem('current_guild'));
    const name = (g && g.guild_name) ? g.guild_name : '学生勉強会web';
    document.querySelectorAll('.app-name').forEach(el => {
      for (let i = el.childNodes.length - 1; i >= 0; i--) {
        if (el.childNodes[i].nodeType === Node.TEXT_NODE) { el.childNodes[i].textContent = ' ' + name; return; }
      }
    });
  } catch (e) {}
})();

// ── 判定・計算 ────────────────────────────────
const TEST_RE = /^【(定期)?(テスト|試験)】|^【(中間|期末)(テスト|試験)?】/;
function isTestPlan(p) { return TEST_RE.test(p.content || ''); }

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function daysUntil(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(y, m - 1, d), n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.round((t - today) / 86400000);
}
function planId(p) { return p.date + '|' + (p.subject || ''); }
function loadPlans() { try { return JSON.parse(localStorage.getItem(TP_KEY)) || {}; } catch (e) { return {}; } }
function savePlans(o) { try { localStorage.setItem(TP_KEY, JSON.stringify(o)); } catch (e) {} }

// 試験までの日数 → 勉強できる日数（試験当日は含めない）。
// 残りカード数 = 各デッキの「まだ見ていない枚数」
function computeStats(plan, deckMap, study) {
  let total = 0, seen = 0, unsure = 0;
  const rows = [];
  (plan.decks || []).forEach(fn => {
    const d = deckMap[fn];
    if (!d) return;
    const cnt = d.count || 0;
    const s = Math.min(cnt, (study.seen[fn] || []).length);
    const u = Math.min(cnt, (study.unsure[fn] || []).length);
    total += cnt; seen += s; unsure += u;
    rows.push({ filename: fn, name: d.name, count: cnt, seen: s, unsure: u });
  });
  const remaining = Math.max(0, total - seen);
  return { total, seen, unsure, remaining, rows };
}

// ── API ──────────────────────────────────────
function authHeaders() {
  const s = getLoginSession();
  return s && s.session_token ? { 'Authorization': 'Bearer ' + s.session_token } : {};
}
async function getJson(path) {
  const res = await fetch(API_BASE + path, { cache: 'no-store', headers: authHeaders() });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'failed');
  return data;
}

// ── 描画ヘルパー ─────────────────────────────
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function bar(ratio, cls) {
  const o = el('div', 'tp-bar ' + (cls || '')), i = el('div', 'tp-bar-fill');
  i.style.width = Math.round(Math.max(0, Math.min(1, ratio)) * 100) + '%';
  o.appendChild(i); return o;
}

let STUDY_FAILED = false;
let TESTS = [], DECKS = [], STUDY = { seen: {}, unsure: {} };
const plansState = loadPlans();

function render() {
  const body = document.getElementById('tp-body');
  body.textContent = '';
  if (!TESTS.length) {
    body.appendChild(el('div', 'tp-empty', '今後のテスト予定はありません。予定管理でカテゴリを「テスト」か「試験」にして追加してください。'));
    return;
  }
  if (STUDY_FAILED) body.appendChild(el('div', 'tp-hint', '学習データを取得できなかったため、進み具合は0枚と表示されます。'));
  const deckMap = {}; DECKS.forEach(d => { deckMap[d.filename] = d; });
  TESTS.forEach(p => body.appendChild(renderTest(p, deckMap)));
}

function renderTest(p, deckMap) {
  const id = planId(p);
  let plan = plansState[id];
  // デッキは自動では選ばない。以前の自動選択（touched なしで decks が入っているもの）は空に戻す
  if (!plan || (!plan.touched && (plan.decks || []).length)) {
    plan = plansState[id] = { decks: [], scope: (plan && plan.scope) || '' };
    savePlans(plansState);
  }
  const days = Math.max(0, daysUntil(p.date));
  const st = computeStats(plan, deckMap, STUDY);
  const card = el('div', 'tp-card');

  const head = el('div', 'tp-head');
  head.appendChild(el('div', 'tp-subject', p.subject || '（科目なし）'));
  head.appendChild(el('div', 'tp-date', p.date + (days === 0 ? '（今日！）' : '（あと' + days + '日）')));
  card.appendChild(head);

  // 予定の内容（先頭の【カテゴリ】は外して表示。textContent）
  const body0 = String(p.content || '').replace(/^【[^】]*】\s*/, '').replace(/\n?📝備考：/, '\n備考：').trim();
  if (body0) card.appendChild(el('div', 'tp-content', body0));

  // テスト範囲（自由入力。textContent で表示）
  const sc = el('div', 'tp-scope' + (plan.scope ? '' : ' is-empty'));
  sc.appendChild(el('span', 'tp-scope-label', '範囲'));
  sc.appendChild(el('span', 'tp-scope-text', plan.scope || '未入力'));
  const scBtn = el('button', 'tp-scope-edit', plan.scope ? '編集' : '入力する');
  scBtn.type = 'button';
  scBtn.addEventListener('click', () => openScopeEditor(p, plan));
  sc.appendChild(scBtn);
  card.appendChild(sc);

  if (!st.rows.length) {
    card.appendChild(el('div', 'tp-hint', '対象デッキが未選択です。下のボタンで選んでください。'));
  } else {
    const pct = st.total ? Math.floor(st.seen / st.total * 100) : 0;
    const big = el('div', 'tp-today');
    big.appendChild(el('span', 'tp-today-num', String(pct)));
    big.appendChild(el('span', 'tp-today-unit', ' % 見た'));
    card.appendChild(big);
    card.appendChild(el('div', 'tp-sub',
      '残り ' + st.remaining + ' 枚（見た ' + st.seen + ' / 全 ' + st.total + ' 枚、わからない ' + st.unsure + ' 枚）'));
    card.appendChild(bar(st.total ? st.seen / st.total : 0));

    st.rows.forEach(r => {
      const row = el('div', 'tp-deck');
      const top = el('div', 'tp-deck-top');
      top.appendChild(el('span', 'tp-deck-name', r.name));
      const a = el('a', 'tp-go', 'デッキを開く');
      a.href = '/Cardmaker.html?deck=' + encodeURIComponent(r.filename);
      top.appendChild(a);
      row.appendChild(top);
      row.appendChild(bar(r.count ? r.seen / r.count : 0));
      row.appendChild(el('div', 'tp-deck-sub', r.seen + ' / ' + r.count + ' 枚' + (r.unsure ? '・わからない ' + r.unsure : '')));
      card.appendChild(row);
    });
  }

  // 範囲のデッキをまとめてプレイ／みんなでクイズ
  const playable = st.rows.filter(r => r.count > 0);
  if (playable.length) {
    const playRow = el('div', 'tp-play');
    const goAll = el('button', 'tp-btn tp-btn-primary', 'まとめてプレイ');
    goAll.type = 'button';
    goAll.addEventListener('click', () => {
      try { sessionStorage.setItem('tpPlay', JSON.stringify({ id: id, name: (p.subject || 'テスト') + ' の範囲', filenames: playable.map(r => r.filename) })); } catch (e) {}
      location.href = 'Cardmaker.html?tpplay=1';
    });
    const goQuiz = el('button', 'tp-btn', 'みんなでクイズ');
    goQuiz.type = 'button';
    goQuiz.addEventListener('click', () => {
      try {
        sessionStorage.setItem('quizDeckPicker', JSON.stringify(playable.slice(0, 30).map(r => ({ filename: r.filename, name: r.name }))));
        sessionStorage.setItem('quizHostTitle', (p.subject || 'テスト') + ' 対策クイズ');
      } catch (e) {}
      location.href = 'Quiz.html?mode=host&fromPicker=1';
    });
    playRow.appendChild(goAll); playRow.appendChild(goQuiz);
    card.appendChild(playRow);
  }
  const ctl = el('div', 'tp-ctl');
  const pick = el('button', 'tp-btn', 'デッキを選ぶ');
  pick.type = 'button';
  pick.addEventListener('click', () => openDeckPicker(p, plan));
  ctl.appendChild(pick);
  card.appendChild(ctl);
  return card;
}

// テスト範囲の入力（自前のモーダル。OS標準UIを使わない）
function openScopeEditor(p, plan) {
  const bg = el('div', 'modal-bg open');
  const box = el('div', 'tp-picker');
  box.appendChild(el('div', 'tp-picker-title', 'テスト範囲（' + (p.subject || '') + '）'));
  const ta = document.createElement('textarea');
  ta.className = 'tp-scope-input';
  ta.rows = 4; ta.maxLength = 200;
  ta.placeholder = '例：教科書 p.30〜58、第3章 微分、プリント1〜4';
  ta.value = plan.scope || '';
  box.appendChild(ta);
  box.appendChild(el('div', 'tp-hint', '200文字まで。この端末にだけ保存されます。'));
  const act = el('div', 'tp-picker-act');
  const cancel = el('button', 'tp-btn', 'キャンセル'); cancel.type = 'button';
  const ok = el('button', 'tp-btn tp-btn-primary', '決定'); ok.type = 'button';
  cancel.addEventListener('click', () => bg.remove());
  ok.addEventListener('click', () => { plan.scope = ta.value.trim().slice(0, 200); savePlans(plansState); bg.remove(); render(); });
  act.appendChild(cancel); act.appendChild(ok);
  box.appendChild(act);
  bg.appendChild(box);
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  ta.focus();
}

// デッキ選択（自前のモーダル。OS標準UIを使わない）
function openDeckPicker(p, plan) {
  const bg = el('div', 'modal-bg open');
  const box = el('div', 'tp-picker');
  box.appendChild(el('div', 'tp-picker-title', '対象デッキを選ぶ（' + (p.subject || '') + '）'));
  const known = new Set(DECKS.map(d => d.filename));
  const chosen = new Set((plan.decks || []).filter(f => known.has(f)));
  const NONE = '__none__';
  const subjOf = d => (d.subject || '').trim() || NONE;
  const subjects = Array.from(new Set(DECKS.map(subjOf))).sort((a, b) => a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b, 'ja'));
  const ps = (p.subject || '').trim();
  let curSubj = subjects.includes(ps) ? ps : '';
  let query = '';

  const search = document.createElement('input');
  search.type = 'text'; search.className = 'tp-search'; search.placeholder = 'デッキ名で検索';
  box.appendChild(search);
  const tabs = el('div', 'tp-tabs');
  box.appendChild(tabs);
  const list = el('div', 'tp-picker-list');
  box.appendChild(list);
  const count = el('div', 'tp-pick-count', '');
  box.appendChild(count);

  function drawTabs() {
    tabs.textContent = '';
    [''].concat(subjects).forEach(sj => {
      const label = sj === '' ? 'すべて' : (sj === NONE ? '科目なし' : sj);
      const b = el('button', 'tp-tab' + (sj === curSubj ? ' is-active' : ''), label);
      b.type = 'button';
      b.addEventListener('click', () => { curSubj = sj; drawTabs(); drawList(); });
      tabs.appendChild(b);
    });
  }
  function drawList() {
    list.textContent = '';
    const q = query.trim().toLowerCase();
    const shown = DECKS.filter(d => (!curSubj || subjOf(d) === curSubj) && (!q || (d.name || '').toLowerCase().includes(q)));
    shown.forEach(d => {
      const lab = el('label', 'tp-pick-row');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = chosen.has(d.filename);
      cb.addEventListener('change', () => { cb.checked ? chosen.add(d.filename) : chosen.delete(d.filename); drawCount(); });
      lab.appendChild(cb);
      lab.appendChild(el('span', 'tp-pick-name', d.name));
      lab.appendChild(el('span', 'tp-pick-meta', (d.subject ? d.subject + '・' : '') + d.count + '枚'));
      list.appendChild(lab);
    });
    if (!shown.length) list.appendChild(el('div', 'tp-empty', DECKS.length ? '該当するデッキがありません' : 'デッキがありません'));
    drawCount();
  }
  function drawCount() { count.textContent = chosen.size + '個 選択中'; }
  search.addEventListener('input', () => { query = search.value; drawList(); });
  drawTabs(); drawList();

  const act = el('div', 'tp-picker-act');
  const cancel = el('button', 'tp-btn', 'キャンセル'); cancel.type = 'button';
  const ok = el('button', 'tp-btn tp-btn-primary', '決定'); ok.type = 'button';
  cancel.addEventListener('click', () => bg.remove());
  ok.addEventListener('click', () => { plan.decks = Array.from(chosen); plan.touched = true; savePlans(plansState); bg.remove(); render(); });
  act.appendChild(cancel); act.appendChild(ok);
  box.appendChild(act);
  bg.appendChild(box);
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
}

async function init() {
  if (!GUILD_ID) return;
  const body = document.getElementById('tp-body');
  try {
    const [sch, cards, sd] = await Promise.all([
      getJson('list_schedule?guild_id=' + GUILD_ID + '&scope=future'),
      getJson('list_cards?guild_id=' + GUILD_ID),
      getJson('get_study_data?guild_id=' + GUILD_ID).catch(() => null),
    ]);
    TESTS = (sch.plans || []).filter(isTestPlan).sort((a, b) => a.date.localeCompare(b.date));
    DECKS = (cards.sets || []).filter(s => s.filename && !s.incomplete);
    const d = sd && sd.data ? sd.data : {};
    if (!sd) STUDY_FAILED = true;
    STUDY = { seen: d.seen || {}, unsure: d.unsure || {} };
    render();
  } catch (e) {
    body.textContent = '';
    const m = String(e && e.message);
    if (m === 'not_logged_in') {
      try { localStorage.removeItem(SESSION_KEY); sessionStorage.setItem('post_login_redirect', location.href); } catch (e2) {}
      location.replace(LOGIN_PATH); return;
    }
    body.appendChild(el('div', 'tp-empty', m === 'guild_membership_required'
      ? 'このサーバーのメンバーではないため、テスト対策は使えません。'
      : '読み込めませんでした。時間をおいて再読み込みしてください。'));
  }
}
init();

// ============================================================
//  ドロワー・ログイン中表示（他ページと共通の挙動）
//  ★ このページはログイン必須（予定・デッキ・学習データを取得するため）。
// ============================================================
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

  const settingsLink = document.createElement('a');
  settingsLink.className = 'drawer-account-menu-item';
  settingsLink.href = '/StudyLog.html?openAccount=1';
  settingsLink.innerHTML = Icons.html('settings', {size:16}) + ' アカウント設定';
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
document.addEventListener('click', (e) => {
  const el = document.getElementById('drawer-account');
  if (el && !el.contains(e.target)) el.classList.remove('is-open');
});
renderDrawerAccount();

function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
}
document.querySelectorAll('.drawer-item[href]').forEach(a => {
  a.addEventListener('click', (e) => {
    if (a.classList.contains('active')) {
      e.preventDefault();
      closeDrawer();
      return;
    }
    const overlay = document.getElementById('page-nav-loading');
    if (overlay) overlay.classList.add('show');
  });
});
window.addEventListener('pageshow', () => {
  const overlay = document.getElementById('page-nav-loading');
  if (overlay) overlay.classList.remove('show');
});

// ★ ここまでエラーなく実行できた＝JSが生きている合図
hideLoadingFallback();
