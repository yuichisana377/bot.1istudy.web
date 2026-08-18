// ============================================================
//  plan.js — 予定管理ページ用スクリプト
//  index.html から読み込む
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
//  グローバル状態
// ============================================================
let plans    = [];
let channels = [];
let calState = {};
let editTarget = null;
let delTarget  = null;
let detailTarget = null; // ★ 詳細モーダルで表示中の予定のlabel

// ============================================================
//  ★ 予定一覧・ログの段階読み込み（ページング）
//  ─────────────────────────────
//  予定を自動削除しなくなったため、過去分は年月とともに増え続ける。
//  全件を読み込んでから表示すると開くたびに遅くなっていくので、
//  ①これからの予定（未来分）を先に読み込んで即表示 → ②過去分は直近から
//  1ページ分だけ自動で追加読み込み → ③それでも続きがあれば
//  「もっと読み込む」ボタンで手動追加、という段階的な読み込みにする。
//  ログも同様に、最新分を1ページ読み込んで即表示し、続きはボタンで読む。
// ============================================================
const PAST_PLANS_PAGE_SIZE = 50;
const LOGS_PAGE_SIZE       = 50;
let pastPlansOffset  = 0;
let pastPlansHasMore = false;
let pastPlansLoading = false;
let logsData    = [];
let logsOffset  = 0;
let logsHasMore = false;
let logsLoading = false;

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

/**
 * ★ 予定リストの重複除去（date+subject+content が同じものは先勝ちで1つに）。
 *   サーバー側が scope パラメータ未対応（再デプロイ前など）だと、未来分・
 *   過去分の取得が両方とも「全件」を返してしまい、それを連結すると全予定が
 *   2重に表示されてしまう。読み込みを合成する箇所では必ずこれを通す。
 */
function dedupePlans(list) {
  const seen = new Set();
  const out = [];
  for (const p of list) {
    const key = `${p.date}/${p.subject}${p.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
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
  plans = [];
  pastPlansOffset  = 0;
  pastPlansHasMore = false;

  // ① これからの予定（未来分）を先に読み込んで表示する
  try {
    const data = await api(`/list_schedule?guild_id=${GUILD_ID}&scope=future`);
    plans = data.ok ? dedupePlans(data.plans) : [];
  } catch(e) { plans = []; }
  document.getElementById('plan-loading').style.display = 'none';
  renderPlans();
  scrollToToday();

  // ② 続けて、過去分を直近から1ページ分だけ自動で追加読み込みする
  //   （まだ多く残っている場合は「もっと読み込む」ボタンで手動追加）
  await loadMorePastPlans();
}

/** 過去の予定を1ページ分読み込んで既存の plans に追加する（「もっと読み込む」ボタンからも呼ばれる） */
async function loadMorePastPlans() {
  if (pastPlansLoading) return;
  pastPlansLoading = true;
  const btn = document.getElementById('plan-load-more-btn');
  if (btn) setLoading(btn, '読み込み中…', true);

  try {
    const data = await api(`/list_schedule?guild_id=${GUILD_ID}&scope=past&offset=${pastPlansOffset}&limit=${PAST_PLANS_PAGE_SIZE}`);
    if (data.ok) {
      plans = dedupePlans(plans.concat(data.plans));
      pastPlansOffset += data.plans.length;
      pastPlansHasMore = !!data.has_more;
    } else {
      pastPlansHasMore = false;
    }
  } catch(e) {
    pastPlansHasMore = false;
  }
  pastPlansLoading = false;
  renderPlans();
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

  const offset = targetEl.getBoundingClientRect().top + window.pageYOffset - 70;

  window.scrollTo({
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
  logsData    = [];
  logsOffset  = 0;
  logsHasMore = false;

  // 最新から1ページ分だけ読み込んで、すべて読み込む前に表示する
  try {
    const data = await api(`/list_logs?guild_id=${GUILD_ID}&offset=0&limit=${LOGS_PAGE_SIZE}`);
    if (data.ok) {
      logsData    = data.logs;
      logsOffset  = data.logs.length;
      logsHasMore = !!data.has_more;
    }
  } catch(e) { logsData = []; }
  document.getElementById('log-loading').style.display = 'none';
  renderLogs();
}

/** ログを1ページ分読み込んで既存の logsData に追加する（「もっと読み込む」ボタンから呼ばれる） */
async function loadMoreLogs() {
  if (logsLoading) return;
  logsLoading = true;
  const btn = document.getElementById('log-load-more-btn');
  if (btn) setLoading(btn, '読み込み中…', true);

  try {
    const data = await api(`/list_logs?guild_id=${GUILD_ID}&offset=${logsOffset}&limit=${LOGS_PAGE_SIZE}`);
    if (data.ok) {
      logsData = logsData.concat(data.logs);
      logsOffset += data.logs.length;
      logsHasMore = !!data.has_more;
    } else {
      logsHasMore = false;
    }
  } catch(e) {
    logsHasMore = false;
  }
  logsLoading = false;
  renderLogs();
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
  const rest = raw.replace(/^【.+?】/, '');
  const [textPart, notePart] = rest.split(NOTE_SEP);
  return { cat, text: (textPart || '').trim(), note: (notePart || '').trim() };
}

function renderPlans() {
  const el = document.getElementById('plan-content');
  const filtered = getFilteredPlans();

  // ★ 日付は昇順（過去→未来）で並ぶため、「もっと読み込む」で追加される
  //   過去の予定は一番上に来る。ボタンも一覧の先頭に置く。
  const loadMoreHtml = pastPlansHasMore
    ? `<button type="button" id="plan-load-more-btn" class="load-more-btn" onclick="loadMorePastPlans()">さらに過去の予定を読み込む</button>`
    : '';

  if (!filtered.length) {
    el.innerHTML = loadMoreHtml + (plans.length
      ? '<div class="empty-msg">条件に一致する予定はありません</div>'
      : '<div class="empty-msg">予定はありません</div>');
    return;
  }

  const today = todayLocalStr();
  const grouped = {};
  filtered.forEach(p => { (grouped[p.date] = grouped[p.date] || []).push(p); });

  el.innerHTML = loadMoreHtml + Object.keys(grouped).sort().map(date => {
    const d = new Date(date + 'T00:00:00');
    const label = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${WDAYS[d.getDay()]}）`;

    const isToday = date === today;
    const isPast  = date < today;

    // ★ 時間割順に並べ替え
    const dayPlans = sortByTimetable(date, grouped[date]);

    const rows = dayPlans.map(p => {
      const { cat, text, note } = parsePlanContent(p.content);
      const ptsBadge = (p.points != null)
        ? `<span class="badge badge-pts">⭐ ${p.points}pt</span>`
        : '';
      const noteDot = note ? `<span class="note-dot" title="備考あり">📝</span>` : '';
      const label = `${p.date}/${p.subject}${p.content}`;
      return `<div class="plan-row" data-label="${label.replace(/"/g, '&quot;')}" onclick="showPlanDetail(this)">
        <span class="subject">${p.subject}</span>
        <span class="badge badge-${cat}">${cat}</span>
        <span class="content">${text}</span>
        ${noteDot}
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
//  ★ 予定詳細モーダル
// ============================================================
function showPlanDetail(el) {
  const label = el.dataset.label;
  const plan = plans.find(p => `${p.date}/${p.subject}${p.content}` === label);
  if (!plan) return;

  detailTarget = label; // ★ 編集・削除ボタンから参照できるように保存

  const { cat, text, note } = parsePlanContent(plan.content);
  const d = new Date(plan.date + 'T00:00:00');
  const dateLabel = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${WDAYS[d.getDay()]}）`;

  const rowsHtml = [
    `<div class="detail-item"><div class="dl-label">日付</div><div class="dl-value">${dateLabel}</div></div>`,
    `<div class="detail-item"><div class="dl-label">科目</div><div class="dl-value">${plan.subject}</div></div>`,
    `<div class="detail-item"><div class="dl-label">カテゴリ</div><div class="dl-value"><span class="badge badge-${cat}">${cat}</span></div></div>`,
    `<div class="detail-item"><div class="dl-label">内容</div><div class="dl-value">${text}</div></div>`,
  ];
  if (plan.points != null) {
    rowsHtml.push(`<div class="detail-item"><div class="dl-label">ポイント</div><div class="dl-value">⭐ ${plan.points}pt</div></div>`);
  }
  if (note) {
    rowsHtml.push(`<div class="detail-item"><div class="dl-label">備考</div><div class="dl-value dl-note">${note}</div></div>`);
  }

  document.getElementById('detail-content').innerHTML = rowsHtml.join('');
  document.getElementById('modal-detail').classList.add('open');
}

// ============================================================
//  ★ 詳細モーダル → 編集／削除モーダルへの連携
// ============================================================

/** 選択リスト(edit-list / del-list)の中から label が一致する項目を選択状態にする */
function selectPlanByLabel(label, mode) {
  const listId = mode === 'edit' ? 'edit-list' : 'del-list';
  const items = document.querySelectorAll(`#${listId} .sel-item`);
  for (const it of items) {
    if (it.dataset.label === label) {
      selectPlan(it, mode);
      it.scrollIntoView({ block: 'center', behavior: 'smooth' });
      break;
    }
  }
}

/** 詳細モーダルの「編集する」ボタン */
function editFromDetail() {
  if (!detailTarget) return;
  closeModal('detail');
  openModal('edit');
  selectPlanByLabel(detailTarget, 'edit');
}

/** 詳細モーダルの「削除する」ボタン */
function deleteFromDetail() {
  if (!detailTarget) return;
  closeModal('detail');
  openModal('delete');
  selectPlanByLabel(detailTarget, 'delete');
}

// ============================================================
//  ログ 描画
// ============================================================
const TYPE_LABEL = { add:'追加', edit:'編集', delete:'削除', cleanup:'自動削除' };

function renderLogs() {
  const el = document.getElementById('log-content');
  if (!logsData.length) { el.innerHTML = '<div class="empty-msg">ログはありません</div>'; return; }
  const loadMoreHtml = logsHasMore
    ? `<button type="button" id="log-load-more-btn" class="load-more-btn" onclick="loadMoreLogs()">もっと読み込む</button>`
    : '';
  el.innerHTML = logsData.map(l => `
    <div class="tl-item">
      <div class="tl-dot dot-${l.type}"></div>
      <div class="tl-time">${l.time}</div>
      <div class="tl-card">
        <div class="tl-type type-${l.type}">${TYPE_LABEL[l.type] || l.type}</div>
        <div class="tl-detail">${l.detail}</div>
      </div>
    </div>`).join('') + loadMoreHtml;
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
      const { cat, text, note } = parsePlanContent(plan.content);

      // ★ 内容・備考は現在の値を編集欄に入れておく（そのまま保存すれば変更なし）
      document.getElementById('edit-content').value = text;
      document.getElementById('edit-note').value = note;

      // ★ その他カテゴリでも任意でポイントを付けられるように、カテゴリを問わず表示する
      ptsWrap.style.display = 'block';
      // 既存のポイントが選択肢内にあればプリセット、なければ未選択のまま
      selectedPoints['edit'] = POINT_OPTIONS.includes(plan.points) ? plan.points : null;
      renderPointsChips('edit');
      const label = ptsWrap.querySelector('.pts-label');
      if (label) {
        const base = POINT_CATEGORIES.includes(cat) ? 'ポイント' : 'ポイント（任意）';
        label.textContent = (plan.points != null)
          ? `${base}（現在: ${plan.points}pt・変更しない場合は未選択のまま）`
          : `${base}（変更しない場合は未選択のまま）`;
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
    selectedPoints['add'] = null;
    updatePointsVisibility('add');
  }
  if (name === 'edit')   {
    initCal('edit', true);
    editTarget = null;
    renderSelectList('edit-list', 'edit');
    selectedPoints['edit'] = null;
    document.getElementById('edit-points-wrap').style.display = 'none';
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
// ★ 変更点：location.reload() をやめ、データだけ更新してその場で再描画する。
//   ・スクロール位置を保ったまま renderPlans() を再実行
//   ・編集／削除モーダルが開いていれば、その選択リストも最新化
//   ・入力中のフォーム（追加モーダルなど）やカレンダーの状態は一切触らない
// ★ さらに変更点：ここで list_schedule を無条件（全件）取得すると、
//   ページング導入の意味がなくなり10秒ごとに全件を読み直してしまうため、
//   監視対象は「これからの予定」（scope=future）だけに絞る。
//   新規追加・編集・削除はほぼ常に近い将来の予定に対して行われるため、
//   これで実用上十分。既に読み込み済みの過去分ページはそのまま維持し、
//   未来分だけを最新のものに差し替える。
async function checkScheduleUpdate() {
  try {
    const res = await fetch(`${API_BASE}list_schedule?guild_id=${GUILD_ID}&scope=future`);
    const txt = await res.text();
    const hash = await digestMessage(txt);

    // 初回は保存だけ
    if (lastScheduleHash === null) {
      lastScheduleHash = hash;
      return;
    }

    // ハッシュが変わっていなければ何もしない
    if (hash === lastScheduleHash) return;
    lastScheduleHash = hash;

    // 未来分だけ差し替える（読み込み済みの過去分ページはそのまま維持する）
    let data;
    try { data = JSON.parse(txt); } catch(e) { return; }
    if (!data.ok) return;
    const today = todayLocalStr();
    const pastLoaded = plans.filter(p => p.date < today);
    plans = dedupePlans(data.plans.concat(pastLoaded));

    // スクロール位置を保ったまま予定一覧を再描画
    const scrollY = window.scrollY;
    renderPlans();
    window.scrollTo(0, scrollY);

    // 編集／削除モーダルが開いていれば、その選択リストも最新化
    if (document.getElementById('modal-edit')?.classList.contains('open')) {
      renderSelectList('edit-list', 'edit');
    }
    if (document.getElementById('modal-delete')?.classList.contains('open')) {
      renderSelectList('del-list', 'delete');
    }
  } catch(e) {}
}

// ★ 以前は10秒おきのポーリングだけだったが、サーバーが実際に常時稼働している
//   ので、変更があった瞬間にpushしてもらい即座に反映する（Server-Sent Events）。
//   接続が切れた場合に備え、10秒間隔のフォールバックポーリングも残す。
function startRealtimeUpdates() {
  try {
    const es = new EventSource(`${API_BASE}events?guild_id=${GUILD_ID}`);
    es.onmessage = () => { checkScheduleUpdate(); };
  } catch (e) {
    // EventSource非対応環境などでも、下のフォールバックポーリングだけで動作を継続できる
  }
}
startRealtimeUpdates();
setInterval(checkScheduleUpdate, 10000);
