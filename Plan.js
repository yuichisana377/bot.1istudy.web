// ============================================================
//  plan.js — 予定管理ページ用スクリプト
//  index.html から読み込む
// ============================================================

const API_BASE = "https://python-bot-1istudy.onrender.com/";
const GUILD_ID = "1509880344806162544";

// ============================================================
//  グローバル状態
// ============================================================
let plans    = [];
let channels = [];
let calState = {};
let editTarget = null;
let delTarget  = null;

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

  if (v === 'log') {
    loadLogs();
  }

  // ★ 予定一覧に切り替えたとき毎回スクロール
  if (v === 'plan') {
    setTimeout(scrollToToday, 50); 
  }
}

function scrollLogsTop() {
  const el = document.getElementById('log-content');
  if (!el) return;

  window.scrollTo({
    top: el.offsetTop - 70,   // ヘッダー分ずらす
    behavior: 'smooth'
  });
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
  if (!plans.length) return;

  const today = new Date().toISOString().split("T")[0];

  // 今日以降の予定日を全部集める
  const futureDates = plans
    .map(p => p.date)
    .filter(d => d >= today)
    .sort();

  let targetDate = null;

  if (futureDates.includes(today)) {
    // 今日に予定がある
    targetDate = today;
  } else if (futureDates.length > 0) {
    // 今日に予定がない → 次の予定日へ
    targetDate = futureDates[0];
  } else {
    // 未来にも予定がない → 最後の予定日へ（任意）
    targetDate = plans.map(p => p.date).sort().slice(-1)[0];
  }

  const targetEl = document.querySelector(`.date-group[data-date="${targetDate}"]`);
  if (!targetEl) return;

  const rect = targetEl.getBoundingClientRect();
  const offset = window.pageYOffset + rect.top - 70;  // ヘッダー分ずらす

  window.scrollTo({
    top: offset,
    behavior: 'auto'  // 即ジャンプ
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
  if (!plans.length) {
    el.innerHTML = '<div class="empty-msg">予定はありません</div>';
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const grouped = {};
  plans.forEach(p => { (grouped[p.date] = grouped[p.date] || []).push(p); });

  el.innerHTML = Object.keys(grouped).sort().map(date => {
    const d = new Date(date + 'T00:00:00');
    const label = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${WDAYS[d.getDay()]}）`;

    const isToday = date === today;
    const isPast  = date < today;   // ★ 過去判定

    const rows = grouped[date].map(p => {
      const { cat, text } = parsePlanContent(p.content);
      return `<div class="plan-row">
        <span class="subject">${p.subject}</span>
        <span class="badge badge-${cat}">${cat}</span>
        <span class="content">${text}</span>
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
  if (name === 'add')    initCal('add', false);
  if (name === 'edit')   { initCal('edit', true); editTarget = null; renderSelectList('edit-list', 'edit'); }
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
//  API 送信
// ============================================================
async function submitAdd() {
  const date     = calState['add']?.selected;
  const subject  = document.getElementById('add-subject').value;
  const category = getCatValue('add');
  if (!category) { showErr('add-err', 'カテゴリを入力してください'); return; }
  const content  = document.getElementById('add-content').value.trim();
  if (!date || !subject || !content) { showErr('add-err', '日付・科目・内容は必須です'); return; }

  const btn = document.querySelector('#modal-add .btn-primary');
  setLoading(btn, '登録中…');
  try {
    const res = await api('/add_schedule', {
      method: 'POST',
      body: JSON.stringify({ guild_id: GUILD_ID, date, subject, category, content })
    });
    resetLoading(btn, '追加する');
    if (res.ok) {
      showOk('add-ok');
      document.getElementById('add-content').value = '';
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
