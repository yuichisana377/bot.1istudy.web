// ============================================================
//  ShareApproval.js — 共有リンク発行の確認ページ用スクリプト
//  ShareApproval.html から読み込む。DeleteApproval.jsとほぼ同じ構造。
//  Discordの共有依頼DMに載っているリンク（?token=...）を開いた作成者本人が、
//  誰が・どのデッキを・なぜ共有したいか確認した上で承諾／拒否するためのページ。
//  ★ ログイン不要（トークン自体がDMで本人にだけ届く合言葉の代わり）。
//  ★ 承諾しても、この場では共有リンクそのものは発行されない（依頼者に
//    「1回分の権利」が渡るだけ。実際の発行はCardMaker側で依頼者が行う）。
//  ★ このページに表示する内容（依頼理由・デッキ名など）はすべて利用者が
//    入力したテキストなので、Notice.js等と同じ理由で必ずtextContent/DOM APIで
//    組み立てる（innerHTML+テンプレート文字列は禁止）。
// ============================================================

const API_BASE = "/api/";

function qs(id) { return document.getElementById(id); }

function getToken() {
  return new URLSearchParams(location.search).get('token') || '';
}

function showStep(name) {
  ['loading', 'error', 'body'].forEach(s => {
    qs(`step-${s}`).style.display = (s === name) ? '' : 'none';
  });
}

function showActionError(msg) {
  const el = qs('sa-action-err');
  el.textContent = msg;
  el.style.display = '';
}
function hideActionError() {
  qs('sa-action-err').style.display = 'none';
}

let currentToken = '';

async function init() {
  currentToken = getToken();
  if (!currentToken) {
    showStep('error');
    qs('error-msg').textContent = 'リンクが正しくありません。DMのリンクからもう一度開いてください。';
    qs('error-msg').style.display = '';
    return;
  }
  try {
    const res = await fetch(`${API_BASE}share_request_info?token=${encodeURIComponent(currentToken)}`, { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok) {
      showStep('error');
      qs('error-msg').textContent = data.error || 'リンクが無効か、期限切れです。';
      qs('error-msg').style.display = '';
      return;
    }
    renderRequest(data);
    showStep('body');
  } catch (e) {
    showStep('error');
    qs('error-msg').textContent = 'サーバーに接続できませんでした。';
    qs('error-msg').style.display = '';
  }
}

function renderRequest(data) {
  qs('sa-requester').textContent = `${data.requester_nickname || '（不明）'} さん`;
  qs('sa-reason').textContent = data.reason || '（理由が入力されていません）';
  qs('sa-deck-name').textContent = data.deck_name || '（不明）';

  if (data.already_gone) {
    qs('sa-already-gone').style.display = '';
  }
}

async function respond(action) {
  hideActionError();
  const approveBtn = qs('btn-approve');
  const rejectBtn = qs('btn-reject');
  approveBtn.disabled = true;
  rejectBtn.disabled = true;
  const clickedBtn = action === 'approve' ? approveBtn : rejectBtn;
  const originalLabel = clickedBtn.textContent;
  clickedBtn.textContent = '処理中…';

  try {
    const res = await fetch(`${API_BASE}respond_deck_share_request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: currentToken, action }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!data.ok) {
      showActionError(data.error || '処理に失敗しました');
      approveBtn.disabled = false;
      rejectBtn.disabled = false;
      clickedBtn.textContent = originalLabel;
      return;
    }
    qs('sa-btn-row').style.display = 'none';
    const resultEl = qs('sa-result');
    resultEl.textContent = data.message || (action === 'approve' ? '承認しました。' : '却下しました。');
    resultEl.style.display = '';
  } catch (e) {
    showActionError('サーバーに接続できませんでした。');
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
    clickedBtn.textContent = originalLabel;
  }
}

qs('btn-approve').addEventListener('click', () => respond('approve'));
qs('btn-reject').addEventListener('click', () => respond('reject'));

init();

// ★ ここまでエラーなく実行できた＝JSが生きている合図として、<body>先頭の
//   「読み込み中…」代替表示（js-fail-fallback、Icons.js参照）を消す。
hideLoadingFallback();
