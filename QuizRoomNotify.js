// ============================================================
//  QuizRoomNotify.js — 「みんなでクイズ」の開催中ルーム通知
//  ─────────────────────────────
//  ページを開いた時点で、参加できるクイズ部屋（待機中＝lobby、または
//  ホストが途中参加を許可している進行中の部屋）が1つでもあれば、
//  右上にカード型の通知を出す。Quiz.htmlの「参加する」画面が使っている
//  既存の /quiz_list_rooms をそのまま流用しており、バックエンド側の変更は無い。
//  PendingDeleteCheck.js/PendingShareCheck.js（全ページ共通で読み込む
//  「開いたら確認する」系スクリプト）と同じ構造・同じ注意点：
//  ★ 各ページのJS（Cardmaker.js等）と同じグローバル名（API_BASE/GUILD_ID/
//    SESSION_KEY）をconstで再宣言すると衝突してページ全体のスクリプトが
//    止まるため、値はリテラルのまま使い、QRN_プレフィックスの専用名だけを持つ。
//  ★ 部屋タイトルは利用者が入力したテキストなので、必ずtextContentで
//    組み立てる（innerHTMLでのHTML文字列組み立ては禁止）。アイコン部分
//    （Icons.js、開発者固定のSVGのみ）だけはinnerHTMLで問題ない。
//
//  「閉じる（×）」を押した部屋は、その部屋が一覧から消える（終了・
//  ガベージコレクト）までlocalStorageに記憶して再表示しない
//  （ユーザーの明示的な選択：ページ遷移のたびに毎回出るとうるさいため）。
//
//  ★ 追加：ページを開いた瞬間だけでなく、「クイズ部屋が作られた瞬間」にも
//    通知するため、他ページ（Cardmaker.js等）と同じ仕組み（/api/events、
//    SSEのライブ更新通知）を使う。bot.py側は quiz_create() で
//    notify_change(guild_id) を呼ぶだけ（中身は含まない合図のみ）なので、
//    受け取った側であるここが毎回 qrnCheck() をやり直して最新状態を
//    取りに行く。スケジュール変更等クイズと無関係な合図でも飛んでくるが、
//    やることは同じ軽いGET1回なので無駄にはならない（他ページの
//    startRealtimeUpdates()と同じ設計思想）。
// ============================================================
(function () {
  const QRN_API_BASE = "/api/";
  const QRN_DISMISS_KEY = 'qrn_dismissed_codes';

  function qrnGetSession() {
    try { return JSON.parse(localStorage.getItem('sl_session')); } catch (e) { return null; }
  }

  function qrnGetGuildId() {
    try {
      const g = JSON.parse(localStorage.getItem('current_guild'));
      return g && g.guild_id ? String(g.guild_id) : null;
    } catch (e) { return null; }
  }

  function qrnLoadDismissed() {
    try { return JSON.parse(localStorage.getItem(QRN_DISMISS_KEY)) || {}; } catch (e) { return {}; }
  }

  function qrnSaveDismissed(obj) {
    try { localStorage.setItem(QRN_DISMISS_KEY, JSON.stringify(obj)); } catch (e) { /* 保存できなくても致命的ではない */ }
  }

  function qrnIsJoinable(room) {
    // ★ Quiz.jsのloadRoomList()と同じ判定：lobby中は誰でも、それ以外は
    //   ホストが途中参加(allow_late_join)を許可している場合のみ参加できる。
    return room.state === 'lobby' || !!room.allow_late_join;
  }

  // ★ SSE経由でひっきりなしに再チェックが走る（クイズと無関係な合図でも
  //   毎回qrnCheck()し直すため）中で、内容が変わっていないのに毎回
  //   通知を作り直すとチラつく。表示中の部屋の組み合わせが前回と同じなら
  //   再描画をスキップするための署名。
  let qrnLastSignature = null;
  function qrnSignature(rooms) {
    return rooms.map(r => `${r.code}:${r.state}:${r.current_q}`).sort().join('|');
  }

  function qrnBuildMessage(rooms) {
    if (rooms.length === 1) {
      const r = rooms[0];
      if (r.state === 'lobby') return `「${r.title}」が参加者を待っています`;
      const qNum = (typeof r.current_q === 'number') ? `（第${r.current_q + 1}問）` : '';
      return `「${r.title}」に途中から参加できます${qNum}`;
    }
    return `現在${rooms.length}件のクイズ部屋が参加受付中です`;
  }

  function qrnShowToast(rooms) {
    // ★ 既に表示中の通知があれば作り直す（SSE経由の再チェックで部屋数・
    //   状態が変わっていても、古い表示のまま放置しないようにするため）。
    const existing = document.getElementById('qrn-toast');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    const box = document.createElement('div');
    box.className = 'qrn-toast';
    box.id = 'qrn-toast';

    const row = document.createElement('div');
    row.className = 'qrn-toast-row';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'qrn-toast-icon';
    if (window.Icons && Icons.cmBadgeHtml) iconWrap.innerHTML = Icons.cmBadgeHtml('quiz', { box: 38 });
    row.appendChild(iconWrap);

    const main = document.createElement('div');
    main.className = 'qrn-toast-main';

    const headline = document.createElement('div');
    headline.className = 'qrn-toast-headline';

    const title = document.createElement('div');
    title.className = 'qrn-toast-title';
    title.textContent = 'みんなでクイズ';
    headline.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'qrn-toast-close';
    closeBtn.setAttribute('aria-label', '閉じる');
    closeBtn.innerHTML = (window.Icons && Icons.html) ? Icons.html('close', { size: 14, color: '#6b6b68' }) : '×';
    headline.appendChild(closeBtn);

    main.appendChild(headline);

    const body = document.createElement('div');
    body.className = 'qrn-toast-body';
    body.textContent = qrnBuildMessage(rooms); // ★ textContent。タイトルにHTMLが混ざっていても安全。
    main.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'qrn-toast-actions';
    const joinBtn = document.createElement('button');
    joinBtn.type = 'button';
    joinBtn.className = 'qrn-toast-join';
    joinBtn.textContent = '参加する →';
    joinBtn.addEventListener('click', () => { location.href = 'Quiz.html?mode=join'; });
    actions.appendChild(joinBtn);
    main.appendChild(actions);

    row.appendChild(main);
    box.appendChild(row);
    document.body.appendChild(box);

    closeBtn.addEventListener('click', () => {
      const dismissed = qrnLoadDismissed();
      rooms.forEach(r => { dismissed[r.code] = true; });
      qrnSaveDismissed(dismissed);
      box.classList.remove('qrn-show');
      setTimeout(() => { if (box.parentNode) box.parentNode.removeChild(box); }, 300);
    });

    // ★ appendした直後にクラスを付けるとtransitionが効かないことがあるため、
    //   1フレーム待ってからスライドインさせる。
    requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('qrn-show')));
  }

  async function qrnCheck() {
    const session = qrnGetSession();
    const guildId = qrnGetGuildId();
    if (!session || !session.session_token || !guildId) return; // 未ログイン・サーバー未設定なら何もしない

    let data;
    try {
      const res = await fetch(`${QRN_API_BASE}quiz_list_rooms?guild_id=${guildId}`, {
        cache: 'no-store',
        headers: { 'Authorization': 'Bearer ' + session.session_token },
      });
      data = await res.json();
    } catch (e) {
      return; // 静かに諦める。次に開いたページでまた確認される。
    }
    if (!data || !data.ok) return; // 制限付きアカウント（guild_membership_required）等も含め、失敗時は黙って何もしない

    const rooms = data.rooms || [];

    // ★ 閉じた（×を押した）部屋の記憶は、その部屋が一覧から消えた
    //   （終了／サーバー側のガベージコレクト）時点で忘れる。
    const dismissed = qrnLoadDismissed();
    const liveCodes = new Set(rooms.map(r => r.code));
    let dismissedChanged = false;
    Object.keys(dismissed).forEach(code => {
      if (!liveCodes.has(code)) { delete dismissed[code]; dismissedChanged = true; }
    });
    if (dismissedChanged) qrnSaveDismissed(dismissed);

    const target = rooms.filter(r => qrnIsJoinable(r) && !dismissed[r.code]);
    if (!target.length) {
      qrnLastSignature = null;
      // ★ SSE経由の再チェックで「表示していた部屋が終了した」等の場合、
      //   古い通知を出しっぱなしにしない。
      const existing = document.getElementById('qrn-toast');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    const sig = qrnSignature(target);
    if (sig === qrnLastSignature && document.getElementById('qrn-toast')) return; // 内容に変化なし。作り直さない。
    qrnLastSignature = sig;
    qrnShowToast(target);
  }

  // ★ 他ページ（Cardmaker.js等）のstartRealtimeUpdates()と同じ方式：
  //   SSE接続を張っておき、「何か変わった」合図が来るたびにqrnCheck()を
  //   やり直す。/api/eventsは認証不要（合図だけで中身を含まないため）。
  function qrnStartRealtime() {
    const session = qrnGetSession();
    const guildId = qrnGetGuildId();
    if (!session || !session.session_token || !guildId) return;
    try {
      const es = new EventSource(`${QRN_API_BASE}events?guild_id=${guildId}`);
      es.onmessage = () => { qrnCheck(); };
      // onerrorは特に何もしない（EventSourceが自動的に再接続を試みる）
    } catch (e) {
      // EventSource非対応環境でも、ページを開いた瞬間のqrnCheck()だけで最低限は機能する
    }
  }

  function qrnInit() {
    qrnCheck();
    qrnStartRealtime();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', qrnInit);
  } else {
    qrnInit();
  }
})();
