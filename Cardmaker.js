// ============================================================
//  Cardmaker.js — CardMaker専用スクリプト
//  Cardmaker.html から読み込む
// ============================================================

const API_BASE = "https://python-bot-1istudy.onrender.com/";
const GUILD_ID = "1509880344806162544";

const STORE_KEY = 'cardmaker_decks_v1';
function loadDecks() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; } }
function saveDecks(d) { localStorage.setItem(STORE_KEY, JSON.stringify(d)); }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

let decks = loadDecks();
let currentDeckId  = null;
let editingCardIdx = null;
let menuTargetId   = null;
let imgBuf = { q:[], a:[], e:[] };
let studyCards = [], studyIdx = 0;

// ── 安定したカードキー生成（並び替え・サーバー同期に強い） ──
// id が無いカード（例：公開後にサーバーから取り込まれたカード）でも
// 配列のインデックスに依存せず、内容から一意なキーを作る。
function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}
function cardKey(c) {
  return c.id || ('h_' + hashStr((c.question || '') + '||' + (c.answer || '')));
}

// ── ルーター ──────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  window.scrollTo(0, 0);
  if (id === 'list') {
    decks = loadDecks();
    renderDeckListUI();
    setTimeout(() => renderDeckList(), 0);
  }
}

// ── デッキ一覧 ────────────────────────
function renderDeckListUI() {
  const grid  = document.getElementById('deck-grid');
  const empty = document.getElementById('deck-list-empty');
  if (!decks.length) { grid.style.display='none'; empty.style.display='block'; return; }
  empty.style.display='none'; grid.style.display='flex';
  grid.innerHTML = decks.map(d => {
    const unsureSet   = getUnsureSet(d.id);
    const unsureCount = d.cards.filter(c => unsureSet.has(cardKey(c))).length;
    const unsureBadge = unsureCount > 0 ? `<span class="unsure-badge">🔖 ${unsureCount}</span>` : '';
    const pubBadge = d.filename
      ? `<span class="pub-badge published">🔵 公開済み</span>`
      : `<span class="pub-badge local">🔴 非公開</span>`;
    return `
    <div class="deck-card">
      <div class="deck-card-info">
        <div class="deck-card-title">${esc(d.name)}</div>
        <div class="deck-card-meta">
          ${d.filename ? (d.count ?? d.cards.length) : d.cards.length} 問
          ${pubBadge}
          ${unsureBadge}
        </div>
      </div>
      <div class="deck-card-actions">
        <button class="btn btn-blue btn-sm" onclick="openPlayMode('${d.id}')"
          ${d.cards.length===0?'disabled':''}>▶ プレイ</button>
        <button class="icon-btn" onclick="openDeckMenu('${d.id}')" title="メニュー">✏️</button>
      </div>
    </div>`;
  }).join('');
}

async function renderDeckList() {
  decks = loadDecks();
  renderDeckListUI();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res  = await fetch(`${API_BASE}list_cards`, { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json();
    if (!data.ok) return;
    const fetched = data.sets.map(s => {
      const existing = decks.find(d => d.filename === s.filename);
      return { id: existing ? existing.id : genId(), name: s.name, cards: s.cards, filename: s.filename, count: s.count };
    });
    const publishedNames = new Set(fetched.map(f => f.name));
    const localOnly = decks.filter(d => !d.filename && !publishedNames.has(d.name));
    decks = [...localOnly, ...fetched];
    saveDecks(decks);
    renderDeckListUI();
  } catch(e) {}
}

// ── デッキメニュー ─────────────────────
function openDeckMenu(id) {
  menuTargetId = id;
  const deck = decks.find(d => d.id === id);
  document.getElementById('menu-deck-name').textContent = deck.name;
  document.getElementById('menu-unpublish-item').style.display = deck.filename ? '' : 'none';
  openModal('modal-deck-menu');
}
function menuEdit()   { closeModal('modal-deck-menu'); openEditDeck(menuTargetId); }
function menuRename() { closeModal('modal-deck-menu'); openRename(menuTargetId); }

async function menuUnpublish() {
  closeModal('modal-deck-menu');
  const deck = decks.find(d => d.id === menuTargetId);
  if (!deck || !deck.filename) return;
  if (!confirm(`「${deck.name}」をGitHubから削除して非公開に戻しますか？`)) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${API_BASE}delete_cards`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: deck.filename }), signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '削除失敗');
    deck.filename = null; deck.count = undefined;
    saveDecks(decks); renderDeckListUI();
    showBanner('🔴 非公開に戻しました', '#f1f5f9', '#334155');
  } catch(e) {
    alert('GitHubからの削除に失敗しました。\n' + e.message);
  }
}

async function menuDelete() {
  closeModal('modal-deck-menu');
  if (!confirm('このデッキを削除しますか？')) return;
  const deck = decks.find(d => d.id === menuTargetId);
  if (deck && deck.filename) {
    try {
      await fetch(`${API_BASE}delete_cards`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: deck.filename }),
      });
    } catch(e) {
      if (!confirm('GitHubからの削除に失敗しました。ローカルからだけ削除しますか？')) return;
    }
  }
  decks = decks.filter(d => d.id !== menuTargetId);
  saveDecks(decks); renderDeckList();
}

// ── 新規作成 ──────────────────────────
function openNewSet() {
  document.getElementById('new-set-name').value = '';
  showScreen('new');
  loadSubjects();
  setTimeout(() => document.getElementById('new-set-name').focus(), 200);
}

async function loadSubjects() {
  const sel = document.getElementById('new-subject');
  sel.innerHTML = '<option value="">読み込み中…</option>';
  try {
    const res  = await fetch(`${API_BASE}channels?guild_id=${GUILD_ID}`);
    const data = await res.json();
    if (!data.ok || !data.channels.length) throw new Error();
    sel.innerHTML = '<option value="">科目を選択（任意）</option>' +
      data.channels.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  } catch(e) {
    sel.innerHTML = '<option value="">（科目を取得できませんでした）</option>';
  }
}

function startEdit() {
  const subject = document.getElementById('new-subject').value;
  const input   = document.getElementById('new-set-name').value.trim();
  if (!input) { shake('new-set-name'); return; }
  const name = subject ? `${subject} ${input}` : input;
  const deck = { id: genId(), name, subject, cards: [] };
  decks.push(deck); saveDecks(decks);
  openEditDeck(deck.id);
}

// ── カード編集画面 ────────────────────
function openEditDeck(deckId) {
  currentDeckId = deckId;
  const deck = decks.find(d => d.id === deckId);
  document.getElementById('edit-deck-title').textContent = deck.name;
  clearEditor(); renderCreatedList(); showScreen('edit');
  setTimeout(() => document.getElementById('ta-q').focus(), 200);
}
function clearEditor() {
  ['q','a','e'].forEach(k => {
    document.getElementById('ta-'+k).value = '';
    autoResize(document.getElementById('ta-'+k));
    imgBuf[k] = [];
    document.getElementById('imgs-'+k).innerHTML = '';
  });
}

function saveCard(mode) {
  const q = document.getElementById('ta-q').value.trim();
  const a = document.getElementById('ta-a').value.trim();
  const deck = decks.find(d => d.id === currentDeckId);
  if (q || a) {
    if (!q || !a) { shake(!q ? 'ta-q' : 'ta-a'); return; }
    deck.cards.push({ id:genId(), question:q, answer:a,
      explanation: document.getElementById('ta-e').value.trim(),
      imgs_q:[...imgBuf.q], imgs_a:[...imgBuf.a], imgs_e:[...imgBuf.e] });
    saveDecks(decks);
    document.getElementById('edit-counter').textContent = deck.cards.length + '枚';
  }
  if (mode === 'publish') {
    publishDeck(deck);
  } else if (mode === 'local') {
    saveDecks(decks); showScreen('list');
  } else {
    clearEditor(); renderCreatedList();
    document.getElementById('edit-scroll').scrollTo(0,0);
    document.getElementById('ta-q').focus();
  }
}

async function publishDeck(deck) {
  saveDecks(decks); showScreen('list');
  const cards = deck.cards.map(c => ({
    id: c.id, // サーバーが対応していれば id を保持したまま返してもらうため付与
    question: c.question, answer: c.answer, explanation: c.explanation || ''
  }));
  const body = { name: deck.name, cards };
  if (deck.filename) body.filename = deck.filename;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res  = await fetch(`${API_BASE}save_cards`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '不明なエラー');
    deck.filename = data.filename; deck.count = deck.cards.length;
    saveDecks(decks); renderDeckListUI();
    showBanner('✓ 保存して公開しました！', '#dcfce7', '#166534');
  } catch(e) {
    showBanner('💾 ローカルに保存しました（GitHub同期失敗）', '#fffbeb', '#92400e');
  }
}

function renderCreatedList() {
  const deck = decks.find(d => d.id === currentDeckId);
  const section = document.getElementById('created-section');
  const list    = document.getElementById('created-list');
  if (!deck||!deck.cards.length) { section.style.display='none'; return; }
  section.style.display='block';
  list.innerHTML = deck.cards.map((c,i) => `
    <div class="created-item">
      <div class="created-item-num">${i+1}</div>
      <div class="created-item-body">
        <div class="created-item-q">${esc(c.question)}</div>
        <div class="created-item-a">${esc(c.answer)}</div>
      </div>
      <div class="created-item-btns">
        <button class="btn btn-ghost btn-sm" onclick="openCardEditModal(${i})">編集</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCardFromDeck(${i})">削除</button>
      </div>
    </div>`).join('');
}

function deleteCardFromDeck(idx) {
  if (!confirm('このカードを削除しますか？')) return;
  const deck = decks.find(d => d.id === currentDeckId);
  deck.cards.splice(idx, 1); saveDecks(decks);
  document.getElementById('edit-counter').textContent = deck.cards.length + '枚';
  renderCreatedList();
}
function confirmLeaveEdit() {
  if (confirm('編集を終了して一覧に戻りますか？')) showScreen('list');
}

// ── カード編集モーダル ─────────────────
function openCardEditModal(idx) {
  const deck = decks.find(d => d.id === currentDeckId);
  const c = deck.cards[idx];
  editingCardIdx = idx;
  document.getElementById('modal-edit-q').value = c.question;
  document.getElementById('modal-edit-a').value = c.answer;
  document.getElementById('modal-edit-e').value = c.explanation||'';
  ['modal-edit-q','modal-edit-a','modal-edit-e'].forEach(id => autoResize(document.getElementById(id)));
  document.getElementById('card-edit-ok').style.display  = 'none';
  document.getElementById('card-edit-err').style.display = 'none';
  openModal('modal-card-edit');
}
function saveCardEdit() {
  const q = document.getElementById('modal-edit-q').value.trim();
  const a = document.getElementById('modal-edit-a').value.trim();
  const errBar = document.getElementById('card-edit-err');
  if (!q || !a) {
    errBar.textContent = '✕ 問題文と解答は必須です';
    errBar.style.display = 'block';
    setTimeout(() => errBar.style.display = 'none', 3000);
    return;
  }
  const deck = decks.find(d => d.id === currentDeckId);
  deck.cards[editingCardIdx] = {
    ...deck.cards[editingCardIdx],
    question: q, answer: a,
    explanation: document.getElementById('modal-edit-e').value.trim()
  };
  saveDecks(decks);
  closeModal('modal-card-edit');
  renderCreatedList();
}

// ── デッキ名変更 ──────────────────────
let renamingDeckId = null;
async function openRename(id) {
  renamingDeckId = id;
  const deck = decks.find(d => d.id === id);
  const currentSubject = deck.subject || '';
  const currentName = currentSubject && deck.name.startsWith(currentSubject + ' ')
    ? deck.name.slice(currentSubject.length + 1) : deck.name;
  document.getElementById('modal-rename-input').value = currentName;
  const sel = document.getElementById('modal-rename-subject');
  sel.innerHTML = '<option value="">読み込み中…</option>';
  openModal('modal-rename');
  try {
    const res  = await fetch(`${API_BASE}channels?guild_id=${GUILD_ID}`);
    const data = await res.json();
    if (!data.ok || !data.channels.length) throw new Error();
    sel.innerHTML = '<option value="">科目なし</option>' +
      data.channels.map(c =>
        `<option value="${c.name}"${c.name === currentSubject ? ' selected' : ''}>${c.name}</option>`
      ).join('');
  } catch(e) {
    sel.innerHTML = `<option value="${currentSubject}">${currentSubject || '（取得失敗）'}</option>`;
  }
  setTimeout(() => document.getElementById('modal-rename-input').focus(), 150);
}
function saveRename() {
  const subject = document.getElementById('modal-rename-subject').value;
  const input   = document.getElementById('modal-rename-input').value.trim();
  if (!input) return;
  const deck = decks.find(d => d.id === renamingDeckId);
  deck.subject = subject;
  deck.name    = subject ? `${subject} ${input}` : input;
  saveDecks(decks); closeModal('modal-rename'); renderDeckListUI();
}

// ── 学習 ─────────────────────────────
function getUnsureSet(deckId) {
  try { const raw = localStorage.getItem('unsure_' + deckId); return new Set(raw ? JSON.parse(raw) : []); }
  catch { return new Set(); }
}
function saveUnsureSet(deckId, set) {
  localStorage.setItem('unsure_' + deckId, JSON.stringify([...set]));
}

let studyDeckId = null;

function openPlayMode(deckId) {
  const deck = decks.find(d => d.id === deckId);
  studyDeckId = deckId;
  document.getElementById('play-mode-deck-name').textContent = deck.name;
  document.getElementById('play-mode-all-sub').textContent = `${deck.cards.length} 問`;
  const unsure = getUnsureSet(deckId);
  const unsureCount = deck.cards.filter(c => unsure.has(cardKey(c))).length;
  const unsureItem = document.getElementById('play-mode-unsure-item');
  if (unsureCount > 0) {
    document.getElementById('play-mode-unsure-sub').textContent = `${unsureCount} 問`;
    unsureItem.style.display = '';
    openModal('modal-play-mode');
  } else {
    startStudyMode('all');
  }
}

function startStudyMode(mode) {
  closeModal('modal-play-mode');
  const deck = decks.find(d => d.id === studyDeckId);
  if (mode === 'unsure') {
    const unsure = getUnsureSet(studyDeckId);
    studyCards = deck.cards.filter(c => unsure.has(cardKey(c)));
  } else {
    studyCards = [...deck.cards];
  }
  studyIdx = 0;
  document.getElementById('study-title').textContent = deck.name;
  document.getElementById('study-done-sub').textContent = `全 ${studyCards.length} 問完了！`;
  showScreen('study');
  document.getElementById('study-done').style.display    = 'none';
  document.getElementById('study-content').style.display = 'flex';
  renderStudyCard();
}

function renderStudyCard() {
  if (studyIdx >= studyCards.length) {
    document.getElementById('study-content').style.display = 'none';
    document.getElementById('study-done').style.display    = 'flex';
    document.getElementById('study-prog-fill').style.width  = '100%';
    document.getElementById('study-prog-label').textContent = `${studyCards.length} / ${studyCards.length}`;
    return;
  }
  const c = studyCards[studyIdx];
  document.getElementById('study-q-text').textContent = c.question;
  document.getElementById('study-q-imgs').innerHTML = (c.imgs_q||[]).map(s=>`<img src="${s}" alt="">`).join('');
  document.getElementById('study-answer-panel').classList.remove('show');
  document.getElementById('study-reveal-bar').style.display = '';
  document.getElementById('study-nav').style.display = 'none';
  document.getElementById('study-a-text').textContent = c.answer;
  document.getElementById('study-a-imgs').innerHTML = (c.imgs_a||[]).map(s=>`<img src="${s}" alt="">`).join('');
  const explWrap = document.getElementById('study-expl-wrap');
  if (c.explanation) { document.getElementById('study-e-text').textContent = c.explanation; explWrap.style.display = ''; }
  else { explWrap.style.display = 'none'; }
  const pct = studyCards.length > 1 ? (studyIdx/(studyCards.length-1))*100 : 100;
  document.getElementById('study-prog-fill').style.width  = pct + '%';
  document.getElementById('study-prog-label').textContent = `${studyIdx+1} / ${studyCards.length}`;
  document.getElementById('study-prev').disabled = studyIdx === 0;
  document.getElementById('study-next').textContent = studyIdx === studyCards.length-1 ? '完了 ✓' : '次へ →';
  updateUnsureBtn();
}

function revealAnswer() {
  document.getElementById('study-answer-panel').classList.add('show');
  document.getElementById('study-reveal-bar').style.display = 'none';
  document.getElementById('study-nav').style.display = '';
  updateUnsureBtn();
}

function updateUnsureBtn() {
  const card = studyCards[studyIdx]; if (!card) return;
  const key = cardKey(card);
  const unsure = getUnsureSet(studyDeckId);
  const btn = document.getElementById('unsure-btn');
  btn.textContent = 'わからない';
  btn.classList.toggle('marked', unsure.has(key));
}

function toggleUnsure() {
  const card = studyCards[studyIdx]; if (!card) return;
  const key = cardKey(card);
  const unsure = getUnsureSet(studyDeckId);
  if (unsure.has(key)) unsure.delete(key); else unsure.add(key);
  saveUnsureSet(studyDeckId, unsure);
  updateUnsureBtn();
}

function studyMove(dir) { studyIdx += dir; renderStudyCard(); }

function shuffleStudy() {
  for (let i=studyCards.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [studyCards[i],studyCards[j]]=[studyCards[j],studyCards[i]];
  }
  studyIdx = 0;
  document.getElementById('study-done').style.display    = 'none';
  document.getElementById('study-content').style.display = 'flex';
  renderStudyCard();
}

document.addEventListener('keydown', e => {
  if (document.querySelector('.screen.active')?.id !== 'screen-study') return;
  if (e.key==='ArrowRight') studyMove(1);
  if (e.key==='ArrowLeft' && studyIdx>0) studyMove(-1);
  if (e.key===' ') { e.preventDefault(); revealAnswer(); }
});

// ── 画像 ─────────────────────────────
let imgTarget = null;
const imgInput = document.getElementById('img-file-input');
function addImage(t) { imgTarget=t; imgInput.click(); }
imgInput.addEventListener('change', () => {
  const file = imgInput.files[0]; if (!file||!imgTarget) return;
  const r = new FileReader();
  r.onload = e => { imgBuf[imgTarget].push(e.target.result); renderImgStrip(imgTarget); };
  r.readAsDataURL(file); imgInput.value='';
});
function renderImgStrip(k) {
  document.getElementById('imgs-'+k).innerHTML = imgBuf[k].map((b,i)=>`
    <div class="img-thumb"><img src="${b}" alt="">
      <button class="img-thumb-del" onclick="removeImg('${k}',${i})">✕</button></div>`).join('');
}
function removeImg(k,i) { imgBuf[k].splice(i,1); renderImgStrip(k); }

// ── モーダル ──────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function onOverlayClick(e,id) { if(e.target===document.getElementById(id)) closeModal(id); }

// ── ドロワー ──────────────────────────
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}

// ── バナー ────────────────────────────
function showBanner(msg, bg, color) {
  const banner = document.getElementById('save-ok-banner');
  banner.textContent = msg;
  banner.style.background = bg;
  banner.style.color = color;
  banner.style.display = 'block';
  setTimeout(() => {
    banner.style.display = 'none';
    banner.style.background = '#dcfce7';
    banner.style.color = '#166534';
  }, 3500);
}

// ── ユーティリティ ────────────────────
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function autoResize(el) { el.style.height='auto'; el.style.height=el.scrollHeight+'px'; }
function shake(id) {
  const el=document.getElementById(id); el.style.borderColor='#EF4444'; el.focus();
  setTimeout(()=>el.style.borderColor='',700);
}

// ── 起動 ──────────────────────────────
renderDeckList();
