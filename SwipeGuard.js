// ============================================================
//  SwipeGuard.js — 画面端からの横スワイプでブラウザの「戻る/進む」に
//  移動してしまうのを防ぐ（アプリらしい操作感にするための追加・2026/08/20）
//  ─────────────────────────────
//  ★ 全ページ共通で読み込む前提のスクリプト（PendingDeleteCheck.jsと同じ
//    方針）。IIFEで包み、他ページのJSのグローバル変数・関数には一切触れない。
//
//  ・iOS Safari／Android Chrome等の「画面端からの横スワイプで前/次の
//    ページへ戻る・進む」ジェスチャーは、ブラウザ・OS側の機能であり、
//    JSから直接オフにするAPIは存在しない。代わりに、画面端付近から
//    始まった「横方向優位」のタッチ移動だけを touchmove で
//    preventDefault() し、ジェスチャーの引き金になる横方向のパンを
//    ブラウザに渡さないようにする。
//    通常のページ内スクロール・カード一覧の横スクロール等（画面端から
//    始まらない操作）は一切妨げない。
//  ・PC（トラックパッドの2本指スワイプ等でのChrome/Edgeの戻る/進む）
//    向けには、Style.cssに overscroll-behavior-x: none を追加して
//    同じ挙動を防いでいる（こちらはtouchイベントを使わないため別対応）。
//  ・完全に防げる保証はない（ブラウザ・OSのバージョンによっては、この
//    対策より先にジェスチャーが確定してしまうことがある）。
// ============================================================
(function () {
  var EDGE_PX = 24; // この幅（px）より内側から始まった横スワイプだけを対象にする

  var startX = null;
  var startY = null;
  var guardActive = false;

  document.addEventListener('touchstart', function (e) {
    if (!e.touches || e.touches.length !== 1) { guardActive = false; return; }
    var t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    guardActive = (startX <= EDGE_PX) || (startX >= window.innerWidth - EDGE_PX);
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!guardActive || startX === null || !e.touches || e.touches.length !== 1) return;
    var t = e.touches[0];
    var dx = t.clientX - startX;
    var dy = t.clientY - startY;
    // 横方向の動きが縦方向より明確に大きい場合だけ止める
    // （縦スクロールしようとした指がわずかに横へブレただけの場合は妨げない）
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) {
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('touchend', function () { guardActive = false; }, { passive: true });
  document.addEventListener('touchcancel', function () { guardActive = false; }, { passive: true });
})();
