// ============================================================
//  plan.js — 予定管理ページ用スクリプト
//  index.html から読み込む
// ============================================================

const API_BASE = "https://python-bot-1istudy.onrender.com/";
const GUILD_ID = "1509880344806162544";

// ★ ポイント付与対象カテゴリ
const POINT_CATEGORIES = ['提出', '宿題'];

// ★ ポイント選択肢
const POINT_OPTIONS = [3, 5, 10, 15];

// ============================================================
//  グローバル状態
// ============================================================
let plans    = [];
let channels = [];
let calState = {};
let editTarget = null;
let delTarget  = null;

// ★ ポイント選択状態（'add' / 'edit' ごとに選択中のポイント値を保持）
let selectedPoints = { add: null, edit: null };

// ★ 絞り込み状態
let filterSubject = 'all';  // 'all' or channel name
let filterCat     = 'all';  // 'all' or category string

// ============================================================
//  日付ユーティリティ（ローカル時刻＝日本時間で YYYY-MM-DD を返す）
//  ※ toISOString() はUTC基準になるため使わない
// ============================================================
function todayLocalStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ============================================================
//  起動
// ============================================================
window.addEventListener('load', () => {
  loadChannels();
  loadPlans();
});

// ============================================================
//  サブビュー切り替え（予定一覧 / ログ）
// ============================================================
function switchPlanView(v) {
  document.querySelectorAll('.view-btn').forEach((b, i) => {
    b.classList.toggle('active', ['plan','log'][i] === v);
  });
  document.getElementById('plan-sub-plan').classList.toggle('active', v === 'plan');
  document.getElementById('plan-sub-log').classList.toggle('active',  v === 'log');

  // 絞り込みバーの表示切り替え
  const filterBar = document.getElementById('filter-bar');
  const filterBtn = document.getElementById('filter-toggle-btn');
  if (filterBar) {
    if (v === 'log') {
      filterBar.classList.remove('open');
      if (filterBtn) filterBtn.classList.remove('filter-toggle-active');
    }
  }

  if (v === 'log') {
    loadLogs();
  }

  if (v === 'plan') {
    setTimeout(scrollToToday, 50);
  }
}

function scrollLogsTop() {
  const el = document.getElementById('log-content');
  if (!el) return;
  window.scrollTo({ top: el.offsetTop - 70, behavior: 'smooth' });
}

function onTodayButton() {
  const isLog = document.getElementById('plan-sub-log').classList.contains('active');
  if (isLog) {
    scrollLogsTop();
  } else {
    scrollToToday();
  }
}

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
//  チャンネル読み込み
// ============================================================
async function loadChannels() {
  try {
    const data = await api(`/channels?guild_id=${GUILD_ID}`);
    channels = data.ok ? data.channels : [];
  } catch(e) { channels = []; }
  renderChannelOptions();
  renderSubjectFilterChips();  // ★ 絞り込みチップも更新
}

// ============================================================
//  予定一覧読み込み
// ============================================================
async function loadPlans() {
  document.getElementById('plan-loading').style.display = 'block';
  document.getElementById('plan-content').innerHTML = '';
  try {
    const data = await api(`/list_schedule?guild_id=${GUILD_ID}`);
    plans = data.ok ? data.plans : [];
  } catch(e) { plans = []; }
  document.getElementById('plan-loading').style.display = 'none';
  renderPlans();
  scrollToToday();
}

function scrollToToday() {
  const filtered = getFilteredPlans();
  if (!filtered.length) return;

  const today = todayLocalStr();
  const futureDates = filtered.map(p => p.date).filter(d => d >= today).sort();

  let targetDate = null;
  if (futureDates.includes(today)) {
    targetDate = today;
  } else if (futureDates.length > 0) {
    targetDate = futureDates[0];
  } else {
    targetDate = filtered.map(p => p.date).sort().slice(-1)[0];
  }

  const targetEl = document.querySelector(`.date-group[data-date="${targetDate}"]`);
  if (!targetEl) return;

  const scrollBody = document.querySelector('.scroll-body');
  const rect = targetEl.getBoundingClientRect();
  const bodyRect = scrollBody.getBoundingClientRect();

  const offset = scrollBody.scrollTop + (rect.top - bodyRect.top) - 70;

  scrollBody.scrollTo({
    top: offset,
    behavior: 'auto'
  });
}

// ============================================================
//  ログ読み込み
// ============================================================
async function loadLogs() {
  document.getElementById('log-loading').style.display = 'block';
  document.getElementById('log-content').innerHTML = '';
  try {
    const data = await api(`/list_logs?guild_id=${GUILD_ID}`);
    renderLogs(data.ok ? data.logs : []);
  } catch(e) { renderLogs([]); }
  document.getElementById('log-loading').style.display = 'none';
}

// ============================================================
//  ★ 絞り込みロジック
// ============================================================

/** 現在のフィルタを適用した plans を返す */
function getFilteredPlans() {
  return plans.filter(p => {
    // 教科フィルタ
    if (filterSubject !== 'all' && p.subject !== filterSubject) return false;

    // カテゴリフィルタ
    if (filterCat !== 'all') {
      const { cat } = parsePlanContent(p.content);

      // 提出・宿題まとめフィルタ
      if (filterCat === 'hw') {
        if (cat !== '提出' && cat !== '宿題') return false;
      } else {
        if (cat !== filterCat) return false;
      }
    }

    return true;
  });
}

/** 教科チップを描画（チャンネル読み込み後に呼ぶ） */
function renderSubjectFilterChips() {
  const wrap = document.getElementById('filter-subject-chips');
  if (!wrap) return;

  const allBtn = `<button class="chip chip-active" data-subj="all" onclick="toggleSubjFilter(this)">すべて</button>`;
  const chs = channels.map(c =>
    `<button class="chip" data-subj="${c.name}" onclick="toggleSubjFilter(this)">${c.name}</button>`
  ).join('');
  wrap.innerHTML = allBtn + chs;
}

/** 教科チップがクリックされたとき */
function toggleSubjFilter(btn) {
  filterSubject = btn.dataset.subj;
  btn.closest('.filter-chips').querySelectorAll('.chip').forEach(c => c.classList.remove('chip-active'));
  btn.classList.add('chip-active');
  renderPlans();
}

/** カテゴリチップがクリックされたとき */
function toggleCatFilter(btn) {
  filterCat = btn.dataset.cat;
  btn.closest('.filter-chips').querySelectorAll('.chip').forEach(c => c.classList.remove('chip-active'));
  btn.classList.add('chip-active');
  renderPlans();
}

// ============================================================
//  時間割（曜日ごとの教科順）
// ============================================================
const TIMETABLE = {
  mon: [
    { subject: "コンピュータリテラシ", items: ["教科書"] },
    { subject: "情報技術概論",         items: ["教科書", "プリント"] },
    { subject: "国語1乙a",             items: ["教科書", "資料集", "辞書"] },
  ],
  tue: [
    { subject: "化学1a",     items: ["教科書", "ワーク"] },
    { subject: "情報基礎",   items: ["教科書"] },
    { subject: "線形数学1a", items: ["教科書", "ノート", "ワーク"] },
    { subject: "地理a",      items: ["教科書", "資料集", "地図帳"] },
  ],
  wed: [
    { subject: "物理1a",     items: ["教科書", "プリント"] },
    { subject: "体育1a",     items: ["体操服", "教科書"] },
    { subject: "英語会話a",  items: ["教科書", "多読手帳"] },
    { subject: "その他",     items: [] },
  ],
  thu: [
    { subject: "情報工学ゼミ1", items: [] },
    { subject: "公共a",         items: ["教科書", "資料集", "プリント"] },
    { subject: "基礎解析1a",    items: ["教科書", "ワーク", "ノート"] },
    { subject: "国語1甲a",      items: ["国語ノート"] },
  ],
  fri: [
    { subject: "英語表現基礎a",           items: ["英語教科書", "辞書"] },
    { subject: "基礎解析",                items: ["教科書", "ノート"] },
    { subject: "英語コミュニケーション1a", items: ["英語教科書"] },
  ],
};

const WDAY_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];

/** 日付文字列(YYYY-MM-DD)からその曜日の時間割上の教科順インデックスを返す */
function timetableOrderIndex(dateStr, subject) {
  const d = new Date(dateStr + 'T00:00:00');
  const key = WDAY_KEYS[d.getDay()];
  const list = TIMETABLE[key];
  if (!list) return Infinity; // 土日など時間割がない曜日は元の順序のまま末尾扱い
  const idx = list.findIndex(item => item.subject === subject);
  return idx === -1 ? Infinity : idx; // 時間割にない教科は末尾
}

/** 同じ日付内の予定配列を、その曜日の時間割順に安定ソートする */
function sortByTimetable(dateStr, dayPlans) {
  return dayPlans
    .map((p, i) => ({ p, i, order: timetableOrderIndex(dateStr, p.subject) }))
    .sort((a, b) => (a.order - b.order) || (a.i - b.i))
    .map(x => x.p);
}

// ============================================================
//  予定一覧 描画
// ============================================================
const WDAYS = ['日','月','火','水','木','金','土'];

function parsePlanContent(raw) {
  const cat  = raw.match(/^【(.+?)】/)?.[1] || '';
  const text = raw.replace(/^【.+?】/, '').trim();
  return { cat, text };
}

function renderPlans() {
  const el = document.getElementById('plan-content');
  const filtered = getFilteredPlans();

  if (!filtered.length) {
    el.innerHTML = plans.length
      ? '<div class="empty-msg">条件に一致する予定はありません</div>'
      : '<div class="empty-msg">予定はありません</div>';
    return;
  }

  const today = todayLocalStr();
  const grouped = {};
  filtered.forEach(p => { (grouped[p.date] = grouped[p.date] || []).push(p); });

  el.innerHTML = Object.keys(grouped).sort().map(date => {
    const d = new Date(date + 'T00:00:00');
    const label = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${WDAYS[d.getDay()]}）`;

    const isToday = date === today;
    const isPast  = date < today;

    // ★ 時間割順に並べ替え
    const dayPlans = sortByTimetable(date, grouped[date]);

    const rows = dayPlans.map(p => {
      const { cat, text } = parsePlanContent(p.content);
      const ptsBadge = (p.points != null)
        ? `<span class="badge badge-pts">⭐ ${p.points}pt</span>`
        : '';
      return `<div class="plan-row">
        <span class="subject">${p.subject}</span>
        <span class="badge badge-${cat}">${cat}</span>
        <span class="content">${text}</span>
        ${ptsBadge}
      </div>`;
    }).join('');

    return `<div class="date-group ${isPast ? 'past' : ''}" data-date="${date}">
      <div class="date-label">${label}${isToday ? '<span class="today-tag">今日</span>' : ''}</div>
      <div class="date-card">${rows}</div>
    </div>`;
  }).join('');
}

// ============================================================
//  ログ 描画
// ============================================================
const TYPE_LABEL = { add:'追加', edit:'編集', delete:'削除', cleanup:'自動削除' };

function renderLogs(logs) {
  const el = document.getElementById('log-content');
  if (!logs.length) { el.innerHTML = '<div class="empty-msg">ログはありません</div>'; return; }
  el.innerHTML = logs.map(l => `
    <div class="tl-item">
      <div class="tl-dot dot-${l.type}"></div>
      <div class="tl-time">${l.time}</div>
      <div class="tl-card">
        <div class="tl-type type-${l.type}">${TYPE_LABEL[l.type] || l.type}</div>
        <div class="tl-detail">${l.detail}</div>
      </div>
    </div>`).join('');
}

// ============================================================
//  科目セレクト
// ============================================================
function renderChannelOptions() {
  const opts = channels.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  document.getElementById('add-subject').innerHTML  = opts || '<option value="">（なし）</option>';
  document.getElementById('edit-subject').innerHTML = '<option value="">— 変更しない —</option>' + opts;
}

// ============================================================
//  選択リスト（編集・削除）
// ============================================================
function renderSelectList(containerId, mode) {
  const el = document.getElementById(containerId);
  if (!plans.length) { el.innerHTML = '<div class="empty-msg">予定がありません</div>'; return; }
  el.innerHTML = plans.map(p => {
    const label = `${p.date}/${p.subject}${p.content}`;
    const { cat, text } = parsePlanContent(p.content);
    return `<div class="sel-item" data-label="${label}" onclick="selectPlan(this,'${mode}')">
      <span class="si-date">${p.date}</span>
      <span class="si-subject">${p.subject}</span>
      <span class="badge badge-${cat}">${cat}</span>
      <span class="si-content">${text}</span>
    </div>`;
  }).join('');
}

function selectPlan(el, mode) {
  el.closest('.sel-list').querySelectorAll('.sel-item').forEach(i => i.classList.remove('selected'));
  el.classList.add('selected');
  if (mode === 'edit') {
    editTarget = el.dataset.label;

    // ★ 選択した予定に既にポイントがあれば編集欄のヒントとして反映
    const label = el.dataset.label;
    const plan = plans.find(p => `${p.date}/${p.subject}${p.content}` === label);
    const ptsWrap  = document.getElementById('edit-points-wrap');
    if (plan) {
      const { cat } = parsePlanContent(plan.content);
      if (POINT_CATEGORIES.includes(cat)) {
        ptsWrap.style.display = 'block';
        // 既存のポイントが選択肢内にあればプリセット、なければ未選択のまま
        selectedPoints['edit'] = POINT_OPTIONS.includes(plan.points) ? plan.points : null;
        renderPointsChips('edit');
        const label = ptsWrap.querySelector('.pts-label');
        if (label) {
          label.textContent = (plan.points != null)
            ? `ポイント（現在: ${plan.points}pt・変更しない場合は未選択のまま）`
            : 'ポイント（変更しない場合は未選択のまま）';
        }
      } else {
        ptsWrap.style.display = 'none';
      }
    }
  } else {
    delTarget = el.dataset.label;
    document.getElementById('del-label').textContent = el.dataset.label;
    document.getElementById('del-confirm').style.display = 'block';
  }
}

// ============================================================
//  FAB
// ============================================================
function toggleFab() {
  const open = !document.getElementById('fab-actions').classList.contains('open');
  document.getElementById('fab-actions').classList.toggle('open', open);
  document.getElementById('fab-main').classList.toggle('open', open);
  document.getElementById('fab-overlay').classList.toggle('open', open);
}
function closeFab() {
  document.getElementById('fab-actions').classList.remove('open');
  document.getElementById('fab-main').classList.remove('open');
  document.getElementById('fab-overlay').classList.remove('open');
}

function openModal(name) {
  closeFab();
  document.getElementById('modal-' + name).classList.add('open');
  if (name === 'add')    {
    initCal('add', false);
    selectedPoints['add'] = 5;
    updatePointsVisibility('add');
  }
  if (name === 'edit')   {
    initCal('edit', true);
    editTarget = null;
    renderSelectList('edit-list', 'edit');
    selectedPoints['edit'] = null;
    document.getElementById('edit-points-wrap').style.display = 'none';
  }
  if (name === 'delete') { delTarget = null; renderSelectList('del-list', 'delete'); document.getElementById('del-confirm').style.display = 'none'; }
}
function closeModal(name) {
  document.getElementById('modal-' + name).classList.remove('open');
  document.querySelectorAll('.cal-pop').forEach(p => p.classList.remove('open'));
}
function onBgClick(e, name) {
  if (e.target === document.getElementById('modal-' + name)) closeModal(name);
}

// ============================================================
//  ★ ポイント入力欄の表示切り替え・選択肢描画
// ============================================================
function updatePointsVisibility(prefix) {
  const cat  = getCatValue(prefix);
  const wrap = document.getElementById(prefix + '-points-wrap');
  if (!wrap) return;
  const show = POINT_CATEGORIES.includes(cat);
  wrap.style.display = show ? 'block' : 'none';
  if (show) renderPointsChips(prefix);
}

/** ポイント選択チップ（3 / 5 / 10 / 15）を描画する */
function renderPointsChips(prefix) {
  const wrap = document.getElementById(prefix + '-points-wrap');
  if (!wrap) return;
  // ★ 追加時は未選択なら5ptをデフォルトで選択状態にする
  if (prefix === 'add' && selectedPoints[prefix] == null) {
    selectedPoints[prefix] = 5;
  }
  const current = selectedPoints[prefix];
  const chips = POINT_OPTIONS.map(v =>
    `<button type="button" class="chip pts-chip${current === v ? ' chip-active' : ''}" data-pts="${v}" onclick="pickPoints('${prefix}', ${v})">${v}pt</button>`
  ).join('');
  wrap.innerHTML = `
    <div class="pts-label">ポイント</div>
    <div class="filter-chips pts-chips">${chips}</div>
  `;
}

/** ポイントチップがクリックされたとき */
function pickPoints(prefix, val) {
  selectedPoints[prefix] = val;
  const wrap = document.getElementById(prefix + '-points-wrap');
  if (!wrap) return;
  wrap.querySelectorAll('.pts-chip').forEach(b => {
    b.classList.toggle('chip-active', parseInt(b.dataset.pts, 10) === val);
  });
}

// ============================================================
//  API 送信
// ============================================================
async function submitAdd() {
  const date     = calState['add']?.selected;
  const subject  = document.getElementById('add-subject').value;
  const category = getCatValue('add');
  if (!category) { showErr('add-err', 'カテゴリを入力してください'); return; }
  const content  = document.getElementById('add-content').value.trim();
  if (!date || !subject || !content) { showErr('add-err', '日付・科目・内容は必須です'); return; }

  const body = { guild_id: GUILD_ID, date, subject, category, content };

  if (POINT_CATEGORIES.includes(category)) {
    const points = selectedPoints['add'];
    if (!points) { showErr('add-err', 'ポイントを選択してください'); return; }
    body.points = points;
  }

  const btn = document.querySelector('#modal-add .btn-primary');
  setLoading(btn, '登録中…');
  try {
    const res = await api('/add_schedule', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    resetLoading(btn, '追加する');
    if (res.ok) {
      showOk('add-ok');
      document.getElementById('add-content').value = '';
      selectedPoints['add'] = 5;
      document.getElementById('add-points-wrap').style.display = 'none';
      resetCal('add', '日付を選択');
      await loadPlans();
    } else {
      showErr('add-err', res.message || 'エラーが発生しました');
    }
  } catch(e) {
    resetLoading(btn, '追加する');
    showErr('add-err', 'サーバーに接続できませんでした');
  }
}

async function submitEdit() {
  if (!editTarget) { showErr('edit-err', '予定を選択してください'); return; }
  const body = { guild_id: GUILD_ID, target: editTarget };
  const d = calState['edit']?.selected; if (d) body.date = d;
  const s = document.getElementById('edit-subject').value;   if (s) body.subject = s;
  const c = getCatValue('edit'); if (c) body.category = c;
  const t = document.getElementById('edit-content').value.trim(); if (t) body.content = t;

  if (selectedPoints['edit']) body.points = selectedPoints['edit'];

  const btn = document.querySelector('#modal-edit .btn-primary');
  setLoading(btn, '保存中…');
  try {
    const res = await api('/edit_schedule', { method: 'POST', body: JSON.stringify(body) });
    resetLoading(btn, '保存する');
    if (res.ok) {
      showOk('edit-ok');
      editTarget = null;
      document.getElementById('edit-content').value = '';
      document.getElementById('edit-category-sel').value = '';
      document.getElementById('edit-category-inp').style.display = 'none';
      document.getElementById('edit-subject').value = '';
      selectedPoints['edit'] = null;
      document.getElementById('edit-points-wrap').style.display = 'none';
      resetCal('edit', '変更しない場合は空欄');
      await loadPlans();
      renderSelectList('edit-list', 'edit');
    } else {
      showErr('edit-err', res.message || 'エラーが発生しました');
    }
  } catch(e) {
    resetLoading(btn, '保存する');
    showErr('edit-err', 'サーバーに接続できませんでした');
  }
}

async function submitDelete() {
  if (!delTarget) return;
  const btn = document.querySelector('#del-confirm .btn-danger');
  setLoading(btn, '削除中…', true);
  try {
    const res = await api('/delete_schedule', {
      method: 'POST', body: JSON.stringify({ guild_id: GUILD_ID, target: delTarget })
    });
    resetLoading(btn, '削除する');
    if (res.ok) {
      showOk('del-ok');
      document.getElementById('del-confirm').style.display = 'none';
      delTarget = null;
      await loadPlans();
      renderSelectList('del-list', 'delete');
    } else {
      showErr('del-err', res.message || 'エラーが発生しました');
    }
  } catch(e) {
    resetLoading(btn, '削除する');
    showErr('del-err', 'サーバーに接続できませんでした');
  }
}

// ============================================================
//  UI ヘルパー
// ============================================================
function setLoading(btn, label, dark = false) {
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner${dark ? ' spinner-dark' : ''}"></span>${label}`;
}
function resetLoading(btn, label) {
  btn.disabled = false;
  btn.textContent = label;
}
function showOk(id) {
  const el = document.getElementById(id);
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 3000);
}
function showErr(id, msg) {
  const el = document.getElementById(id);
  el.textContent = '✕ ' + msg;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 4000);
}
function getCatValue(prefix) {
  const sel = document.getElementById(prefix + '-category-sel');
  if (sel.value === '__custom__') {
    return document.getElementById(prefix + '-category-inp').value.trim();
  }
  return sel.value;
}
function onCatSel(prefix) {
  const sel = document.getElementById(prefix + '-category-sel');
  const inp = document.getElementById(prefix + '-category-inp');
  if (sel.value === '__custom__') { inp.style.display = 'block'; inp.focus(); }
  else { inp.style.display = 'none'; }
  updatePointsVisibility(prefix);
}

// ============================================================
//  カスタムカレンダー
// ============================================================
const CAL_D = ['日','月','火','水','木','金','土'];

function initCal(id, allowPast) {
  const now = new Date();
  calState[id] = { year: now.getFullYear(), month: now.getMonth(), selected: null, allowPast };
  renderCal(id);
}
function resetCal(id, placeholder) {
  if (calState[id]) { calState[id].selected = null; renderCal(id); }
  const el = document.getElementById(id + '-date-text');
  if (el) { el.textContent = placeholder; el.style.color = 'var(--text-tertiary)'; }
}
function renderCal(id) {
  const s = calState[id]; if (!s) return;
  const el = document.getElementById('cal-' + id); if (!el) return;
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const firstDay = new Date(s.year, s.month, 1).getDay();
  const dim = new Date(s.year, s.month+1, 0).getDate();
  const CAL_M = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

  let html = `<div class="cal-head">
    <button class="cal-nav-btn" onclick="moveCal(event,'${id}',-1)">‹</button>
    <span>${s.year}年 ${CAL_M[s.month]}</span>
    <button class="cal-nav-btn" onclick="moveCal(event,'${id}',1)">›</button>
  </div><div class="cal-grid">`;
  CAL_D.forEach(d => { html += `<div class="cal-dow">${d}</div>`; });
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-day emp"></div>`;
  for (let d = 1; d <= dim; d++) {
    const ds = `${s.year}-${String(s.month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isPast = !s.allowPast && ds < todayStr;
    let cls = 'cal-day';
    if (isPast) cls += ' dis';
    if (ds === todayStr && ds !== s.selected) cls += ' tod';
    if (ds === s.selected) cls += ' sel';
    const click = isPast ? '' : `onclick="pickDate(event,'${id}','${ds}')"`;
    html += `<div class="${cls}" ${click}>${d}</div>`;
  }
  el.innerHTML = html + '</div>';
}
function moveCal(e, id, dir) {
  e.stopPropagation();
  const s = calState[id];
  s.month += dir;
  if (s.month < 0)  { s.month = 11; s.year--; }
  if (s.month > 11) { s.month = 0;  s.year++; }
  renderCal(id);
}
function pickDate(e, id, ds) {
  e.stopPropagation();
  calState[id].selected = ds;
  const [y, m, d] = ds.split('-');
  const el = document.getElementById(id + '-date-text');
  el.textContent = `${y}年${parseInt(m)}月${parseInt(d)}日`;
  el.style.color = 'var(--text)';
  document.getElementById('cal-' + id).classList.remove('open');
  renderCal(id);
}
function toggleCal(e, id) {
  e.stopPropagation();
  const el = document.getElementById('cal-' + id);
  const wasOpen = el.classList.contains('open');
  document.querySelectorAll('.cal-pop').forEach(p => p.classList.remove('open'));
  if (!wasOpen) {
    el.classList.add('open');
    setTimeout(() => {
      const rect  = el.getBoundingClientRect();
      const modal = el.closest('.modal');
      if (modal && rect.bottom > window.innerHeight - 20) {
        modal.scrollBy({ top: rect.bottom - window.innerHeight + 30, behavior: 'smooth' });
      }
    }, 30);
  }
}
document.addEventListener('click', e => {
  if (!e.target.closest('.date-wrap')) document.querySelectorAll('.cal-pop').forEach(p => p.classList.remove('open'));
});

// ============================================================
//  ドロワー
// ============================================================
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}

// ============================================================
//  絞り込みバー 開閉
// ============================================================
function toggleFilterBar() {
  const bar = document.getElementById('filter-bar');
  const btn = document.getElementById('filter-toggle-btn');
  const isOpen = bar.classList.contains('open');
  bar.classList.toggle('open', !isOpen);
  btn.classList.toggle('filter-toggle-active', !isOpen);
}

// ===== JSON変更監視（予定 list_schedule のみ） =====
let lastScheduleHash = null;

// SHA-256 ハッシュ計算
async function digestMessage(message) {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// 予定JSONの変更チェック
async function checkScheduleUpdate() {
  try {
    const res = await fetch(`${API_BASE}list_schedule?guild_id=${GUILD_ID}`);
    const txt = await res.text();
    const hash = await digestMessage(txt);

    // 初回は保存だけ
    if (lastScheduleHash === null) {
      lastScheduleHash = hash;
      return;
    }

    // ハッシュが変わったらリロード
    if (hash !== lastScheduleHash) {
      location.reload();
    }
  } catch(e) {}
}

// 10秒ごとにチェック
setInterval(checkScheduleUpdate, 10000);
