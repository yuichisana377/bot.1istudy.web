// ============================================================
//  DeleteApproval.js — 削除の確認ページ用スクリプト
//  DeleteApproval.html から読み込む。
//  Discordの削除依頼DMに載っているリンク（?token=...）を開いた作成者本人が、
//  何を消されようとしているか確認した上で承諾／拒否するためのページ。
//  ★ ログイン不要（トークン自体がDMで本人にだけ届く合言葉の代わり）。
//  ★ このページに表示する内容（依頼理由・お知らせ本文・カードの問題文など）は
//    すべて利用者が入力したテキストなので、Notice.js等と同じ理由で必ず
//    textContent/DOM APIで組み立てる（innerHTML+テンプレート文字列は禁止）。
// ============================================================

const API_BASE = "https://chiro-ubuntuserver.tail1130ba.ts.net/";

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
  const el = qs('da-action-err');
  el.textContent = msg;
  el.style.display = '';
}
function hideActionError() {
  qs('da-action-err').style.display = 'none';
}

let currentToken = '';
let currentCategory = null;

async function init() {
  currentToken = getToken();
  if (!currentToken) {
    showStep('error');
    qs('error-msg').textContent = 'リンクが正しくありません。DMのリンクからもう一度開いてください。';
    qs('error-msg').style.display = '';
    return;
  }
  try {
    const res = await fetch(`${API_BASE}delete_request_info?token=${encodeURIComponent(currentToken)}`, { cache: 'no-store' });
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
  currentCategory = data.category;
  const categoryLabel = data.category === 'deck' ? 'カードデッキ' : 'お知らせ';

  qs('da-title').textContent = `${categoryLabel}を削除してよいか確認してください`;
  qs('da-target-label').textContent = `対象の${categoryLabel}`;
  qs('da-requester').textContent = `${data.requester_nickname || '（不明）'} さん`;
  qs('da-reason').textContent = data.reason || '（理由が入力されていません）';
  qs('da-target-name').textContent = data.target_name || '（不明）';

  const detailEl = qs('da-detail');
  detailEl.textContent = '';
  const lines = data.detail_lines || [];
  if (lines.length) {
    detailEl.textContent = lines.join('\n');
  } else {
    detailEl.textContent = '（内容を表示できませんでした）';
  }

  if (data.already_gone) {
    qs('da-already-gone').style.display = '';
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
    const res = await fetch(`${API_BASE}respond_delete_request`, {
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
    qs('da-btn-row').style.display = 'none';
    const resultEl = qs('da-result');
    resultEl.textContent = action === 'approve'
      ? '削除しました。ご確認ありがとうございました。'
      : '削除を拒否しました。依頼者にはその旨が伝わります。';
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
