// ============================================================
//  timetable.js — 時間割ページ用スクリプト
//  timetable.html から読み込む
// ============================================================

const API_BASE = "https://python-bot-1istudy.onrender.com/";
const GUILD_ID = "1509880344806162544";
const JSON_URL = "https://raw.githubusercontent.com/yuichisana377/python.bot.1istudy/refs/heads/main/plans_1509880344806162544.json";

// ★ ポイント付与対象カテゴリ
const POINT_CATEGORIES = ['提出', '宿題'];

// ★ ポイント選択肢
const POINT_OPTIONS = [3, 5, 10, 15];

// ============================================================
//  時間割固定データ
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
    { subject: "国語1甲a",      items: ["教科書", "便覧", "漢字"] },
  ],
  fri: [
    { subject: "英語表現基礎a",           items: ["教科書", "Vision Quest", "ワーク"] },
    { subject: "基礎解析",                items: ["教科書", "ノート"] },
    { subject: "英語コミュニケーション1a", items: ["教科書", "ワーク", "単語"] },
  ],
};

const DAY_KEYS  = ["mon","tue","wed","thu","fri"];
const DAY_NAMES = ["月","火","水","木","金"];
const DAY_CLASS = ["d-mon","d-tue","d-wed","d-thu","d-fri"];

// 時間割 API エンドポイント
const TT_API = {
  UPDATE:         '/update_timetable',
  HOLIDAY:        '/set_holiday',
  PERIOD_HOLIDAY: '/set_period_holiday', // ★新規: 1コマだけの休み（未実装バックエンドでもローカル保存で動作）
  DELETE:         '/delete_timetable',
  LIST:           '/list_timetable',
};

// ============================================================
//  グローバル状態
// ============================================================
let weekOffset  = 0;
let ttActiveDay = 0;
let ttHomeworks = [];
let ttOverrides = {};
let ttEditMode  = 'change'; // 'change' | 'period-holiday' | 'day-change' | 'holiday'

// 予定管理モーダル用（時間割ページでも追加・編集・削除できる）
let plans      = [];
let channels   = [];
let calState   = {};
let editTarget = null;
let delTarget  = null;

// ★ ポイント選択状態（'add' / 'edit' ごとに選択中のポイント値を保持）
let selectedPoints = { add: null, edit: null };

// ============================================================
//  起動
// ============================================================
function adjustWeekForWeekend() {
  const today = new Date().getDay(); // 0=日, 6=土

  if (today === 0 || today === 6) {
    // ★ 土日 → 次の週へ
    weekOffset = 1;
    ttActiveDay = 0; // 月曜日を開く
  } else {
    // ★ 平日 → 今週
    weekOffset = 0;
    ttActiveDay = today - 1; // 月〜金 → 0〜4
  }
}

window.addEventListener('load', () => {
  adjustWeekForWeekend();  // ★ 土日なら次の週へ

  loadTTHomeworks();
  loadTTOverrides();
  loadChannels();
  loadPlans();
  renderTimetable();
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
//  時間割 — JSON読み込み
// ============================================================
async function loadTTHomeworks() {
  try {
    const res  = await fetch(JSON_URL);
    const data = await res.json();
    ttHomeworks = Array.isArray(data) ? data : [];
  } catch(e) {
    ttHomeworks = [];
  }
  renderTimetable();
}

// ============================================================
//  週ナビ
// ============================================================
function getWeekDates() {
  const now = new Date();
  const day = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + weekOffset * 7);
  return DAY_KEYS.map((_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d;
  });
}
function formatWeekLabel(dates) {
  const s = dates[0], e = dates[4];
  return `${s.getMonth()+1}/${s.getDate()} 〜 ${e.getMonth()+1}/${e.getDate()}`;
}
function getDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function getTodayDayIndex() {
  const d = new Date().getDay();
  if (d >= 1 && d <= 5) return d - 1;
  return -1;
}
// ★ 日付文字列(YYYY-MM-DD) → 曜日キー('mon'〜'fri')。土日はnull
function dateToDayKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const map = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri' };
  return map[d.getDay()] || null;
}
function moveWeek(dir) {
  weekOffset += dir;
  renderTimetable();
}
function goToday() {
  const today = new Date().getDay(); // 0=日, 6=土

  if (today === 0 || today === 6) {
    // ★ 土日 → 次の週へ
    weekOffset = 1;
    ttActiveDay = 0; // 月曜日を開く
  } else {
    // ★ 平日 → 今週
    weekOffset = 0;
    ttActiveDay = today - 1; // 月〜金 → 0〜4
  }

  renderTimetable();
}

function ttSwitchDay(idx) {
  ttActiveDay = idx;
  renderTimetable();
}

// ============================================================
//  時間割 描画
// ============================================================
function renderTimetable() {
  const dates      = getWeekDates();
  const todayIdx   = getTodayDayIndex();
  const isThisWeek = weekOffset === 0;

  const weekLabelEl = document.getElementById('week-label');
  const main        = document.getElementById('tt-main-content');
  if (!weekLabelEl || !main) return;
  weekLabelEl.textContent = formatWeekLabel(dates);

  // 今日バナー
  let bannerHtml = '';
  if (isThisWeek && todayIdx >= 0) {
    const td = dates[todayIdx];
    bannerHtml = `<div class="today-banner">
      <div class="today-dot"></div>
      <div class="today-banner-text">
        <span class="today-banner-day">${td.getMonth()+1}月${td.getDate()}日（${DAY_NAMES[todayIdx]}）</span>　今日
      </div>
    </div>`;
  }

  // 時間割本体
  const dayDate  = dates[ttActiveDay];
  const dayKey   = DAY_KEYS[ttActiveDay];
  const dayName  = DAY_NAMES[ttActiveDay];
  const dayClass = DAY_CLASS[ttActiveDay];
  const dateStr  = getDateStr(dayDate);

  const holidayKey = `holiday:${dateStr}`;
  const holidayOv  = ttOverrides[holidayKey];
  const basePeriods = TIMETABLE[dayKey] || [];

  let periodsHtml = '';
  if (holidayOv) {
    const reason = holidayOv.reason || '休校';
    const note   = holidayOv.note   ? `（${holidayOv.note}）` : '';
    periodsHtml = `<div class="period-row" style="justify-content:center;padding:1.5rem">
      <div style="text-align:center">
        <div style="font-size:22px;margin-bottom:6px">🏫</div>
        <div style="font-size:15px;font-weight:700;color:var(--text)">${reason}${note}</div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-top:4px">この日は授業がありません</div>
      </div>
    </div>`;
  } else {
    periodsHtml = basePeriods.map((p, i) => {
      const periodNum = i + 1;

      // ★ 1コマだけの休み（その時限のみ休み扱いにする）
      const periodHolidayKey = `period_holiday:${dateStr}:${periodNum}`;
      const periodHolidayOv  = ttOverrides[periodHolidayKey];
      if (periodHolidayOv) {
        const phReason = periodHolidayOv.reason || '休み';
        const phNote   = periodHolidayOv.note   ? `（${periodHolidayOv.note}）` : '';
        return `<div class="period-row">
          <div class="period-num">${periodNum}</div>
          <div class="period-subject" style="color:var(--text-tertiary)">🚫 ${phReason}${phNote}</div>
          <div class="period-right"></div>
        </div>`;
      }

      const changeKey = `change:${dateStr}:${periodNum}`;
      const changeOv  = ttOverrides[changeKey];

      const subject   = changeOv ? (changeOv.subject || p.subject) : p.subject;
      const items     = changeOv ? (changeOv.items   || [])        : p.items;
      const isChanged = !!changeOv;

      const hw = ttHomeworks.filter(h => h.date === dateStr && h.subject === subject);
      const itemsHtml = items.length
        ? `<div class="items-row">${items.map(it => `<span class="item-tag">📎 ${it}</span>`).join('')}</div>` : '';
      const hwHtml = hw.map(h => {
        const cat  = h.content.match(/^【(.+?)】/)?.[1] || '';
        const text = h.content.replace(/^【.+?】/, '').trim();
        return `<div class="homework-row">
          <span class="tt-badge tt-badge-${cat}">${cat}</span>
          <span class="homework-text">${text}</span>
        </div>`;
      }).join('');
      const noteHtml = (changeOv && changeOv.note)
        ? `<div style="font-size:11px;color:#1e40af;margin-top:2px">📝 ${changeOv.note}</div>` : '';
      const changedBadge = isChanged
        ? `<span style="font-size:10px;background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:20px;font-weight:700;margin-left:4px">変更</span>` : '';

      return `<div class="period-row">
        <div class="period-num">${periodNum}</div>
        <div class="period-subject${subject ? '' : ' empty'}">${subject || 'ー'}${changedBadge}</div>
        <div class="period-right">
          ${itemsHtml}
          ${hwHtml}
          ${noteHtml}
        </div>
      </div>`;
    }).join('');
  }

  main.innerHTML = bannerHtml + `<div class="day-tabs">
    ${DAY_KEYS.map((k, i) => {
      const d = dates[i];
      const isToday  = isThisWeek && i === todayIdx;
      const isActive = i === ttActiveDay;
      return `<button class="day-tab ${DAY_CLASS[i]}${isActive ? ' active' : ''}${isToday ? ' is-today' : ''}"
        onclick="ttSwitchDay(${i})">
        <span class="tab-day">${DAY_NAMES[i]}</span>
        <span class="tab-date">${d.getMonth()+1}/${d.getDate()}</span>
      </button>`;
    }).join('')}
  </div>
  <div class="timetable-card ${dayClass}">
    <div class="tt-card-header ${dayClass}">
      <div class="tt-card-header-dot"></div>
      <div class="tt-card-header-title">${dayName}曜日の時間割</div>
      <div class="tt-card-header-date">${dayDate.getMonth()+1}月${dayDate.getDate()}日</div>
    </div>
    ${periodsHtml}
  </div>`;
}

// ============================================================
//  時間割 FAB
// ============================================================
function toggleTTFab() {
  const open = !document.getElementById('tt-fab-actions').classList.contains('open');
  document.getElementById('tt-fab-actions').classList.toggle('open', open);
  document.getElementById('tt-fab-main').classList.toggle('open', open);
  document.getElementById('tt-fab-overlay').classList.toggle('open', open);
}
function closeTTFab() {
  document.getElementById('tt-fab-actions').classList.remove('open');
  document.getElementById('tt-fab-main').classList.remove('open');
  document.getElementById('tt-fab-overlay').classList.remove('open');
}

// ============================================================
//  時間割オーバーライド — API
// ============================================================
async function loadTTOverrides() {
  try {
    const res  = await fetch(`${API_BASE}${TT_API.LIST}?guild_id=${GUILD_ID}`);
    const data = await res.json();
    if (data.ok && Array.isArray(data.overrides)) {
      ttOverrides = {};
      data.overrides.forEach(o => { ttOverrides[o.key] = o; });
      renderTimetable();
      return;
    }
  } catch(e) {}
  // API未実装 → LocalStorageから読み込む
  try {
    const raw = localStorage.getItem('tt_overrides_' + GUILD_ID);
    ttOverrides = raw ? JSON.parse(raw) : {};
  } catch(_) { ttOverrides = {}; }
  renderTimetable();
}
function saveTTOverrideLocal() {
  localStorage.setItem('tt_overrides_' + GUILD_ID, JSON.stringify(ttOverrides));
}

// ============================================================
//  時間割編集モーダル
// ============================================================
function openTTEditModal() {
  closeTTFab();
  initCal('tt-edit', true);
  resetTTEditForm();

  // ★ 科目プルダウンをDiscordのチャンネル一覧で更新
  const ttSubjectEl = document.getElementById('tt-edit-subject');
  if (ttSubjectEl) {
    const opts = channels.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    ttSubjectEl.innerHTML = '<option value="">科目を選択</option>' + opts;
  }

  switchTTMode('change');
  renderTTOverridesList();
  document.getElementById('modal-tt-edit').classList.add('open');
}
function resetTTEditForm() {
  const subjEl = document.getElementById('tt-edit-subject');
  if (subjEl) subjEl.value = '';
  document.getElementById('tt-edit-items').value          = '';
  document.getElementById('tt-edit-note').value           = '';
  document.getElementById('tt-edit-holiday-note').value   = '';
  document.getElementById('tt-edit-holiday-reason').value = '休校';
  document.getElementById('tt-edit-period').value         = '1';

  const phReason = document.getElementById('tt-edit-period-holiday-reason');
  const phNote   = document.getElementById('tt-edit-period-holiday-note');
  if (phReason) phReason.value = '休み';
  if (phNote)   phNote.value   = '';

  const dcNote = document.getElementById('tt-day-change-note');
  if (dcNote) dcNote.value = '';
  const dcContainer = document.getElementById('tt-day-change-periods');
  if (dcContainer) dcContainer.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary)">先に日付を選択してください</div>';

  resetCal('tt-edit', '日付を選択');
}
function switchTTMode(mode) {
  ttEditMode = mode;

  ['change', 'period-holiday', 'day-change', 'holiday'].forEach(m => {
    const btn = document.getElementById('tt-mode-btn-' + m);
    if (btn) btn.classList.toggle('active', m === mode);
  });

  document.getElementById('tt-edit-change-fields').style.display         = (mode === 'change')         ? '' : 'none';
  document.getElementById('tt-edit-period-holiday-fields').style.display = (mode === 'period-holiday') ? '' : 'none';
  document.getElementById('tt-edit-day-change-fields').style.display     = (mode === 'day-change')     ? '' : 'none';
  document.getElementById('tt-edit-holiday-fields').style.display        = (mode === 'holiday')        ? '' : 'none';
  // 時限セレクトは「授業変更」と「1コマ休み」で使う
  document.getElementById('tt-edit-period-field').style.display          = (mode === 'change' || mode === 'period-holiday') ? '' : 'none';

  // ★ 曜日変更モードに切り替えたとき、すでに日付が選択済みならその日の教科一覧を再描画
  if (mode === 'day-change') {
    const d = calState['tt-edit']?.selected;
    if (d) renderDayChangeFields(d);
  }
}

// ★ 「曜日ごと変更」モード: 選択した日付の全時限を一度に変更できるフォームを描画
function renderDayChangeFields(dateStr) {
  const container = document.getElementById('tt-day-change-periods');
  if (!container) return;

  const dayKey = dateToDayKey(dateStr);
  if (!dayKey) {
    container.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary)">土日は選択できません</div>';
    return;
  }

  const basePeriods = TIMETABLE[dayKey] || [];
  const subjectOptions = channels.map(c => `<option value="${c.name}">${c.name}</option>`).join('');

  container.innerHTML = basePeriods.map((p, i) => {
    const periodNum = i + 1;
    const changeOv = ttOverrides[`change:${dateStr}:${periodNum}`];
    const currentSubject = changeOv ? changeOv.subject : p.subject;
    const currentItems   = changeOv && changeOv.items ? changeOv.items.join(', ') : '';
    return `<div class="day-change-row" style="margin-bottom:10px;padding:8px;border:1px solid var(--border);border-radius:8px">
      <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:4px">${periodNum}限（元: ${currentSubject || 'ー'}）</div>
      <select id="tt-day-change-subject-${periodNum}" class="form-select">
        <option value="">— 変更しない —</option>
        ${subjectOptions}
      </select>
      <input type="text" id="tt-day-change-items-${periodNum}" class="form-input" style="margin-top:4px" placeholder="持ち物（カンマ区切り）" value="${currentItems}">
    </div>`;
  }).join('');
}

async function submitTTEdit() {
  const date = calState['tt-edit']?.selected;
  if (!date) { showErr('tt-edit-err', '日付を選択してください'); return; }

  const btn = document.getElementById('tt-edit-submit-btn');
  setLoading(btn, '保存中…');

  try {
    if (ttEditMode === 'holiday') {
      const reason = document.getElementById('tt-edit-holiday-reason').value;
      const note   = document.getElementById('tt-edit-holiday-note').value.trim();
      const key    = `holiday:${date}`;
      try { await api(TT_API.HOLIDAY, { method: 'POST', body: JSON.stringify({ guild_id: GUILD_ID, date, reason, note, key }) }); } catch(_) {}
      ttOverrides[key] = { key, type: 'holiday', date, reason, note };

    } else if (ttEditMode === 'period-holiday') {
      // ★ 1コマだけの休み
      const period = parseInt(document.getElementById('tt-edit-period').value);
      const reason = document.getElementById('tt-edit-period-holiday-reason').value.trim() || '休み';
      const note   = document.getElementById('tt-edit-period-holiday-note').value.trim();
      const key    = `period_holiday:${date}:${period}`;
      try { await api(TT_API.PERIOD_HOLIDAY, { method: 'POST', body: JSON.stringify({ guild_id: GUILD_ID, date, period, reason, note, key }) }); } catch(_) {}
      ttOverrides[key] = { key, type: 'period_holiday', date, period, reason, note };

    } else if (ttEditMode === 'day-change') {
      // ★ 曜日ごと（1日分まとめて）変更
      const dayKey = dateToDayKey(date);
      if (!dayKey) { resetLoading(btn, '保存する'); showErr('tt-edit-err', '土日は選択できません'); return; }

      const basePeriods = TIMETABLE[dayKey] || [];
      const note = document.getElementById('tt-day-change-note').value.trim();
      let changedCount = 0;

      for (let i = 0; i < basePeriods.length; i++) {
        const periodNum = i + 1;
        const subjSel  = document.getElementById(`tt-day-change-subject-${periodNum}`);
        const itemsInp = document.getElementById(`tt-day-change-items-${periodNum}`);
        if (!subjSel || !subjSel.value) continue; // 「変更しない」はスキップ

        const subject  = subjSel.value;
        const itemsRaw = itemsInp ? itemsInp.value.trim() : '';
        const items    = itemsRaw ? itemsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
        const key = `change:${date}:${periodNum}`;
        try { await api(TT_API.UPDATE, { method: 'POST', body: JSON.stringify({ guild_id: GUILD_ID, date, period: periodNum, subject, items, note, key }) }); } catch(_) {}
        ttOverrides[key] = { key, type: 'change', date, period: periodNum, subject, items, note };
        changedCount++;
      }

      if (changedCount === 0) {
        resetLoading(btn, '保存する');
        showErr('tt-edit-err', '変更する時限を1つ以上選んでください');
        return;
      }

    } else {
      // 授業変更（1コマ）
      const period   = parseInt(document.getElementById('tt-edit-period').value);
      const subject  = document.getElementById('tt-edit-subject').value.trim();
      const itemsRaw = document.getElementById('tt-edit-items').value.trim();
      const items    = itemsRaw ? itemsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
      const note     = document.getElementById('tt-edit-note').value.trim();
      if (!subject) { resetLoading(btn, '保存する'); showErr('tt-edit-err', '科目を選択してください'); return; }
      const key = `change:${date}:${period}`;
      try { await api(TT_API.UPDATE, { method: 'POST', body: JSON.stringify({ guild_id: GUILD_ID, date, period, subject, items, note, key }) }); } catch(_) {}
      ttOverrides[key] = { key, type: 'change', date, period, subject, items, note };
    }

    saveTTOverrideLocal();
    resetLoading(btn, '保存する');
    showOk('tt-edit-ok');
    resetTTEditForm();
    renderTTOverridesList();
    renderTimetable();
  } catch(e) {
    resetLoading(btn, '保存する');
    showErr('tt-edit-err', '保存に失敗しました: ' + e.message);
  }
}
async function deleteTTOverride(key) {
  try { await api(TT_API.DELETE, { method: 'POST', body: JSON.stringify({ guild_id: GUILD_ID, key }) }); } catch(_) {}
  delete ttOverrides[key];
  saveTTOverrideLocal();
  renderTTOverridesList();
  renderTimetable();
}
function renderTTOverridesList() {
  const el   = document.getElementById('tt-overrides-list');
  const keys = Object.keys(ttOverrides).sort();
  if (!keys.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:10px 0">保存済みの変更はありません</div>';
    return;
  }
  el.innerHTML = keys.map(key => {
    const ov = ttOverrides[key];
    let info = '', badge = '';
    if (ov.type === 'holiday') {
      const note = ov.note ? `（${ov.note}）` : '';
      info  = `${ov.date}　${ov.reason}${note}`;
      badge = `<span class="override-badge-holiday">休校</span>`;
    } else if (ov.type === 'period_holiday') {
      const note = ov.note ? `（${ov.note}）` : '';
      info  = `${ov.date} ${ov.period}限　${ov.reason}${note}`;
      badge = `<span class="override-badge-holiday">1コマ休み</span>`;
    } else {
      info  = `${ov.date} ${ov.period}限 → ${ov.subject}`;
      badge = `<span class="override-badge-change">変更</span>`;
    }
    return `<div class="override-row">
      <div class="override-info">${badge} ${info}</div>
      <button class="override-del-btn" onclick="deleteTTOverride('${key}')" title="削除">✕</button>
    </div>`;
  }).join('');
}

// ============================================================
//  予定管理（時間割ページでも追加・編集・削除できる）
// ============================================================
async function loadChannels() {
  try {
    const data = await api(`/channels?guild_id=${GUILD_ID}`);
    channels = data.ok ? data.channels : [];
  } catch(e) { channels = []; }
  renderChannelOptions();
}
async function loadPlans() {
  try {
    const data = await api(`/list_schedule?guild_id=${GUILD_ID}`);
    plans = data.ok ? data.plans : [];
  } catch(e) { plans = []; }
}
function renderChannelOptions() {
  const opts = channels.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  document.getElementById('add-subject').innerHTML  = opts || '<option value="">（なし）</option>';
  document.getElementById('edit-subject').innerHTML = '<option value="">— 変更しない —</option>' + opts;

  // ★ 時間割編集モーダルの科目プルダウンもDiscordチャンネルで更新
  const ttSubjectEl = document.getElementById('tt-edit-subject');
  if (ttSubjectEl) ttSubjectEl.innerHTML = '<option value="">科目を選択</option>' + opts;

  // ★ 曜日変更モードが開いていて日付選択済みなら、その場でも更新
  const d = calState['tt-edit']?.selected;
  if (ttEditMode === 'day-change' && d) renderDayChangeFields(d);
}

function parsePlanContent(raw) {
  const cat  = raw.match(/^【(.+?)】/)?.[1] || '';
  const text = raw.replace(/^【.+?】/, '').trim();
  return { cat, text };
}
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
    const ptsWrap = document.getElementById('edit-points-wrap');
    if (plan && ptsWrap) {
      const { cat } = parsePlanContent(plan.content);
      if (POINT_CATEGORIES.includes(cat)) {
        ptsWrap.style.display = 'block';
        selectedPoints['edit'] = POINT_OPTIONS.includes(plan.points) ? plan.points : null;
        renderPointsChips('edit');
        const lbl = ptsWrap.querySelector('.pts-label');
        if (lbl) {
          lbl.textContent = (plan.points != null)
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

function openModal(name) {
  closeTTFab();
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
    const wrap = document.getElementById('edit-points-wrap');
    if (wrap) wrap.style.display = 'none';
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

async function submitAdd() {
  const date     = calState['add']?.selected;
  const subject  = document.getElementById('add-subject').value;
  const category = getCatValue('add');
  if (!category) { showErr('add-err', 'カテゴリを入力してください'); return; }
  const content = document.getElementById('add-content').value.trim();
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
      const wrap = document.getElementById('add-points-wrap');
      if (wrap) wrap.style.display = 'none';
      resetCal('add', '日付を選択');
      await loadPlans();
    } else { showErr('add-err', res.message || 'エラーが発生しました'); }
  } catch(e) { resetLoading(btn, '追加する'); showErr('add-err', 'サーバーに接続できませんでした'); }
}

async function submitEdit() {
  if (!editTarget) { showErr('edit-err', '予定を選択してください'); return; }
  const body = { guild_id: GUILD_ID, target: editTarget };
  const d = calState['edit']?.selected; if (d) body.date = d;
  const s = document.getElementById('edit-subject').value;       if (s) body.subject = s;
  const c = getCatValue('edit');                                   if (c) body.category = c;
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
      const wrap = document.getElementById('edit-points-wrap');
      if (wrap) wrap.style.display = 'none';
      resetCal('edit', '変更しない場合は空欄');
      await loadPlans();
      renderSelectList('edit-list', 'edit');
    } else { showErr('edit-err', res.message || 'エラーが発生しました'); }
  } catch(e) { resetLoading(btn, '保存する'); showErr('edit-err', 'サーバーに接続できませんでした'); }
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
    } else { showErr('del-err', res.message || 'エラーが発生しました'); }
  } catch(e) { resetLoading(btn, '削除する'); showErr('del-err', 'サーバーに接続できませんでした'); }
}

// ============================================================
//  UI ヘルパー
// ============================================================
function setLoading(btn, label, dark = false) {
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner${dark ? ' spinner-dark' : ''}"></span>${label}`;
}
function resetLoading(btn, label) { btn.disabled = false; btn.textContent = label; }
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
  if (sel.value === '__custom__') return document.getElementById(prefix + '-category-inp').value.trim();
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
const CAL_M = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

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

  // ★ 曜日変更モードで日付を選んだら、その日の教科一覧を描画
  if (id === 'tt-edit' && ttEditMode === 'day-change') renderDayChangeFields(ds);
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
//  ★ JSON変更監視（予定・課題JSON・時間割オーバーライド）
//     いずれかに変化があったら、データだけ再取得して
//     時間割を再描画する（フルリロードはしない）
// ============================================================

// SHA-256 ハッシュ計算
async function digestMessage(message) {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// 指定URLのレスポンス本文からハッシュを計算
async function hashOfUrl(url) {
  const res = await fetch(url);
  const txt = await res.text();
  return digestMessage(txt);
}

// 監視対象3種類の最新ハッシュ（初回はnull＝比較せず保存だけ）
let watchHashes = {
  schedule:  null, // 予定・課題（list_schedule）
  homeworks: null, // 課題JSON（JSON_URL）
  overrides: null, // 時間割変更・休校（list_timetable）
};

// 監視対象データをまとめて再取得＆再描画
async function refreshWatchedData() {
  await Promise.all([
    loadTTHomeworks(),
    loadTTOverrides(),
    loadPlans(),
  ]);
  renderTimetable();
}

// 変更チェック本体
async function checkForUpdates() {
  try {
    const [scheduleHash, homeworksHash, overridesHash] = await Promise.all([
      hashOfUrl(`${API_BASE}list_schedule?guild_id=${GUILD_ID}`),
      hashOfUrl(JSON_URL),
      hashOfUrl(`${API_BASE}${TT_API.LIST}?guild_id=${GUILD_ID}`),
    ]);

    const isFirstCheck = watchHashes.schedule === null;

    const changed = !isFirstCheck && (
      scheduleHash  !== watchHashes.schedule  ||
      homeworksHash !== watchHashes.homeworks ||
      overridesHash !== watchHashes.overrides
    );

    watchHashes = {
      schedule:  scheduleHash,
      homeworks: homeworksHash,
      overrides: overridesHash,
    };

    if (changed) {
      await refreshWatchedData();
    }
  } catch(e) {}
}

// 10秒ごとにチェック
setInterval(checkForUpdates, 10000);
