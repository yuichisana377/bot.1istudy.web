// ============================================================
//  Version.js — 古いキャッシュを検知して「絶対リセット」する（2026/11/08 追加）
//  ─────────────────────────────────────────────
//  背景：本番ドメインではJS/CSSが最大4時間ブラウザにキャッシュされ、iPhoneの
//  ホーム画面アプリ（PWA）では特に古いJSが使われ続けて、修正が届かなかった。
//
//  仕組み（バージョンは tools/stamp_version.py が JS/CSS の中身から自動生成する）：
//   ① 各HTMLに <meta name="app-version"> と、全ての <script src>/<link href> への
//      ?v=バージョン が入る → HTMLは毎回再検証されるので、版が変わればJS/CSSの
//      URLも変わり、古いキャッシュは使われない。
//   ② 各JSファイルの1行目に自分の版が刻まれている（window.__jsVer）。
//      HTMLの版と食い違うJSが読み込まれたら「古いキャッシュが混ざっている」と判断。
//   ③ 起動時／アプリに戻ってきたとき／bfcache復帰時に /version.json（キャッシュ
//      しない）を取りに行き、画面の版と違えば「長く開きっぱなしの古い画面」と判断。
//  どれかに当たったら、Cache Storage と Service Worker を全て消して、キャッシュを
//  避けた URL（?_r=時刻）で読み込み直す。
//  ・ログイン情報（localStorage）や作成中の下書きは消さない。
//  ・同じ版で何度もリセットしてループしないよう、1回試したら同じ版では再実行しない。
//  ・このファイル自体は <script src="/Version.js?v=…"> で読み込まれるため、
//    古いキャッシュが使われることはない。必ず他のスクリプトより先に読み込むこと。
// ============================================================
(function () {
  'use strict';
  var meta = document.querySelector('meta[name="app-version"]');
  var htmlV = meta ? (meta.getAttribute('content') || '') : '';
  window.APP_VERSION = htmlV;
  var GUARD_KEY = 'app_reset_tried';
  var lastRemoteCheck = 0;

  function warn(msg) { try { console.warn('[app-version] ' + msg); } catch (e) {} }

  // 付けた ?_r=… は、読み込み後にアドレスバーから消しておく
  try {
    var cur = new URL(location.href);
    if (cur.searchParams.has('_r')) {
      cur.searchParams.delete('_r');
      history.replaceState(history.state, '', cur.pathname + cur.search + cur.hash);
    }
  } catch (e) {}

  function clearAllCaches() {
    var jobs = [];
    try {
      if (window.caches && caches.keys) {
        jobs.push(caches.keys().then(function (ks) {
          return Promise.all(ks.map(function (k) { return caches.delete(k); }));
        }));
      }
    } catch (e) {}
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
          return Promise.all(rs.map(function (r) { return r.unregister(); }));
        }));
      }
    } catch (e) {}
    return Promise.all(jobs.map(function (p) { return p.catch(function () {}); }));
  }

  function hardReset(reason, guardValue) {
    try {
      if (sessionStorage.getItem(GUARD_KEY) === guardValue) {
        warn('リセット済みのため再実行しません: ' + reason);
        return;
      }
      sessionStorage.setItem(GUARD_KEY, guardValue);
    } catch (e) {}
    warn('キャッシュを消して読み込み直します: ' + reason);
    var done = false;
    function go() {
      if (done) return;
      done = true;
      try {
        var u = new URL(location.href);
        u.searchParams.set('_r', String(Date.now()));
        location.replace(u.toString());
      } catch (e) { location.reload(); }
    }
    clearAllCaches().then(go);
    setTimeout(go, 2500);   // キャッシュ削除が固まっても必ず読み込み直す
  }

  // 入力中・モーダル表示中・クイズ中は、アプリに戻ってきただけの場面でリセットして
  // 作業中の内容（長い備考の入力など）を消してしまわないよう、リセットを保留する。
  // （ページを開いた直後の load 時は何も入力していないので、保留せずすぐ実行する）
  var pending = null, pendingTimer = null;
  function userIsBusy() {
    try {
      if (document.querySelector('.modal-bg.open, .modal-overlay.open, .qz-modal-overlay.active')) return true;
      var a = document.activeElement;
      if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return true;
      if (document.body && document.body.classList.contains('qz-fixed-screen')) return true;   // Quizの出題・途中経過画面
    } catch (e) {}
    return false;
  }
  function requestReset(reason, guardValue, immediate) {
    if (immediate || !userIsBusy()) { hardReset(reason, guardValue); return; }
    pending = { reason: reason, guardValue: guardValue };
    warn('作業中のため、リセットを保留します: ' + reason);
    if (pendingTimer) return;
    pendingTimer = setInterval(function () {
      if (!pending) { clearInterval(pendingTimer); pendingTimer = null; return; }
      if (document.visibilityState === 'visible' && !userIsBusy()) {
        var p = pending; pending = null;
        clearInterval(pendingTimer); pendingTimer = null;
        hardReset(p.reason, p.guardValue);
      }
    }, 10000);
  }

  // ② 読み込まれたJSの版がHTMLの版と一致しているか
  function verifyJs(immediate) {
    if (!htmlV) return true;
    var m = window.__jsVer || {};
    for (var name in m) {
      if (Object.prototype.hasOwnProperty.call(m, name) && m[name] !== htmlV) {
        requestReset('JSの版が違います（' + name + ' ' + m[name] + ' ≠ 画面 ' + htmlV + '）', htmlV + '/' + m[name], immediate);
        return false;
      }
    }
    return true;
  }
  // 後から読み込むJS（Cardmakerの分割ファイル等）の読み込み後に呼ぶ。作業中かもしれないので保留つき。
  window.__verifyJs = function () { return verifyJs(false); };

  // ③ サーバー上の最新の版と一致しているか（キャッシュを使わず毎回取りに行く）
  function checkRemote(force, immediate) {
    if (!htmlV || !window.fetch) return;
    var now = Date.now();
    if (!force && now - lastRemoteCheck < 60 * 1000) return;   // 連続チェックは1分に1回まで
    lastRemoteCheck = now;
    fetch('/version.json?t=' + now, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.v && j.v !== htmlV) requestReset('新しい版があります（' + htmlV + ' → ' + j.v + '）', 'remote/' + j.v, immediate);
      })
      .catch(function () { /* オフライン等は無視 */ });
  }

  window.addEventListener('load', function () {
    if (verifyJs(true)) checkRemote(true, true);
  });
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) { verifyJs(false); checkRemote(true, false); }   // 戻る／アプリ復帰でページが丸ごと復元された
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') checkRemote(false, false);   // ホーム画面アプリに戻ってきた（作業中なら保留）
  });
})();
