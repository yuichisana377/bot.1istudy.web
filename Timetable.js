// ============================================================
//  timetable.js — 時間割ページ用スクリプト
//  timetable.html から読み込む
// ============================================================

const API_BASE = "https://chiro-ubuntuserver.tail1130ba.ts.net/";
const GUILD_ID = "1509880344806162544";

// ★ ポイント付与対象カテゴリ
const POINT_CATEGORIES = ['提出', '宿題'];

// ★ ポイント選択肢
const POINT_OPTIONS = [3, 5, 10, 15];

// ★ 備考をcontent文字列に埋め込むための区切り文字列
//   Botがそのままcontentをディスコードに投稿するため、見た目が崩れない読める形にする
const NOTE_SEP = '\n📝備考：';

// ============================================================
//  時間割固定データ（★学期の時間割が未設定の期間に使うフォールバック用）
//  前期・後期など、学期ごとに違う時間割は下の「学期の時間割」機能
//  （terms / getTimetableForDate）で管理する。ここは何も学期が
//  設定されていない期間のためのデフォルト値として残す。
// ============================================================
const DEFAULT_TIMETABLE = {
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
  PERIOD_HOLIDAY: '/set_period_holiday', // 1コマだけの休み（サーバー側に保存。ローカルにもフォールバック保存）
  DELETE:         '/delete_timetable',
  LIST:           '/list_timetable',
};

// 学期（前期・後期など）の基本時間割 API エンドポイント
const TERM_API = {
  LIST:   '/list_terms',
  SAVE:   '/save_term',
  DELETE: '/delete_term',
};

// ============================================================
//  グローバル状態
// ============================================================
let weekOffset  = 0;
let ttActiveDay = 0;

// ★ 月間カレンダー用の状態
let monthOffset       = 0;    // 0=今月, +1=来月, -1=先月 ...
let monthDetailTarget = null; // 月間カレンダーで日付をタップしたときの対象日 (YYYY-MM-DD)
let ttHomeworks = [];
let ttOverrides = {};
let ttEditMode  = 'change'; // 'change' | 'period-holiday' | 'day-change' | 'holiday'

// ★ 学期（前期・後期など）ごとの基本時間割
let terms = []; // [{ id, name, start_date, end_date, timetable: {mon:[...],...} }, ...]
let termEditState = null; // 学期編集モーダルの入力中データ

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
  loadTerms();
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
    const data = await api(`/list_schedule?guild_id=${GUILD_ID}`);
    ttHomeworks = (data.ok && Array.isArray(data.plans)) ? data.plans : [];
  } catch(e) {
    ttHomeworks = [];
  }
  renderTimetable();
}

// ============================================================
//  学期（前期・後期など）の基本時間割
// ============================================================
async function loadTerms() {
  try {
    const res  = await api(`${TERM_API.LIST}?guild_id=${GUILD_ID}`);
    terms = (res.ok && Array.isArray(res.terms)) ? res.terms : [];
  } catch(e) {
    terms = [];
  }
  renderTimetable();
}

// ★ 指定した日付に適用すべき基本時間割を返す。
//   その日付が start_date〜end_date に収まる学期があればそれを使い、
//   無ければ DEFAULT_TIMETABLE（学期未設定時のフォールバック）を使う。
//   ※ 複数の学期が同じ日付に重なることは保存時にサーバー側で防いでいるため、
//     最初に一致したものを使えばよい。
function getTimetableForDate(dateStr) {
  const term = terms.find(t => t.start_date <= dateStr && dateStr <= t.end_date);
  return (term && term.timetable) ? term.timetable : DEFAULT_TIMETABLE;
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
  const basePeriods = getTimetableForDate(dateStr)[dayKey] || [];

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
        return `<div class="period-row" onclick="showTTDetail('${dateStr}', ${periodNum})">
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
        const { cat, text } = parsePlanContent(h.content);
        return `<div class="homework-row">
          <span class="tt-badge tt-badge-${cat}">${cat}</span>
          <span class="homework-text">${text}</span>
        </div>`;
      }).join('');
      const changedBadge = isChanged
        ? `<span style="font-size:10px;background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:20px;font-weight:700;margin-left:4px">変更</span>` : '';

      return `<div class="period-row" onclick="showTTDetail('${dateStr}', ${periodNum})">
        <div class="period-num">${periodNum}</div>
        <div class="period-subject${subject ? '' : ' empty'}">${subject || 'ー'}${changedBadge}</div>
        <div class="period-right">
          ${itemsHtml}
          ${hwHtml}
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
  </div>` + buildMonthCalendarHtml();
}

// ============================================================
//  ★ 月間カレンダー
// ============================================================

// ★ 指定日の「予定」を、予定管理（plans）と課題JSON（ttHomeworks）
//   の両方から集めて返す。同じ内容が両方にある場合は重複させない。
function getDatePlanItems(dateStr) {
  const items = [];
  const seen  = new Set();

  const pushItem = (subject, raw) => {
    const { cat, text, note } = parsePlanContent(raw);
    const key = `${subject}|${cat}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ subject, cat, text, note });
  };

  plans.filter(p => p.date === dateStr).forEach(p => pushItem(p.subject, p.content));
  ttHomeworks.filter(h => h.date === dateStr).forEach(h => pushItem(h.subject, h.content));

  return items;
}

function buildMonthCalendarHtml() {
  const now   = new Date();
  const base  = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year  = base.getFullYear();
  const month = base.getMonth(); // 0-indexed
  const todayStr  = getDateStr(now);
  const firstDow  = new Date(year, month, 1).getDay(); // 0=日
  const daysInMon = new Date(year, month + 1, 0).getDate();

  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += `<div class="mc-day mc-empty"></div>`;

  for (let d = 1; d <= daysInMon; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow     = new Date(year, month, d).getDay();
    const holidayOv = ttOverrides[`holiday:${dateStr}`];
    const hasItems  = getDatePlanItems(dateStr).length > 0;

    let cls = 'mc-day';
    if (dow === 0) cls += ' mc-sun-col';
    if (dow === 6) cls += ' mc-sat-col';
    if (dateStr === todayStr) cls += ' mc-today';
    if (holidayOv) cls += ' mc-holiday';

    const dotsHtml = (holidayOv || hasItems)
      ? `<div class="mc-dots"><span class="mc-dot"></span></div>` : `<div class="mc-dots"></div>`;

    cells += `<div class="${cls}" onclick="onMonthDayClick('${dateStr}')">
      <span class="mc-num">${d}</span>
      ${dotsHtml}
    </div>`;
  }

  const totalCells = firstDow + daysInMon;
  const trailing = (7 - (totalCells % 7)) % 7;
  for (let i = 0; i < trailing; i++) cells += `<div class="mc-day mc-empty"></div>`;

  return `<section class="month-cal-card">
    <div class="month-cal-header">
      <button class="month-nav-btn" onclick="moveMonth(-1)">‹</button>
      <span class="month-cal-label">${year}年 ${month+1}月</span>
      <button class="month-nav-btn" onclick="moveMonth(1)">›</button>
      <button class="month-cal-today-btn" onclick="monthGoToday()">今月</button>
    </div>
    <div class="month-cal-dow">
      <span class="mc-sun">日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span class="mc-sat">土</span>
    </div>
    <div class="month-cal-grid">${cells}</div>
    <div class="month-cal-legend">
      <span class="mcl-item"><span class="mcl-dot mcl-dot-plan"></span>予定あり</span>
      <span class="mcl-item"><span class="mcl-dot mcl-dot-holiday"></span>終日休み</span>
    </div>
  </section>`;
}

function moveMonth(dir) {
  monthOffset += dir;
  renderTimetable();
}
function monthGoToday() {
  monthOffset = 0;
  renderTimetable();
}

// ★ 月間カレンダーで日付をタップしたときに、その日の予定・休み情報を表示する
function onMonthDayClick(dateStr) {
  monthDetailTarget = dateStr;

  const d = new Date(dateStr + 'T00:00:00');
  const dowLabel  = ['日','月','火','水','木','金','土'][d.getDay()];
  const holidayOv = ttOverrides[`holiday:${dateStr}`];
  const items     = getDatePlanItems(dateStr);

  document.getElementById('month-detail-title').textContent =
    `${d.getMonth()+1}月${d.getDate()}日（${dowLabel}）`;

  let html = '';
  if (holidayOv) {
    const reason = holidayOv.reason || '休校';
    const note   = holidayOv.note   ? `（${holidayOv.note}）` : '';
    html += `<div style="text-align:center;padding:1rem 0">
      <div style="font-size:22px;margin-bottom:6px">🏫</div>
      <div style="font-size:15px;font-weight:700;color:var(--text)">${reason}${note}</div>
      <div style="font-size:12px;color:var(--text-tertiary);margin-top:4px">この日は終日お休みです</div>
    </div>`;
  }

  if (items.length) {
    html += `<div class="detail-list" style="margin-top:${holidayOv ? '10px' : '0'}">` + items.map(it => `
      <div class="detail-item">
        <div class="dl-label">${it.subject || '予定'}</div>
        <div class="dl-value">
          <span class="tt-badge tt-badge-${it.cat}">${it.cat}</span> ${it.text}
          ${it.note ? `<div class="dl-value dl-note" style="margin-top:6px">${it.note}</div>` : ''}
        </div>
      </div>`).join('') + `</div>`;
  }

  if (!holidayOv && !items.length) {
    html = `<div style="text-align:center;padding:1.5rem;color:var(--text-tertiary);font-size:13px">この日の予定はありません</div>`;
  }

  document.getElementById('month-detail-content').innerHTML = html;

  const dayKey  = dateToDayKey(dateStr);
  const jumpBtn = document.getElementById('month-detail-jump-btn');
  jumpBtn.style.display = dayKey ? 'block' : 'none';

  document.getElementById('modal-month-detail').classList.add('open');
}

// ★ 月間カレンダーの詳細から「この日の時間割を見る」→ 週表示の該当曜日へジャンプ
function jumpToDayFromMonth() {
  if (!monthDetailTarget) return;
  const dayKey = dateToDayKey(monthDetailTarget);
  if (!dayKey) return;

  const now = new Date();
  const day = now.getDay();
  const thisMon = new Date(now);
  thisMon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));

  const target = new Date(monthDetailTarget + 'T00:00:00');
  const tDow = target.getDay();
  const targetMon = new Date(target);
  targetMon.setDate(target.getDate() - (tDow === 0 ? 6 : tDow - 1));

  weekOffset  = Math.round((targetMon - thisMon) / (1000*60*60*24*7));
  ttActiveDay = DAY_KEYS.indexOf(dayKey);

  closeModal('month-detail');
  renderTimetable();
  const sb = document.querySelector('.scroll-body');
  if (sb) sb.scrollTo({ top: 0, behavior: 'smooth' });
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
  // ★ ローカル保存分を先に読み込んでおく。
  //   「1コマ休み」などバックエンドがまだ対応していない種類の変更は
  //   ここ（localStorage）にしか残らないため、消さずに後でマージする。
  let localOverrides = {};
  try {
    const raw = localStorage.getItem('tt_overrides_' + GUILD_ID);
    localOverrides = raw ? JSON.parse(raw) : {};
  } catch(_) { localOverrides = {}; }

  try {
    const res  = await fetch(`${API_BASE}${TT_API.LIST}?guild_id=${GUILD_ID}`);
    const data = await res.json();
    if (data.ok && Array.isArray(data.overrides)) {
      const serverOverrides = {};
      data.overrides.forEach(o => { serverOverrides[o.key] = o; });
      // ★ サーバーの内容を優先しつつ、サーバーにまだ無い（未対応/未反映の）
      //   ローカルだけの変更は残す。
      //   → これにより「保存した変更がしばらくすると元に戻る」問題を防ぐ。
      ttOverrides = { ...localOverrides, ...serverOverrides };
      saveTTOverrideLocal(); // マージ結果をローカルにも保存し直す
      renderTimetable();
      return;
    }
  } catch(e) {}
  // サーバーから取得できない場合はローカルのみで表示
  ttOverrides = localOverrides;
  renderTimetable();
}
function saveTTOverrideLocal() {
  localStorage.setItem('tt_overrides_' + GUILD_ID, JSON.stringify(ttOverrides));
}

// ============================================================
//  ★ 時間割 詳細モーダル（コマをタップして表示）
// ============================================================
let ttDetailTarget = null; // { date, period } ← 詳細モーダルで表示中のコマ

function showTTDetail(dateStr, period) {
  const dayKey      = dateToDayKey(dateStr);
  const basePeriods = getTimetableForDate(dateStr)[dayKey] || [];
  const base        = basePeriods[period - 1];

  const holidayOv = ttOverrides[`period_holiday:${dateStr}:${period}`];
  const changeOv  = ttOverrides[`change:${dateStr}:${period}`];

  ttDetailTarget = { date: dateStr, period };

  const d = new Date(dateStr + 'T00:00:00');
  const wIdx = DAY_KEYS.indexOf(dayKey);
  const dateLabel = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日${wIdx >= 0 ? `（${DAY_NAMES[wIdx]}）` : ''}`;

  const rows = [
    `<div class="detail-item"><div class="dl-label">日付</div><div class="dl-value">${dateLabel}</div></div>`,
    `<div class="detail-item"><div class="dl-label">時限</div><div class="dl-value">${period}時限</div></div>`,
  ];

  if (holidayOv) {
    const note = holidayOv.note ? `（${holidayOv.note}）` : '';
    rows.push(`<div class="detail-item"><div class="dl-label">状態</div><div class="dl-value">🚫 ${holidayOv.reason || '休み'}${note}</div></div>`);
  } else {
    const subject = changeOv ? (changeOv.subject || (base && base.subject)) : (base && base.subject);
    const items   = changeOv ? (changeOv.items || [])                      : ((base && base.items) || []);

    rows.push(`<div class="detail-item"><div class="dl-label">科目</div><div class="dl-value">${subject || 'ー'}${changeOv ? ' <span style="font-size:10px;background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:20px;font-weight:700">変更あり</span>' : ''}</div></div>`);

    if (items.length) {
      rows.push(`<div class="detail-item"><div class="dl-label">持ち物</div><div class="dl-value">${items.map(it => `📎 ${it}`).join('　')}</div></div>`);
    }

    const hw = ttHomeworks.filter(h => h.date === dateStr && h.subject === subject);
    if (hw.length) {
      const hwHtml = hw.map(h => {
        const { cat, text, note: hwNote } = parsePlanContent(h.content);
        const hwNoteHtml = hwNote ? `<div class="dl-note" style="margin-top:4px">${hwNote}</div>` : '';
        return `<div style="margin-bottom:6px"><span class="tt-badge tt-badge-${cat}">${cat}</span> ${text}${hwNoteHtml}</div>`;
      }).join('');
      rows.push(`<div class="detail-item"><div class="dl-label">課題・提出物</div><div class="dl-value">${hwHtml}</div></div>`);
    }

    if (changeOv && changeOv.note) {
      rows.push(`<div class="detail-item"><div class="dl-label">備考</div><div class="dl-value dl-note">${changeOv.note}</div></div>`);
    }
  }

  document.getElementById('tt-detail-content').innerHTML = rows.join('');
  document.getElementById('modal-tt-detail').classList.add('open');
}

// ★ 詳細モーダルの「この時間割を変更する」ボタン
//   → 時間割編集モーダルを開き、タップしたコマの日付・時限をあらかじめ入力しておく
function editFromTTDetail() {
  if (!ttDetailTarget) return;
  const { date, period } = ttDetailTarget;

  closeModal('tt-detail');
  openTTEditModal();

  // 対象日付をセット
  calState['tt-edit'].selected = date;
  const [y, m, dd] = date.split('-');
  const dateEl = document.getElementById('tt-edit-date-text');
  dateEl.textContent = `${y}年${parseInt(m)}月${parseInt(dd)}日`;
  dateEl.style.color = 'var(--text)';
  renderCal('tt-edit');

  // 時限をセット
  const periodEl = document.getElementById('tt-edit-period');
  if (periodEl) periodEl.value = String(period);

  const holidayOv = ttOverrides[`period_holiday:${date}:${period}`];
  const changeOv  = ttOverrides[`change:${date}:${period}`];

  if (holidayOv) {
    // すでに「1コマ休み」になっているコマ → 休みタブを開いて現在の内容を表示
    switchTTMode('period-holiday');
    document.getElementById('tt-edit-period-holiday-reason').value = holidayOv.reason || '休み';
    document.getElementById('tt-edit-period-holiday-note').value   = holidayOv.note   || '';
  } else {
    // 授業変更タブを開いて、現在の内容（変更済みならその内容、なければ通常の時間割）を初期値にする
    switchTTMode('change');
    const dayKey = dateToDayKey(date);
    const base   = (getTimetableForDate(date)[dayKey] || [])[period - 1];

    const subject = changeOv ? (changeOv.subject || (base && base.subject)) : (base && base.subject);
    const items   = changeOv ? (changeOv.items || [])                      : ((base && base.items) || []);
    const note    = changeOv ? (changeOv.note || '')                       : '';

    const subjEl = document.getElementById('tt-edit-subject');
    if (subjEl) subjEl.value = subject || '';
    document.getElementById('tt-edit-items').value = items.join(',');
    document.getElementById('tt-edit-note').value  = note;
  }
}

// ============================================================
//  時間割編集モーダル
// ============================================================
function openTTEditModal() {
  closeTTFab();
  initCal('tt-edit', true);
  initCal('tt-edit-end', true);
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
  const dcSource = document.getElementById('tt-day-change-source');
  if (dcSource) dcSource.value = '';
  const dcPreview = document.getElementById('tt-day-change-preview');
  if (dcPreview) dcPreview.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary)">先に日付とコピー元の曜日を選択してください</div>';

  // ★ 複数日設定をリセット
  const multiCb = document.getElementById('tt-edit-multi');
  if (multiCb) multiCb.checked = false;
  const endField = document.getElementById('tt-edit-end-date-field');
  if (endField) endField.style.display = 'none';
  const dateLabel = document.getElementById('tt-edit-date-label');
  if (dateLabel) dateLabel.textContent = '対象日付';

  resetCal('tt-edit', '日付を選択');
  resetCal('tt-edit-end', '終了日を選択');
}

// ★ 「複数日にまとめて適用する」チェックボックスが切り替わったとき
function onMultiDateToggle() {
  const checked   = !!document.getElementById('tt-edit-multi')?.checked;
  const endField  = document.getElementById('tt-edit-end-date-field');
  const dateLabel = document.getElementById('tt-edit-date-label');
  if (endField)  endField.style.display = checked ? '' : 'none';
  if (dateLabel) dateLabel.textContent  = checked ? '開始日' : '対象日付';

  if (ttEditMode === 'day-change') {
    const d = calState['tt-edit']?.selected;
    if (d) renderDayChangePreview(d);
  }
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

  // ★ 曜日変更モードに切り替えたとき、すでに日付が選択済みならプレビューを再描画
  if (mode === 'day-change') {
    const d = calState['tt-edit']?.selected;
    if (d) renderDayChangePreview(d);
  }
}

// ★ コピー元の曜日セレクトが変更されたときに呼ばれる
function onDayChangeSourceSelect() {
  const d = calState['tt-edit']?.selected;
  if (d) renderDayChangePreview(d);
}

const DAY_KEY_LABEL = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金' };

// ★ 「曜日変更」モード: 対象日を、選んだ別の曜日の時間割にまるごと入れ替えるプレビューを描画
//    （例: 今日は金曜日だけど、月曜日の時間割で授業をする）
function renderDayChangePreview(dateStr) {
  const container = document.getElementById('tt-day-change-preview');
  if (!container) return;

  const sourceSel = document.getElementById('tt-day-change-source');
  const sourceDayKey = sourceSel ? sourceSel.value : '';
  if (!sourceDayKey) {
    container.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary)">コピー元の曜日を選択してください</div>';
    return;
  }

  // ★ 複数日モード（夏休みなど）の場合は、範囲全体への適用であることを説明するだけにする
  const isMulti = document.getElementById('tt-edit-multi')?.checked;
  if (isMulti) {
    const endDate = calState['tt-edit-end']?.selected;
    container.innerHTML = `<div style="font-size:13px;color:var(--text-tertiary)">
      ${dateStr} 〜 ${endDate || '（終了日未選択）'} の期間中の平日すべてに、${DAY_KEY_LABEL[sourceDayKey]}曜日の時間割を適用します（土日は自動的にスキップされます）
    </div>`;
    return;
  }

  const targetDayKey = dateToDayKey(dateStr);
  if (!targetDayKey) {
    container.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary)">土日は選択できません</div>';
    return;
  }

  const targetPeriods = getTimetableForDate(dateStr)[targetDayKey] || [];
  const sourcePeriods = getTimetableForDate(dateStr)[sourceDayKey] || [];

  const rows = targetPeriods.map((_, i) => {
    const periodNum = i + 1;
    const src = sourcePeriods[i];
    const subjectText = src ? src.subject : '（コマなし・空きコマ扱い）';
    return `<div class="day-change-row" style="margin-bottom:6px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;display:flex;justify-content:space-between">
      <span>${periodNum}限</span><span style="color:var(--text)">${subjectText}</span>
    </div>`;
  }).join('');

  container.innerHTML = `<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:6px">
    ${DAY_KEY_LABEL[targetDayKey]}曜日（${dateStr}）が ${DAY_KEY_LABEL[sourceDayKey]}曜日の時間割になります
  </div>${rows}`;
}

// ============================================================
//  ★ 各編集モードの「1日分」の保存処理（複数日への一括適用でも使う）
// ============================================================
async function applyHolidayForDate(date, reason, note) {
  const key = `holiday:${date}`;
  try { await api(TT_API.HOLIDAY, { method: 'POST', body: JSON.stringify({ guild_id: GUILD_ID, date, reason, note, key }) }); } catch(_) {}
  ttOverrides[key] = { key, type: 'holiday', date, reason, note };
}

async function applyPeriodHolidayForDate(date, period, reason, note) {
  const key = `period_holiday:${date}:${period}`;
  try { await api(TT_API.PERIOD_HOLIDAY, { method: 'POST', body: JSON.stringify({ guild_id: GUILD_ID, date, period, reason, note, key }) }); } catch(_) {}
  ttOverrides[key] = { key, type: 'period_holiday', date, period, reason, note };
}

async function applyChangeForDate(date, period, subject, items, note) {
  const key = `change:${date}:${period}`;
  try { await api(TT_API.UPDATE, { method: 'POST', body: JSON.stringify({ guild_id: GUILD_ID, date, period, subject, items, note, key }) }); } catch(_) {}
  ttOverrides[key] = { key, type: 'change', date, period, subject, items, note };
}

async function applyDayChangeForDate(date, sourceDayKey, note) {
  // ★ 曜日変更: 対象日を、選んだ別の曜日の時間割にまるごと入れ替える
  //    （例: 今日は金曜日だけど、月曜日の時間割で授業をする）
  const targetDayKey = dateToDayKey(date);
  if (!targetDayKey) return; // 土日は自動的にスキップ

  const targetPeriods = getTimetableForDate(date)[targetDayKey] || [];
  const sourcePeriods = getTimetableForDate(date)[sourceDayKey] || [];
  for (let i = 0; i < targetPeriods.length; i++) {
    const periodNum = i + 1;
    delete ttOverrides[`change:${date}:${periodNum}`];
    delete ttOverrides[`period_holiday:${date}:${periodNum}`];
  }

  for (let i = 0; i < targetPeriods.length; i++) {
    const periodNum = i + 1;
    const src = sourcePeriods[i];

    if (src) {
      // コピー元の曜日にこのコマがある → 授業を入れ替え
      await applyChangeForDate(date, periodNum, src.subject, src.items || [], note);
    } else {
      // コピー元の曜日にこのコマが無い → 空きコマ（1コマ休み）扱い
      await applyPeriodHolidayForDate(date, periodNum, 'コマなし', note);
    }
  }
}

// ============================================================
//  ★ 学期（前期・後期など）の時間割設定
//    ・前期／後期のように、期間ごとにまるごと違う基本時間割
//      （曜日×時限の科目・持ち物）を、それぞれ独立したデータとして
//      サーバーに保存する。
//    ・学期は id ごとに完全に別データなので、後期の内容を編集・保存しても
//      前期のデータは一切変更されない。
//    ・表示側は getTimetableForDate(dateStr) が、その日付が含まれる
//      学期のデータを自動で選んで使う（該当する学期が無ければ
//      DEFAULT_TIMETABLE を使う）。
// ============================================================
const TERM_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

function emptyTermTimetable() {
  return { mon: [], tue: [], wed: [], thu: [], fri: [] };
}
function cloneDayPeriods(periods) {
  return (periods || []).map(p => ({ subject: p.subject || '', items: [...(p.items || [])] }));
}
// ★ 新規学期を作るときは、今日時点で使われている時間割（学期未設定なら
//   DEFAULT_TIMETABLE）をコピーして初期値にする。ゼロから全コマ入力し
//   なくて済むようにするため。
function cloneTimetableForNewTerm() {
  const base = getTimetableForDate(getDateStr(new Date()));
  const copy = emptyTermTimetable();
  TERM_DAY_KEYS.forEach(k => { copy[k] = cloneDayPeriods(base[k]); });
  return copy;
}
function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function openTermModal() {
  closeTTFab();
  resetTermForm();
  loadTerms().then(renderTermList);
  document.getElementById('modal-tt-term').classList.add('open');
}

function resetTermForm() {
  termEditState = { id: null, activeDay: 'mon', timetable: cloneTimetableForNewTerm() };

  const nameSel = document.getElementById('tt-term-name-sel');
  const nameInp = document.getElementById('tt-term-name-inp');
  if (nameSel) nameSel.value = '前期';
  if (nameInp) { nameInp.style.display = 'none'; nameInp.value = ''; }

  initCal('tt-term-start', true);
  initCal('tt-term-end', true);
  resetCal('tt-term-start', '開始日を選択');
  resetCal('tt-term-end', '終了日を選択');

  document.querySelectorAll('#tt-term-day-tabs .tt-mode-btn').forEach((b, i) => {
    b.classList.toggle('active', i === 0);
  });
  renderTermDayEditor();

  const err = document.getElementById('tt-term-err');
  if (err) err.style.display = 'none';
  resetLoading(document.getElementById('tt-term-submit-btn'), '保存する');
}

function onTermNameSel() {
  const sel = document.getElementById('tt-term-name-sel');
  const inp = document.getElementById('tt-term-name-inp');
  if (!sel || !inp) return;
  if (sel.value === '__custom__') { inp.style.display = 'block'; inp.focus(); }
  else { inp.style.display = 'none'; }
}
function getTermNameValue() {
  const sel = document.getElementById('tt-term-name-sel');
  if (!sel) return '';
  if (sel.value === '__custom__') return (document.getElementById('tt-term-name-inp')?.value || '').trim();
  return sel.value;
}

function switchTermDay(day) {
  if (!termEditState) return;
  termEditState.activeDay = day;
  const idx = TERM_DAY_KEYS.indexOf(day);
  document.querySelectorAll('#tt-term-day-tabs .tt-mode-btn').forEach((b, i) => {
    b.classList.toggle('active', i === idx);
  });
  renderTermDayEditor();
}

function renderTermDayEditor() {
  const container = document.getElementById('tt-term-day-editor');
  if (!container || !termEditState) return;
  const day = termEditState.activeDay;
  const periods = termEditState.timetable[day] || [];

  const rows = periods.map((p, i) => `
    <div class="tt-term-period-row">
      <div class="tt-term-period-num">${i + 1}限</div>
      <div class="tt-term-period-fields">
        <input type="text" value="${escapeAttr(p.subject)}" placeholder="科目名"
          oninput="updateTermPeriod('${day}',${i},'subject',this.value)">
        <input type="text" value="${escapeAttr((p.items || []).join(','))}" placeholder="持ち物（カンマ区切り）"
          oninput="updateTermPeriod('${day}',${i},'items',this.value)">
      </div>
      <button type="button" class="tt-term-period-del" onclick="removeTermPeriod('${day}',${i})" title="このコマを削除">✕</button>
    </div>`).join('');

  container.innerHTML =
    (rows || `<div style="font-size:13px;color:var(--text-tertiary);padding:6px 0">まだコマがありません</div>`) +
    `<button type="button" class="tt-btn-secondary" onclick="addTermPeriod('${day}')">＋ コマを追加</button>`;
}

function updateTermPeriod(day, idx, field, value) {
  if (!termEditState) return;
  const p = termEditState.timetable[day][idx];
  if (!p) return;
  if (field === 'items') p.items = value.split(',').map(s => s.trim()).filter(Boolean);
  else p.subject = value;
}
function addTermPeriod(day) {
  if (!termEditState) return;
  termEditState.timetable[day] = termEditState.timetable[day] || [];
  termEditState.timetable[day].push({ subject: '', items: [] });
  renderTermDayEditor();
}
function removeTermPeriod(day, idx) {
  if (!termEditState) return;
  termEditState.timetable[day].splice(idx, 1);
  renderTermDayEditor();
}

function renderTermList() {
  const el = document.getElementById('tt-term-list');
  if (!el) return;
  if (!terms.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary)">まだ学期が登録されていません（未登録の期間はデフォルトの時間割が使われます）</div>';
    return;
  }
  const sorted = [...terms].sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  el.innerHTML = sorted.map(t => `
    <div class="tt-term-list-row">
      <div class="tt-term-list-info">
        <div class="tt-term-list-name">${t.name}</div>
        <div class="tt-term-list-range">${t.start_date} 〜 ${t.end_date}</div>
      </div>
      <button type="button" class="tt-btn-secondary" onclick="editTermFromList('${t.id}')">編集</button>
      <button type="button" class="tt-term-period-del" onclick="deleteTermFromList('${t.id}')" title="削除">✕</button>
    </div>`).join('');
}

function editTermFromList(id) {
  const t = terms.find(x => x.id === id);
  if (!t) return;

  termEditState = {
    id: t.id,
    activeDay: 'mon',
    timetable: (() => {
      const copy = emptyTermTimetable();
      TERM_DAY_KEYS.forEach(k => { copy[k] = cloneDayPeriods(t.timetable[k]); });
      return copy;
    })(),
  };

  const nameSel = document.getElementById('tt-term-name-sel');
  const nameInp = document.getElementById('tt-term-name-inp');
  if (nameSel && nameInp) {
    if (t.name === '前期' || t.name === '後期') {
      nameSel.value = t.name;
      nameInp.style.display = 'none';
    } else {
      nameSel.value = '__custom__';
      nameInp.style.display = 'block';
      nameInp.value = t.name;
    }
  }

  initCal('tt-term-start', true);
  initCal('tt-term-end', true);
  calState['tt-term-start'].selected = t.start_date;
  calState['tt-term-end'].selected   = t.end_date;
  const [sy, sm, sd] = t.start_date.split('-');
  const [ey, em, ed] = t.end_date.split('-');
  const startText = document.getElementById('tt-term-start-date-text');
  const endText   = document.getElementById('tt-term-end-date-text');
  if (startText) { startText.textContent = `${sy}年${parseInt(sm)}月${parseInt(sd)}日`; startText.style.color = 'var(--text)'; }
  if (endText)   { endText.textContent   = `${ey}年${parseInt(em)}月${parseInt(ed)}日`; endText.style.color   = 'var(--text)'; }
  renderCal('tt-term-start');
  renderCal('tt-term-end');

  switchTermDay('mon');

  const err = document.getElementById('tt-term-err');
  if (err) err.style.display = 'none';
}

async function deleteTermFromList(id) {
  const t = terms.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`「${t.name}」（${t.start_date}〜${t.end_date}）を削除しますか？`)) return;
  try {
    const res = await api(TERM_API.DELETE, { method: 'POST', body: JSON.stringify({ guild_id: GUILD_ID, id }) });
    if (res.ok) {
      await loadTerms();
      renderTermList();
      renderTimetable();
      if (termEditState && termEditState.id === id) resetTermForm();
    } else {
      showErr('tt-term-err', res.error || '削除に失敗しました');
    }
  } catch (e) {
    showErr('tt-term-err', 'サーバーに接続できませんでした');
  }
}

async function submitTermSave() {
  if (!termEditState) return;
  const name      = getTermNameValue();
  const startDate = calState['tt-term-start']?.selected;
  const endDate   = calState['tt-term-end']?.selected;

  if (!name)                { showErr('tt-term-err', '学期名を入力してください'); return; }
  if (!startDate)            { showErr('tt-term-err', '開始日を選択してください'); return; }
  if (!endDate)              { showErr('tt-term-err', '終了日を選択してください'); return; }
  if (endDate < startDate)   { showErr('tt-term-err', '終了日は開始日以降にしてください'); return; }

  const btn = document.getElementById('tt-term-submit-btn');
  setLoading(btn, '保存中…');
  try {
    const res = await api(TERM_API.SAVE, {
      method: 'POST',
      body: JSON.stringify({
        guild_id:   GUILD_ID,
        id:         termEditState.id || undefined,
        name,
        start_date: startDate,
        end_date:   endDate,
        timetable:  termEditState.timetable,
      })
    });
    resetLoading(btn, '保存する');
    if (res.ok) {
      showOk('tt-term-ok');
      await loadTerms();
      renderTermList();
      renderTimetable();
      resetTermForm();
    } else {
      showErr('tt-term-err', res.error || '保存に失敗しました');
    }
  } catch (e) {
    resetLoading(btn, '保存する');
    showErr('tt-term-err', 'サーバーに接続できませんでした');
  }
}

// ★ 開始日〜終了日（両端含む）の日付文字列一覧を作る
function enumerateDates(startStr, endStr) {
  const dates = [];
  let cur = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  while (cur <= end) {
    dates.push(getDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

async function submitTTEdit() {
  const startDate = calState['tt-edit']?.selected;
  if (!startDate) { showErr('tt-edit-err', '日付を選択してください'); return; }

  // ★ 複数日にまとめて適用するかどうか
  const isMulti = document.getElementById('tt-edit-multi')?.checked;
  let dateList = [startDate];
  if (isMulti) {
    const endDate = calState['tt-edit-end']?.selected;
    if (!endDate) { showErr('tt-edit-err', '終了日を選択してください'); return; }
    if (endDate < startDate) { showErr('tt-edit-err', '終了日は開始日以降の日付にしてください'); return; }
    dateList = enumerateDates(startDate, endDate);
  }

  const btn = document.getElementById('tt-edit-submit-btn');
  setLoading(btn, isMulti ? `保存中…（全${dateList.length}日）` : '保存中…');

  try {
    if (ttEditMode === 'holiday') {
      const reason = document.getElementById('tt-edit-holiday-reason').value;
      const note   = document.getElementById('tt-edit-holiday-note').value.trim();
      for (const d of dateList) await applyHolidayForDate(d, reason, note);

    } else if (ttEditMode === 'period-holiday') {
      // ★ 1コマだけの休み
      const period = parseInt(document.getElementById('tt-edit-period').value);
      const reason = document.getElementById('tt-edit-period-holiday-reason').value.trim() || '休み';
      const note   = document.getElementById('tt-edit-period-holiday-note').value.trim();
      for (const d of dateList) await applyPeriodHolidayForDate(d, period, reason, note);

    } else if (ttEditMode === 'day-change') {
      const sourceDayKey = document.getElementById('tt-day-change-source').value;
      if (!sourceDayKey) { resetLoading(btn, '保存する'); showErr('tt-edit-err', 'コピー元の曜日を選択してください'); return; }
      if (!isMulti && !dateToDayKey(startDate)) { resetLoading(btn, '保存する'); showErr('tt-edit-err', '土日は選択できません'); return; }
      const note = document.getElementById('tt-day-change-note').value.trim();
      for (const d of dateList) await applyDayChangeForDate(d, sourceDayKey, note);

    } else {
      // 授業変更（1コマ）
      const period   = parseInt(document.getElementById('tt-edit-period').value);
      const subject  = document.getElementById('tt-edit-subject').value.trim();
      const itemsRaw = document.getElementById('tt-edit-items').value.trim();
      const items    = itemsRaw ? itemsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
      const note     = document.getElementById('tt-edit-note').value.trim();
      if (!subject) { resetLoading(btn, '保存する'); showErr('tt-edit-err', '科目を選択してください'); return; }
      for (const d of dateList) await applyChangeForDate(d, period, subject, items, note);
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
  renderTimetable(); // ★ 月間カレンダーの「予定あり」表示に反映させる
}
function renderChannelOptions() {
  const opts = channels.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  document.getElementById('add-subject').innerHTML  = opts || '<option value="">（なし）</option>';
  document.getElementById('edit-subject').innerHTML = '<option value="">— 変更しない —</option>' + opts;

  // ★ 時間割編集モーダルの科目プルダウンもDiscordチャンネルで更新
  const ttSubjectEl = document.getElementById('tt-edit-subject');
  if (ttSubjectEl) ttSubjectEl.innerHTML = '<option value="">科目を選択</option>' + opts;
}

function parsePlanContent(raw) {
  const cat  = raw.match(/^【(.+?)】/)?.[1] || '';
  const rest = raw.replace(/^【.+?】/, '');
  const [textPart, notePart] = rest.split(NOTE_SEP);
  return { cat, text: (textPart || '').trim(), note: (notePart || '').trim() };
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
    if (plan) {
      const { cat, text, note } = parsePlanContent(plan.content);

      // ★ 内容・備考は現在の値を編集欄に入れておく（そのまま保存すれば変更なし）
      document.getElementById('edit-content').value = text;
      document.getElementById('edit-note').value = note;

      // ★ その他カテゴリでも任意でポイントを付けられるように、カテゴリを問わず表示する
      if (ptsWrap) {
        ptsWrap.style.display = 'block';
        selectedPoints['edit'] = POINT_OPTIONS.includes(plan.points) ? plan.points : null;
        renderPointsChips('edit');
        const lbl = ptsWrap.querySelector('.pts-label');
        if (lbl) {
          const base = POINT_CATEGORIES.includes(cat) ? 'ポイント' : 'ポイント（任意）';
          lbl.textContent = (plan.points != null)
            ? `${base}（現在: ${plan.points}pt・変更しない場合は未選択のまま）`
            : `${base}（変更しない場合は未選択のまま）`;
        }
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
    selectedPoints['add'] = null;
    updatePointsVisibility('add');
  }
  if (name === 'edit')   {
    initCal('edit', true);
    editTarget = null;
    renderSelectList('edit-list', 'edit');
    selectedPoints['edit'] = null;
    const wrap = document.getElementById('edit-points-wrap');
    if (wrap) wrap.style.display = 'none';
    document.getElementById('edit-content').value = '';
    document.getElementById('edit-note').value = '';
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
  // ★ カテゴリが「提出」「宿題」以外でも、カテゴリさえ決まっていれば
  //   任意でポイントを付けられるように表示する
  wrap.style.display = cat ? 'block' : 'none';
  if (cat) renderPointsChips(prefix);
}

/** ポイント選択チップ（3 / 5 / 10 / 15）を描画する */
function renderPointsChips(prefix) {
  const wrap = document.getElementById(prefix + '-points-wrap');
  if (!wrap) return;
  const cat      = getCatValue(prefix);
  const required = POINT_CATEGORIES.includes(cat);
  // ★ 必須カテゴリ（提出・宿題）で追加時は未選択なら5ptをデフォルトで選択状態にする
  //   それ以外のカテゴリは任意なので、明示的に選ぶまで未選択のまま
  if (prefix === 'add' && required && selectedPoints[prefix] == null) {
    selectedPoints[prefix] = 5;
  }
  const current = selectedPoints[prefix];
  const chips = POINT_OPTIONS.map(v =>
    `<button type="button" class="chip pts-chip${current === v ? ' chip-active' : ''}" data-pts="${v}" onclick="pickPoints('${prefix}', ${v})">${v}pt</button>`
  ).join('');
  const labelText = required ? 'ポイント' : 'ポイント（任意）';
  wrap.innerHTML = `
    <div class="pts-label">${labelText}</div>
    <div class="filter-chips pts-chips">${chips}</div>
  `;
}

/** ポイントチップがクリックされたとき */
function pickPoints(prefix, val) {
  const cat      = getCatValue(prefix);
  const required = POINT_CATEGORIES.includes(cat);
  // ★ 任意カテゴリは、選択中のチップをもう一度押すと選択解除できる（＝ポイントなし）
  if (!required && selectedPoints[prefix] === val) {
    selectedPoints[prefix] = null;
  } else {
    selectedPoints[prefix] = val;
  }
  renderPointsChips(prefix);
}

async function submitAdd() {
  const date     = calState['add']?.selected;
  const subject  = document.getElementById('add-subject').value;
  const category = getCatValue('add');
  if (!category) { showErr('add-err', 'カテゴリを入力してください'); return; }
  const content = document.getElementById('add-content').value.trim();
  if (!date || !subject || !content) { showErr('add-err', '日付・科目・内容は必須です'); return; }
  const note = document.getElementById('add-note').value.trim();
  const contentToSend = note ? `${content}${NOTE_SEP}${note}` : content;

  const body = { guild_id: GUILD_ID, date, subject, category, content: contentToSend };

  if (POINT_CATEGORIES.includes(category)) {
    const points = selectedPoints['add'];
    if (!points) { showErr('add-err', 'ポイントを選択してください'); return; }
    body.points = points;
  } else if (selectedPoints['add']) {
    // ★ その他カテゴリは任意。選択されていれば送る
    body.points = selectedPoints['add'];
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
      document.getElementById('add-note').value = '';
      selectedPoints['add'] = null;
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
  const t = document.getElementById('edit-content').value.trim();
  const n = document.getElementById('edit-note').value.trim();
  if (t) body.content = n ? `${t}${NOTE_SEP}${n}` : t;

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
      document.getElementById('edit-note').value = '';
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

  // ★ 曜日変更モードで日付を選んだら、入れ替えプレビューを更新
  //   （開始日・終了日どちらを変更してもプレビューは開始日ベースで再描画）
  if ((id === 'tt-edit' || id === 'tt-edit-end') && ttEditMode === 'day-change') {
    const d = calState['tt-edit']?.selected;
    if (d) renderDayChangePreview(d);
  }
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
    '/Cardmaker.js', '/Cardmaker.css',
    '/StudyLog.js', '/StudyLog.css',
    '/Notice.js',
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
  a.addEventListener('click', () => {
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
// ★ 以前は課題表示（ttHomeworks）用に別途GitHub上の静的JSONも監視していたが、
//   ttHomeworks も list_schedule（ライブAPI）から取得するようになったため、
//   schedule のハッシュ1つで両方の変化を検知できる。
let watchHashes = {
  schedule:  null, // 予定・課題（list_schedule。ttHomeworksもここから取得）
  overrides: null, // 時間割変更・休校（list_timetable）
  terms:     null, // 学期ごとの基本時間割（list_terms）
};

// 監視対象データをまとめて再取得＆再描画
async function refreshWatchedData() {
  await Promise.all([
    loadTTHomeworks(),
    loadTTOverrides(),
    loadTerms(),
    loadPlans(),
  ]);
  renderTimetable();
}

// 変更チェック本体
async function checkForUpdates() {
  try {
    const [scheduleHash, overridesHash, termsHash] = await Promise.all([
      hashOfUrl(`${API_BASE}list_schedule?guild_id=${GUILD_ID}`),
      hashOfUrl(`${API_BASE}${TT_API.LIST}?guild_id=${GUILD_ID}`),
      hashOfUrl(`${API_BASE}${TERM_API.LIST}?guild_id=${GUILD_ID}`),
    ]);

    const isFirstCheck = watchHashes.schedule === null;

    const changed = !isFirstCheck && (
      scheduleHash  !== watchHashes.schedule  ||
      overridesHash !== watchHashes.overrides ||
      termsHash     !== watchHashes.terms
    );

    watchHashes = {
      schedule:  scheduleHash,
      overrides: overridesHash,
      terms:     termsHash,
    };

    if (changed) {
      await refreshWatchedData();
    }
  } catch(e) {}
}

// ★ 以前は10秒おきのポーリングだけだったが、サーバーが実際に常時稼働している
//   ので、変更があった瞬間にpushしてもらい即座に反映する（Server-Sent Events）。
//   接続が切れた場合に備え、10秒間隔のフォールバックポーリングも残す。
function startRealtimeUpdates() {
  try {
    const es = new EventSource(`${API_BASE}events?guild_id=${GUILD_ID}`);
    es.onmessage = () => { checkForUpdates(); };
  } catch (e) {
    // EventSource非対応環境などでも、下のフォールバックポーリングだけで動作を継続できる
  }
}
startRealtimeUpdates();
setInterval(checkForUpdates, 10000);
