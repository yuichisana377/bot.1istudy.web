// ============================================================
//  PendingShareCheck.js — 共有リンク発行依頼のWeb確認（Discord未連携の受け皿）
//  ─────────────────────────────
//  CardMakerのデッキ作成者本人以外が「共有リンクを作りたい」と依頼すると、
//  通常はDiscord DMで本人に確認が届く（ShareApproval.html）。しかし作成者が
//  Discordと連携していない場合はDMを送れないため、サーバー側
//  （bot.py /request_deck_share）に控えておいた依頼を、次にこのサイトの
//  どれかのページを開いたときにここで拾って確認モーダルを出す。
//  PendingDeleteCheck.js（削除確認の同種の仕組み）とほぼ同じ構造。
//
//  ★ 全ページ共通で読み込む前提のスクリプトなので、各ページのJS
//    （Cardmaker.js/Notice.js等）と同じグローバル名（API_BASE/GUILD_ID/
//    SESSION_KEY）をconstで再宣言すると「重複宣言」でページ全体のスクリプトが
//    止まってしまう。そのためここでは値をリテラルのまま使い、
//    他のファイルの変数・関数には一切触れない（読み込み順に依存しない）。
//  ★ 表示内容（依頼理由・デッキ名・依頼者名）はすべて利用者が入力した
//    テキストなので、Notice.js等の保存型XSS対策と同じ理由で、必ず
//    textContent/DOM APIで組み立てる（innerHTML+テンプレート文字列は禁止）。
// ============================================================
(function () {
  const PSC_API_BASE = "/api/";

  function pscGetSession() {
    try { return JSON.parse(localStorage.getItem('sl_session')); } catch (e) { return null; }
  }

  // ★ 複数サーバー対応：以前は固定値だったが、"current_guild"（Login.js参照）
  //   から読む形にした。ページ共通のGUILD_ID定数は再宣言できないため、
  //   このIIFE専用にPSC_プレフィックスで独立して持つ。
  function pscGetGuildId() {
    try {
      const g = JSON.parse(localStorage.getItem('current_guild'));
      return g && g.guild_id ? String(g.guild_id) : null;
    } catch (e) { return null; }
  }

  async function pscCheck() {
    const session = pscGetSession();
    const guildId = pscGetGuildId();
    if (!session || !session.session_token || !guildId) return;
    try {
      const url = `${PSC_API_BASE}pending_share_requests?guild_id=${guildId}`;
      const res = await fetch(url, { cache: 'no-store', headers: { 'Authorization': 'Bearer ' + session.session_token } });
      const data = await res.json();
      if (!data.ok || !data.requests || !data.requests.length) return;
      pscQueue = data.requests.slice();
      pscShowNext();
    } catch (e) {
      // 静かに諦める。次回サイトを開いたときにまた確認される。
    }
  }

  let pscQueue = [];
  function pscShowNext() {
    if (!pscQueue.length) return;
    pscRenderModal(pscQueue.shift());
  }

  function pscRenderModal(req) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';

    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:14px;max-width:420px;width:100%;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.25);font-family:inherit;';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:17px;font-weight:700;margin-bottom:10px;color:#1a1a18;';
    title.innerHTML = Icons.html('link', {size:18}) + ' 共有リンクの確認依頼が届いています';
    card.appendChild(title);

    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:13px;color:#6b6b68;line-height:1.6;margin-bottom:14px;';
    desc.textContent = `${req.requester_nickname || '（不明）'}さんが、あなたが作成したカードデッキ「${req.deck_name || '（不明）'}」の外部共有リンク発行を依頼しています。`;
    card.appendChild(desc);

    const reasonLabel = document.createElement('div');
    reasonLabel.style.cssText = 'font-size:11px;font-weight:700;color:#6b6b68;margin-bottom:4px;';
    reasonLabel.textContent = '理由';
    card.appendChild(reasonLabel);

    const reasonBox = document.createElement('div');
    reasonBox.style.cssText = 'white-space:pre-wrap;word-break:break-word;font-size:13.5px;color:#1a1a18;background:#f9f9f8;border:1px solid #e8e8e5;border-radius:6px;padding:10px 12px;margin-bottom:14px;max-height:160px;overflow-y:auto;';
    reasonBox.textContent = req.reason || '（理由が入力されていません）';
    card.appendChild(reasonBox);

    const note = document.createElement('div');
    note.style.cssText = 'font-size:11.5px;color:#b0b0ac;line-height:1.5;margin-bottom:14px;';
    note.textContent = '承諾しても、この場でリンクは発行されません。依頼者がCardMakerで改めて操作すると発行されます。Discordと連携していないため、このページで確認しています。';
    card.appendChild(note);

    const err = document.createElement('div');
    err.style.cssText = 'display:none;background:#fee2e2;color:#991b1b;border-radius:6px;padding:9px 12px;font-size:12.5px;margin-bottom:10px;';
    card.appendChild(err);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.textContent = '承諾する';
    approveBtn.style.cssText = 'background:#1a1a18;color:#fff;border:none;border-radius:8px;padding:12px;font-size:14.5px;font-weight:600;cursor:pointer;';

    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.textContent = '拒否する';
    rejectBtn.style.cssText = 'background:none;color:#991b1b;border:1px solid #fca5a5;border-radius:8px;padding:12px;font-size:14.5px;cursor:pointer;';

    const laterBtn = document.createElement('button');
    laterBtn.type = 'button';
    laterBtn.textContent = 'あとで（次に開いたときにまた聞く）';
    laterBtn.style.cssText = 'background:none;color:#6b6b68;border:none;padding:6px;font-size:12.5px;cursor:pointer;text-decoration:underline;';

    function pscCloseAndNext() {
      if (overlay.parentNode) document.body.removeChild(overlay);
      pscShowNext();
    }

    async function pscRespond(action, btn) {
      err.style.display = 'none';
      approveBtn.disabled = true; rejectBtn.disabled = true; laterBtn.disabled = true;
      const original = btn.textContent;
      btn.textContent = '処理中…';
      try {
        const res = await fetch(`${PSC_API_BASE}respond_deck_share_request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: req.token, action }),
        });
        const data = await res.json();
        if (!data.ok) {
          err.textContent = data.error || '処理に失敗しました';
          err.style.display = '';
          approveBtn.disabled = false; rejectBtn.disabled = false; laterBtn.disabled = false;
          btn.textContent = original;
          return;
        }
        pscCloseAndNext();
      } catch (e) {
        err.textContent = 'サーバーに接続できませんでした。';
        err.style.display = '';
        approveBtn.disabled = false; rejectBtn.disabled = false; laterBtn.disabled = false;
        btn.textContent = original;
      }
    }

    approveBtn.addEventListener('click', () => pscRespond('approve', approveBtn));
    rejectBtn.addEventListener('click', () => pscRespond('reject', rejectBtn));
    laterBtn.addEventListener('click', pscCloseAndNext);

    btnRow.appendChild(approveBtn);
    btnRow.appendChild(rejectBtn);
    card.appendChild(btnRow);
    card.appendChild(laterBtn);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', pscCheck);
  } else {
    pscCheck();
  }
})();
