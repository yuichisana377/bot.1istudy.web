// ============================================================
//  サービス情報ページ
//  → 現状は静的なアップデート履歴を表示するだけなので、
//    ドロワー（他ページと共通の挙動）の開閉のみ実装
// ============================================================
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}
