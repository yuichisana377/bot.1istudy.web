// ============================================================
//  Cardmaker-cardreorder.js — CardMaker「作成済みカードのドラッグ並び替え」機能
//  （遅延読み込みチャンク）
//  ─────────────────────────────────────────────
//  ★ Cardmaker.js から分離。デッキ一覧・編集画面の初期表示には不要な
//    機能なので、Cardmaker.js側の loadChunksInBackground() が、
//    初期表示が終わった後にバックグラウンドで読み込む（このファイル
//    単体では動かず、Cardmaker.jsが先に読み込まれている前提。decks/
//    currentDeckId/cardKey/saveDecks/renderCreatedList/
//    queueSyncDeckToServer/showBanner などCardmaker.js側のグローバル
//    関数・変数をそのまま使う）。
//  ★ このファイル自体は関数呼び出しの入口を持たない（下記IIFEが
//    読み込まれた時点で即座にイベントリスナーを1回だけ登録するだけ）。
//    そのためCardmaker.js側に薄いプロキシは無く、loadChunksInBackground()
//    のキューに乗せておくだけでよい。
//
//  ・マウス／タッチの両方を同じコードで扱える Pointer Events API を使用。
//    HTML5標準のdraggable属性はスマホでの挙動が不安定なため使わない。
//  ・renderCreatedList() は編集のたびに #created-list の中身を毎回
//    innerHTML で丸ごと再生成するので、各アイテムに直接リスナーを付けるのではなく
//    #created-list 自体に1回だけイベント委任（delegation）で登録する。
//  ・ドラッグ中はDOM上の要素を直接入れ替えて視覚的な並び替えを行い、
//    指を離した瞬間に「今のDOM上の並び順（data-key）」を読み取って
//    deck.cards を実際に並び替える。カードの内容そのものはcardKeyで
//    引き当てるので、インデックスのズレによる事故が起きない。
// ============================================================
(function setupCardDragReorder() {
  const list = document.getElementById('created-list');
  if (!list) return;

  let dragEl = null;
  let startY = 0;
  // ★ 追加：ドラッグ中の「指」を識別するID。
  //   これにより、ハンドルを掴んでいる指の動きだけをドラッグとして扱い、
  //   もう片方の指の動きはブラウザ標準のスクロールとして自由に使えるようにする。
  let dragTouchId = null;

  // ★ 追加：ドラッグ中に画面端（上下）に近づいたら自動スクロールするための状態。
  const scrollContainer = document.getElementById('edit-scroll');
  let lastClientY = 0;
  let autoScrollRAF = null;
  // ★ バグ修正：カードを掴んだ位置がたまたま画面の上端／下端付近だった場合、
  //   指を全く動かしていないのに自動スクロールが始まり、そのまま一番上／
  //   一番下まで一気に並び替わってしまう不具合があった。
  //   これを防ぐため「掴んだ位置（dragOriginY）からその方向へ実際に
  //   指を動かした」場合にだけ自動スクロールを有効にする。
  let dragOriginY = 0;
  const EDGE_ARM_PX = 24; // これだけ掴んだ位置から動かして初めて自動スクロールが有効になる

  function getItems() {
    return Array.from(list.querySelectorAll('.created-item'));
  }

  // ★ 追加：ドラッグ中、指（またはマウス）が edit-scroll の上端／下端付近に
  //   あるあいだ、毎フレーム少しずつスクロールさせる。
  //   端に近いほど速くスクロールする（ratioで速度を調整）。
  //   スクロールした分だけ startY をずらし、指の位置に対するカードの
  //   見た目の位置（translateY）がズレないようにする。
  function autoScrollTick() {
    if (!dragEl || !scrollContainer) { autoScrollRAF = null; return; }
    const rect = scrollContainer.getBoundingClientRect();
    const edge = 60;      // 端から何pxでスクロールを開始するか
    const maxSpeed = 14;  // 1フレームあたりの最大スクロール量(px)
    let speed = 0;

    // ★ 修正：端に近いだけでなく、掴んだ位置からその方向へ実際に
    //   EDGE_ARM_PX 以上動かしていることも条件に加える。
    if (lastClientY < rect.top + edge && lastClientY < dragOriginY - EDGE_ARM_PX) {
      const ratio = Math.min(1, (rect.top + edge - lastClientY) / edge);
      speed = -maxSpeed * ratio;
    } else if (lastClientY > rect.bottom - edge && lastClientY > dragOriginY + EDGE_ARM_PX) {
      const ratio = Math.min(1, (lastClientY - (rect.bottom - edge)) / edge);
      speed = maxSpeed * ratio;
    }

    if (speed !== 0) {
      const before = scrollContainer.scrollTop;
      scrollContainer.scrollTop += speed;
      const actualDelta = scrollContainer.scrollTop - before; // 端まで来ていたらここが0になる
      if (actualDelta !== 0) {
        startY -= actualDelta;
        moveDrag(lastClientY);
      }
    }
    autoScrollRAF = requestAnimationFrame(autoScrollTick);
  }

  function beginDrag(item, clientY) {
    dragEl = item;
    startY = clientY;
    lastClientY = clientY;
    dragOriginY = clientY; // ★ 追加：自動スクロール発動判定の基準点
    dragEl.classList.add('dragging');
    dragEl.style.position = 'relative';
    dragEl.style.zIndex = '10';
    dragEl.style.boxShadow = '0 4px 14px rgba(0,0,0,0.18)';
    dragEl.style.opacity = '0.92';
    if (autoScrollRAF === null) autoScrollRAF = requestAnimationFrame(autoScrollTick);
  }

  function moveDrag(clientY) {
    if (!dragEl) return;
    lastClientY = clientY;
    const dy = clientY - startY;
    dragEl.style.transform = `translateY(${dy}px)`;

    const dragRect = dragEl.getBoundingClientRect();
    const dragCenter = dragRect.top + dragRect.height / 2;

    const items = getItems();
    for (const other of items) {
      if (other === dragEl) continue;
      const r = other.getBoundingClientRect();
      const otherCenter = r.top + r.height / 2;
      const otherIsAfter = !!(dragEl.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING);

      if (otherIsAfter && dragCenter > otherCenter) {
        list.insertBefore(dragEl, other.nextSibling);
        // ★ 入れ替えのたびに基準点をリセットして、以降のtranslateYが
        //   新しい位置からの相対移動になるようにする（ジャンプを最小限にする）
        startY = clientY;
        dragEl.style.transform = 'translateY(0px)';
        break;
      } else if (!otherIsAfter && dragCenter < otherCenter) {
        list.insertBefore(dragEl, other);
        startY = clientY;
        dragEl.style.transform = 'translateY(0px)';
        break;
      }
    }
  }

  async function endDrag() {
    if (!dragEl) return;
    if (autoScrollRAF !== null) { cancelAnimationFrame(autoScrollRAF); autoScrollRAF = null; }
    dragEl.classList.remove('dragging');
    dragEl.style.transform = '';
    dragEl.style.zIndex = '';
    dragEl.style.boxShadow = '';
    dragEl.style.opacity = '';
    dragEl.style.position = '';
    dragEl = null;

    // ★ DOM上の最終的な並び順（data-key）から deck.cards を並び替える
    const orderedKeys = getItems().map(it => it.dataset.key);
    const deck = decks.find(d => d.id === currentDeckId);
    if (!deck) return;
    const byKey = new Map(deck.cards.map(c => [cardKey(c), c]));
    const newCards = orderedKeys.map(k => byKey.get(k)).filter(Boolean);
    if (newCards.length !== deck.cards.length) { renderCreatedList(); return; } // 念のための整合性チェック
    deck.cards = newCards;
    saveDecks(decks);
    renderCreatedList();

    // ★ 公開済みなら並び順もサーバーへ反映する（通知はしない）
    if (deck.filename) {
      const ok = await queueSyncDeckToServer(deck);
      if (!ok) showBanner('⚠ 並び替えのサーバー反映に失敗しました（ローカルには保存済み）', '#fffbeb', '#92400e');
    }
  }

  // ── マウス操作（PC） ──
  function onMouseDown(e) {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const item = handle.closest('.created-item');
    if (!item) return;
    e.preventDefault();
    beginDrag(item, e.clientY);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp, { once: true });
  }
  function onMouseMove(e) { moveDrag(e.clientY); }
  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove);
    endDrag();
  }

  // ── タッチ操作（スマホ） ──
  // ★ ハンドルに触れた指の identifier だけを追跡し、その指のtouchmoveだけを
  //   ドラッグ処理として扱う（＝preventDefaultする）。もう片方の指のtouchmoveは
  //   ここで何もしないので、ブラウザ標準の縦スクロールがそのまま働く。
  //   これにより「片方の指でカードを移動させながら、もう片方の指でスクロール」ができる。
  function onTouchStart(e) {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    if (dragTouchId !== null) return; // 既に別の指でドラッグ中なら何もしない
    const item = handle.closest('.created-item');
    if (!item) return;
    const touch = e.changedTouches[0];
    dragTouchId = touch.identifier;
    e.preventDefault();
    beginDrag(item, touch.clientY);
  }
  function findDragTouch(touchList) {
    if (dragTouchId === null) return null;
    for (let i = 0; i < touchList.length; i++) {
      if (touchList[i].identifier === dragTouchId) return touchList[i];
    }
    return null;
  }
  function onTouchMove(e) {
    const t = findDragTouch(e.changedTouches);
    if (!t) return; // ドラッグ中の指以外の動き（＝スクロール用の指）はここで無視する
    e.preventDefault();
    moveDrag(t.clientY);
  }
  function onTouchEnd(e) {
    const t = findDragTouch(e.changedTouches);
    if (!t) return;
    dragTouchId = null;
    endDrag();
  }

  list.addEventListener('mousedown', onMouseDown);
  list.addEventListener('touchstart', onTouchStart, { passive: false });
  list.addEventListener('touchmove',  onTouchMove,  { passive: false });
  list.addEventListener('touchend',   onTouchEnd);
  list.addEventListener('touchcancel', onTouchEnd);
})();
