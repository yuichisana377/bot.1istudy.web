// ============================================================
//  Cardmaker-search.js — CardMaker「単語検索」機能（遅延読み込みチャンク）
//  ─────────────────────────────────────────────
//  ★ Cardmaker.js から分離。一覧画面の初期表示には不要な機能なので、
//    Cardmaker.js側の loadChunksInBackground() が、一覧の初期表示が
//    終わった後にバックグラウンドで読み込む（このファイル単体では動かず、
//    Cardmaker.jsが先に読み込まれている前提。decks/folders/showScreen/
//    esc/cardKey/mathToPlainText/normalizeForSearch/collectDecksInFolder/
//    folderPathLabel/ensureDeckCardsLoaded/renderListView などCardmaker.js
//    側のグローバル関数・変数をそのまま使う）。
//
//  ・検索対象は「検索を開いた時点で表示していたフォルダ」の中身だけ
//    （サブフォルダは含む。collectDecksInFolder と同じ範囲）。
//    ホーム画面（フォルダを開いていない状態）から開けば全体が対象になる。
//  ・問題文・解答のどちらかに含まれていればヒットとする。
//  ・「多少の表記ゆれ」を許容するため、比較前に正規化する：
//      - Unicode正規化(NFKC)で全角/半角の違いを吸収
//      - カタカナ→ひらがなに変換して、ひらがな/カタカナの違いを無視
//      - 大文字/小文字を無視
//      - 空白（半角・全角）を無視
//  ・カード本体が未読み込みの公開デッキは、検索を始める前にまとめて
//    読み込んでおく（読み込み中は件数を表示する）。
// ============================================================
let searchScopeFolderId = null; // 検索対象として固定したフォルダ（開いた時点のcurrentFolderId）
let searchTargetDecks   = null; // 読み込み準備が済んだ、検索対象デッキの配列
let searchDebounceTimer = null;
// ★ normalizeForSearch() は「一覧で見る」内検索（Cardmaker-listview.js）とも共有するため
//   Cardmaker.js側に移した（このファイル単体では定義していない）。

async function openSearchScreen() {
  searchScopeFolderId = currentFolderId;
  searchTargetDecks = null;
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML = '';
  const scopeLabel = folderPathLabel(searchScopeFolderId);
  setIconText(
    document.getElementById('search-scope-label'),
    scopeLabel ? Icons.cmHtml('folder', {size:14}) : Icons.html('logo', {size:14}),
    scopeLabel ? `${scopeLabel} の中を検索します` : 'すべてのデッキから検索します'
  );
  showScreen('search');
  setTimeout(() => document.getElementById('search-input').focus(), 200);
  await prepareSearchScope();
}

// ★ 検索対象デッキのカード本体を、必要なものだけ先にまとめて読み込んでおく
async function prepareSearchScope() {
  const statusEl = document.getElementById('search-status');
  const targets = collectDecksInFolder(searchScopeFolderId)
    .filter(d => (d.filename ? (d.count ?? d.cards.length) : d.cards.length) > 0);
  const unloaded = targets.filter(d => d.filename && !d.cardsLoaded);
  if (unloaded.length) {
    statusEl.style.display = 'block';
    statusEl.textContent = `問題データを読み込み中…（${unloaded.length}件のデッキ）`;
    await Promise.all(unloaded.map(d => ensureDeckCardsLoaded(d.id)));
  }
  statusEl.style.display = 'none';
  // ★ 途中でユーザーが検索画面から離れていた場合は反映しない
  if (!document.getElementById('screen-search').classList.contains('active')) return;
  searchTargetDecks = targets;
  runSearch();
}

function onSearchInput() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(runSearch, 150);
}

function runSearch() {
  const resultsEl = document.getElementById('search-results');
  const raw = document.getElementById('search-input').value.trim();

  if (!searchTargetDecks) return; // まだ読み込み準備中（準備完了後に自動で1回呼ばれる）

  if (!raw) {
    resultsEl.innerHTML = `<div class="search-hint">${Icons.cmHtml('search', {size:16})} キーワードを入力してください</div>`;
    return;
  }

  const nq = normalizeForSearch(raw);
  const hits = [];
  for (const d of searchTargetDecks) {
    for (const c of d.cards) {
      const q = mathToPlainText(c.question), a = mathToPlainText(c.answer);
      if (normalizeForSearch(q).includes(nq) || normalizeForSearch(a).includes(nq)) {
        hits.push({ deckId: d.id, deckName: d.name, cardId: c.id, q, a });
      }
    }
  }

  if (!hits.length) {
    resultsEl.innerHTML = `<div class="search-hint">「${esc(raw)}」に該当する問題は見つかりませんでした</div>`;
    return;
  }

  resultsEl.innerHTML = `<div class="search-results">` + hits.map(h => `
    <div class="search-result-item" onclick="openSearchResult('${h.deckId}','${h.cardId}')">
      <div class="search-result-deck">${esc(h.deckName)}</div>
      <div class="search-result-q">${esc(h.q)}</div>
      <div class="search-result-a">${esc(h.a)}</div>
    </div>`).join('') + `</div>`;
}

// ★ 検索結果をタップしたら、編集画面ではなく「一覧で見る」画面（そのデッキの
//   全問題をまとめて見られる画面）を開き、該当の問題の位置まで自動でスクロールする。
//   検索の準備段階（prepareSearchScope）で対象デッキのカードは読み込み済みのはず。
//   ★ 一覧で見る画面（listViewFilter/renderListView等）は Cardmaker-listview.js
//   に分離されているため、ここから直接触る前に読み込みを待つ必要がある
//   （openListView()を経由しない唯一の入口のため）。
async function openSearchResult(deckId, cardId) {
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return;
  const card = deck.cards.find(c => c.id === cardId);
  if (!card) return;

  await loadChunkWithFeedback('listview', '/Cardmaker-listview.js');

  studyIsFolder = false;
  studyDeckId = deckId;
  listViewFilter = 'all';
  listViewReverse = false;
  // ★ 追加：前回一覧を開いたときの一覧内検索キーワードを持ち越さない
  //   （openListView()を経由しないため、ここでも同じリセットが必要）。
  listViewSearchQuery = '';
  const listViewSearchInput = document.getElementById('list-view-search-input');
  if (listViewSearchInput) listViewSearchInput.value = '';
  document.getElementById('list-view-title').textContent = deck.name;
  pendingListViewScrollKey = cardKey(card);
  showScreen('list-view');
  renderListView();
}
