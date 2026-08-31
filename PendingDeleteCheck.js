// ============================================================
//  PendingDeleteCheck.js — 削除依頼のWeb確認（Discord未連携の受け皿）
//  ─────────────────────────────
//  作成者本人以外がデッキ／お知らせの削除を依頼すると、通常はDiscord DMで
//  本人に確認が届く（DeleteApproval.html）。しかし作成者がDiscordと連携して
//  いない場合はDMを送れないため、サーバー側（bot.py /request_delete）に
//  控えておいた依頼を、次にこのサイトのどれかのページを開いたときにここで
//  拾って確認モーダルを出す。
//
//  ★ 全ページ共通で読み込む前提のスクリプトなので、各ページのJS
//    （Cardmaker.js/Notice.js等）と同じグローバル名（API_BASE/GUILD_ID/
//    SESSION_KEY）をconstで再宣言すると「重複宣言」でページ全体のスクリプトが
//    止まってしまう。そのためここでは値をリテラルのまま使い、
//    他のファイルの変数・関数には一切触れない（読み込み順に依存しない）。
//  ★ 表示内容（依頼理由・対象名・依頼者名）はすべて利用者が入力した
//    テキストなので、Notice.js等の保存型XSS対策と同じ理由で、必ず
//    textContent/DOM APIで組み立てる（innerHTML+テンプレート文字列は禁止）。
// ============================================================
(function () {
  const PDC_API_BASE = "/api/";

  function pdcGetSession() {
    try { return JSON.parse(localStorage.getItem('sl_session')); } catch (e) { return null; }
  }

  // ★ 複数サーバー対応：以前は固定値だったが、"current_guild"（Login.js参照）
  //   から読む形にした。ページ共通のGUILD_ID定数は再宣言できないため、
  //   このIIFE専用にPDC_プレフィックスで独立して持つ。
  function pdcGetGuildId() {
    try {
      const g = JSON.parse(localStorage.getItem('current_guild'));
      return g && g.guild_id ? String(g.guild_id) : null;
    } catch (e) { return null; }
  }

  async function pdcCheck() {
    const session = pdcGetSession();
    const guildId = pdcGetGuildId();
    if (!session || !session.session_token || !guildId) return;
    try {
      // ★ session_tokenはURLクエリに載せない（ブラウザ履歴・アクセスログ・Refererに
      //   残るリスクがあるため）。Authorizationヘッダで送る。
      const url = `${PDC_API_BASE}pending_delete_requests?guild_id=${guildId}`;
      const res = await fetch(url, { cache: 'no-store', headers: { 'Authorization': 'Bearer ' + session.session_token } });
      const data = await res.json();
      if (!data.ok || !data.requests || !data.requests.length) return;
      pdcQueue = data.requests.slice();
      pdcShowNext();
    } catch (e) {
      // 静かに諦める。次回サイトを開いたときにまた確認される。
    }
  }

  let pdcQueue = [];
  function pdcShowNext() {
    if (!pdcQueue.length) return;
    pdcRenderModal(pdcQueue.shift());
  }

  function pdcRenderModal(req) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';

    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:14px;max-width:420px;width:100%;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.25);font-family:inherit;';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:17px;font-weight:700;margin-bottom:10px;color:#1a1a18;';
    title.innerHTML = Icons.html('trash', {size:18}) + ' 削除の確認依頼が届いています';
    card.appendChild(title);

    const categoryLabel = req.category === 'deck' ? 'カードデッキ' : 'お知らせ';
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:13px;color:#6b6b68;line-height:1.6;margin-bottom:14px;';
    desc.textContent = `${req.requester_nickname || '（不明）'}さんが、あなたが作成した${categoryLabel}「${req.target_name || '（不明）'}」の削除を依頼しています。`;
    card.appendChild(desc);

    // ★ 追加（2026/08/31）：この確認が「誰宛か」を明示する。トークン所持
    //   （このAPIでは実質「今ログイン中のセッション」）だけで本人確認とする
    //   設計のため、何らかの理由でログイン中の本人と依頼の宛先がずれていても
    //   気づく手段がこれまで無かった（実際に、拒否した人と表示名が食い違う
    //   事故が起きた）。宛先の名前を出し、今ログイン中のニックネームと
    //   異なる場合は警告する。
    const ownerRow = document.createElement('div');
    ownerRow.style.cssText = 'font-size:13px;font-weight:700;color:#1a1a18;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 12px;margin-bottom:10px;';
    ownerRow.textContent = `宛先: ${req.owner_nickname || '（不明）'}さん`;
    card.appendChild(ownerRow);

    const session = pdcGetSession();
    if (req.owner_nickname && session && session.nickname && session.nickname !== req.owner_nickname) {
      const mismatchNote = document.createElement('div');
      mismatchNote.style.cssText = 'font-size:12px;color:#991b1b;background:#fee2e2;border-radius:6px;padding:8px 12px;margin-bottom:10px;line-height:1.5;';
      mismatchNote.textContent = `⚠ 今「${session.nickname}」としてログイン中ですが、この依頼の宛先は「${req.owner_nickname}」さんです。自分宛ではない可能性が高いため、「あとで」を選んで操作しないでください。`;
      card.appendChild(mismatchNote);
    }

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
    note.textContent = 'Discordと連携していないため、このページで確認しています（あとで /id連携 すると次回からDMでも届きます）。';
    card.appendChild(note);

    const err = document.createElement('div');
    err.style.cssText = 'display:none;background:#fee2e2;color:#991b1b;border-radius:6px;padding:9px 12px;font-size:12.5px;margin-bottom:10px;';
    card.appendChild(err);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.textContent = '承諾して削除する';
    approveBtn.style.cssText = 'background:#1a1a18;color:#fff;border:none;border-radius:8px;padding:12px;font-size:14.5px;font-weight:600;cursor:pointer;';

    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.textContent = '拒否する';
    rejectBtn.style.cssText = 'background:none;color:#991b1b;border:1px solid #fca5a5;border-radius:8px;padding:12px;font-size:14.5px;cursor:pointer;';

    const laterBtn = document.createElement('button');
    laterBtn.type = 'button';
    laterBtn.textContent = 'あとで（次に開いたときにまた聞く）';
    laterBtn.style.cssText = 'background:none;color:#6b6b68;border:none;padding:6px;font-size:12.5px;cursor:pointer;text-decoration:underline;';

    function pdcCloseAndNext() {
      if (overlay.parentNode) document.body.removeChild(overlay);
      pdcShowNext();
    }

    async function pdcRespond(action, btn) {
      err.style.display = 'none';
      approveBtn.disabled = true; rejectBtn.disabled = true; laterBtn.disabled = true;
      const original = btn.textContent;
      btn.textContent = '処理中…';
      try {
        const res = await fetch(`${PDC_API_BASE}respond_delete_request`, {
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
        pdcCloseAndNext();
      } catch (e) {
        err.textContent = 'サーバーに接続できませんでした。';
        err.style.display = '';
        approveBtn.disabled = false; rejectBtn.disabled = false; laterBtn.disabled = false;
        btn.textContent = original;
      }
    }

    approveBtn.addEventListener('click', () => pdcRespond('approve', approveBtn));
    rejectBtn.addEventListener('click', () => pdcRespond('reject', rejectBtn));
    laterBtn.addEventListener('click', pdcCloseAndNext);

    btnRow.appendChild(approveBtn);
    btnRow.appendChild(rejectBtn);
    card.appendChild(btnRow);
    card.appendChild(laterBtn);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', pdcCheck);
  } else {
    pdcCheck();
  }
})();
