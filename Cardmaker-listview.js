// ============================================================
//  Cardmaker-listview.js — CardMaker「一覧で見る」機能（遅延読み込みチャンク）
//  ─────────────────────────────────────────────
//  ★ Cardmaker.js から分離。一覧画面（デッキ一覧）の初期表示には不要な
//    機能なので、Cardmaker.js側の loadChunksInBackground() が、初期表示が
//    終わった後にバックグラウンドで読み込む（このファイル単体では動かず、
//    Cardmaker.jsが先に読み込まれている前提。studyIsFolder/studyDeckId/
//    studyFolderId/folderPlayDecks/decks/folders/cardKey/getUnsureSet/
//    showScreen/closeModal/setMathText/showCmAlert/reloadCardBeforeEdit/
//    openCardEditModalCommon などCardmaker.js側のグローバル関数・変数を
//    そのまま使う）。
//
//  ★ 追加：プレイモード選択のところから「一覧で見る」を選ぶと、1問ずつめくる
//    学習画面ではなく、全カードの問題と答えをまとめてスクロールで見られる
//    一覧画面を開く。studyIsFolder / studyDeckId / studyFolderId / folderPlayDecks は
//    openPlayMode() / openFolderPlayMode() で既に設定・読み込み済みのものをそのまま使う。
// ============================================================
let listViewFilter = 'all';   // 'all' | 'unsure'
let listViewReverse = false;  // 問題と解答を逆にするか
// ★ 検索結果などから、この一覧を開いたら特定の問題までスクロールしたい場合に
//   キー（cardKey）をセットしておく。renderListView() が描画後に1回だけ消費する。
let pendingListViewScrollKey = null;

function openListView() {
  // ★ 選択式デッキ（クイズ過去問含む）には反転モードの概念が無い（プレイモード選択
  //   モーダル自体を経由せずここへ来るため、チェックボックスの値も無関係）ため常にfalse。
  //   通常デッキはこれまで通りプレイモード選択モーダルの反転チェックボックスを引き継ぐ。
  const relevantDeck = studyIsFolder ? null : decks.find(d => d.id === studyDeckId);
  listViewReverse = (relevantDeck && relevantDeck.choiceMode) ? false : document.getElementById('reverse-mode-checkbox').checked;
  listViewFilter = 'all';
  closeModal('modal-play-mode');

  const titleEl = document.getElementById('list-view-title');
  if (studyIsFolder) {
    const folder = folders.find(f => f.id === studyFolderId);
    setIconText(titleEl, folder ? Icons.cmHtml('folder', {size:16}) : '', folder ? folder.name : 'フォルダ');
  } else {
    const deck = decks.find(d => d.id === studyDeckId);
    setIconText(titleEl, '', deck ? deck.name : '');
  }

  showScreen('list-view');
  renderListView();
}

// ★ 一覧の元データは studyCards のようなスナップショットを持たず、
//   毎回 decks / folderPlayDecks から直接読み直す。そのため編集で
//   内容が変わってもここを再描画するだけで常に最新の内容が反映される。
function getListViewPool() {
  if (studyIsFolder) {
    const pool = [];
    folderPlayDecks.forEach(d => d.cards.forEach(c => pool.push({ ...c, __deckId: d.id })));
    return pool;
  }
  const deck = decks.find(d => d.id === studyDeckId);
  return deck ? [...deck.cards] : [];
}

function listViewIsUnsure(c) {
  const deckId = c.__deckId || studyDeckId;
  return getUnsureSet(deckId).has(cardKey(c));
}

function setListViewFilter(mode) {
  listViewFilter = mode;
  renderListView();
}

function toggleListViewReverse() {
  listViewReverse = !listViewReverse;
  renderListView();
}

function renderListView() {
  const pool = getListViewPool();
  const unsureCount = pool.filter(listViewIsUnsure).length;
  const cards = listViewFilter === 'unsure' ? pool.filter(listViewIsUnsure) : pool;

  document.getElementById('list-view-tab-all').textContent = `すべて (${pool.length})`;
  document.getElementById('list-view-tab-unsure').textContent = `わからないだけ (${unsureCount})`;
  document.getElementById('list-view-tab-all').classList.toggle('active', listViewFilter === 'all');
  document.getElementById('list-view-tab-unsure').classList.toggle('active', listViewFilter === 'unsure');

  const wrap = document.getElementById('list-view-items');
  wrap.innerHTML = '';

  if (!cards.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `<div class="empty-icon">${Icons.cmHtml('emptyList', {size:40})}</div>${listViewFilter === 'unsure' ? 'わからないカードはありません' : 'カードがありません'}`;
    wrap.appendChild(empty);
    return;
  }

  cards.forEach((c, i) => {
    const deckId = c.__deckId || studyDeckId;
    const qText  = listViewReverse ? c.answer   : c.question;
    const qImgs  = listViewReverse ? c.imgs_a   : c.imgs_q;
    const aText  = listViewReverse ? c.question : c.answer;
    const aImgs  = listViewReverse ? c.imgs_q   : c.imgs_a;

    const item = document.createElement('div');
    item.className = 'list-view-item';
    item.dataset.key = cardKey(c); // ★ 検索結果などから、この問題までスクロールするための目印

    const head = document.createElement('div');
    head.className = 'list-view-item-head';

    const num = document.createElement('div');
    num.className = 'list-view-item-num';
    num.textContent = i + 1;
    head.appendChild(num);

    if (studyIsFolder) {
      const d = decks.find(x => x.id === deckId);
      if (d) {
        const tag = document.createElement('div');
        tag.className = 'list-view-deck-tag';
        tag.textContent = d.name;
        head.appendChild(tag);
      }
    }

    if (listViewIsUnsure(c)) {
      const badge = document.createElement('span');
      badge.className = 'list-view-unsure-badge';
      badge.innerHTML = Icons.cmHtml('bookmark', {size:13});
      head.appendChild(badge);
    }

    // ★ 追加：「クイズ過去問」デッキ（みんなでクイズの結果から自動保存されたもの）は
    //   デッキメニューの「編集」自体を隠している（openDeckMenu参照）読み取り専用の
    //   デッキなので、一覧からの個別カード編集ボタンも同様に出さない。
    const deckForEdit = decks.find(x => x.id === deckId);
    if (!deckForEdit || !deckForEdit.quizArchive) {
      const editBtn = document.createElement('button');
      editBtn.className = 'list-view-edit-btn';
      editBtn.innerHTML = Icons.html('edit', {size:14});
      editBtn.onclick = () => editListViewCard(cardKey(c), deckId);
      head.appendChild(editBtn);
    }

    item.appendChild(head);

    const qTag = document.createElement('div');
    qTag.className = 'list-view-q-tag';
    qTag.textContent = '問題';
    item.appendChild(qTag);

    const qEl = document.createElement('div');
    qEl.className = 'list-view-q-text';
    item.appendChild(qEl);
    setMathText(qEl, qText);

    if (qImgs && qImgs.length) {
      const qImgWrap = document.createElement('div');
      qImgWrap.className = 'list-view-imgs';
      renderImgList(qImgWrap, qImgs); // ★ Cardmaker.js側の共通ヘルパー（XSS対策：src属性をDOMプロパティで設定）
      item.appendChild(qImgWrap);
    }

    const aTag = document.createElement('div');
    aTag.className = 'list-view-a-tag';
    aTag.textContent = '解答';
    item.appendChild(aTag);

    const aEl = document.createElement('div');
    aEl.className = 'list-view-a-text';
    item.appendChild(aEl);
    setMathText(aEl, aText);

    if (aImgs && aImgs.length) {
      const aImgWrap = document.createElement('div');
      aImgWrap.className = 'list-view-imgs';
      renderImgList(aImgWrap, aImgs); // ★ Cardmaker.js側の共通ヘルパー（XSS対策：src属性をDOMプロパティで設定）
      item.appendChild(aImgWrap);
    }

    if (c.explanation) {
      const eTag = document.createElement('div');
      eTag.className = 'list-view-e-tag';
      eTag.textContent = '解説';
      item.appendChild(eTag);

      const eEl = document.createElement('div');
      eEl.className = 'list-view-e-text';
      item.appendChild(eEl);
      setMathText(eEl, c.explanation);
    }

    // ★ 追加：選択式デッキ（クイズ過去問含む）は、正解以外の選択肢も小さく添える。
    //   正解の判定は correct_indices（新形式・複数対応）／correct_index（旧形式・単数）の
    //   どちらでも拾えるようにしておく。
    if (Array.isArray(c.choices) && c.choices.length) {
      const correctSet = new Set(
        Array.isArray(c.correct_indices) ? c.correct_indices
          : (typeof c.correct_index === 'number' ? [c.correct_index] : [])
      );
      const otherChoices = c.choices.filter((_, idx) => !correctSet.has(idx));
      if (otherChoices.length) {
        const chTag = document.createElement('div');
        chTag.className = 'list-view-choices-tag';
        chTag.textContent = '他の選択肢';
        item.appendChild(chTag);

        const chEl = document.createElement('div');
        chEl.className = 'list-view-choices-text';
        chEl.textContent = otherChoices.join(' ／ ');
        item.appendChild(chEl);
      }
    }

    wrap.appendChild(item);
  });

  // ★ 検索結果などから「この問題までスクロールして」と指定されていれば、
  //   描画完了後にその位置まで自動でスクロールし、見つけやすいよう一瞬ハイライトする。
  if (pendingListViewScrollKey) {
    const key = pendingListViewScrollKey;
    pendingListViewScrollKey = null;
    const target = wrap.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (target) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('list-view-item-highlight');
        setTimeout(() => target.classList.remove('list-view-item-highlight'), 1800);
      });
    }
  }
}

// ★ 一覧画面のカードをタップで編集する（保存後は renderListView() が呼ばれ再描画される）
async function editListViewCard(key, deckId) {
  const ok = await reloadCardBeforeEdit(deckId);
  if (!ok) return; // ユーザーが読み込みを中止した

  const deck = decks.find(d => d.id === deckId);
  const freshCard = deck ? deck.cards.find(x => cardKey(x) === key) : null;
  if (!freshCard) {
    await showCmAlert({ title: 'このカードは既に削除されています', desc: '最新の内容に更新しました。' });
    renderListView();
    return;
  }
  openCardEditModalCommon(deckId, freshCard, 'listview');
}
