// ============================================================
//  Cardmaker-quizplay.js — クイズ過去問デッキのスコア送信・ランキング取得
//  （遅延読み込みチャンク）
//  ─────────────────────────────────────────────
//  ★ Cardmaker.js から分離。デッキを1周完走したときにしか使わない
//    サーバー通信なので、Cardmaker.js側の loadChunksInBackground() が、
//    一覧の初期表示が終わった後にバックグラウンドで読み込む
//    （このファイル単体では動かず、Cardmaker.jsが先に読み込まれている前提。
//    decks/esc/getLoginSession/API_BASE/GUILD_ID などCardmaker.js側の
//    グローバル関数・変数をそのまま使う）。
//
//  ★ 2026/08/27：以前は一人用選択式クイズが専用の画面（screen-quiz-play、
//    soloQuizCards等の専用state）を持っていたが、「プレイ中の画面もほかの
//    カードでのプレイ画面（screen-study）とほぼ同じにしてほしい（編集ボタン
//    だけ消して、それ以外は同じ画面）」という要望を受け、通常のフラッシュ
//    カード学習画面（screen-study）へ統合した（Cardmaker.js側の
//    openPlayMode/startStudyMode/renderStudyCard/currentStudyChoiceEntry
//    参照）。このファイルには、デッキ完走後のスコア送信・ランキング取得
//    （サーバー通信、頻度が低いので引き続き遅延読み込みのままにしてある）
//    だけが残っている。
// ============================================================

// ★ study-done画面（Cardmaker.js側）の「もう一度」「一覧に戻る」ボタンと同居する
//   #study-done-rank（順位テキスト）・#study-done-leaderboard（ランキング一覧）に
//   結果を描画する。score/totalはCardmaker.js側で既に集計済みの値をそのまま渡す。
async function submitQuizArchiveScoreForStudy(deckId, score, total) {
  const rankEl = document.getElementById('study-done-rank');
  const lbEl = document.getElementById('study-done-leaderboard');
  rankEl.textContent = '結果を送信しています…';

  const session = getLoginSession();
  const deck = decks.find(d => d.id === deckId);
  if (!session || !deck || !deck.filename) {
    // ★ 非公開デッキ・未ログインはランキング機能自体が使えないため、
    //   静かに諦める（スコア自体はstudy-done-subに既に表示済み）。
    rankEl.textContent = '';
    return;
  }

  try {
    await fetch(`${API_BASE}quiz_archive_submit_score`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guild_id: GUILD_ID, session_token: session.session_token,
        filename: deck.filename, score, total,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) { /* スコア送信に失敗してもランキング表示は試みる */ }

  try {
    const res = await fetch(`${API_BASE}quiz_archive_leaderboard?guild_id=${GUILD_ID}&filename=${encodeURIComponent(deck.filename)}`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'Authorization': 'Bearer ' + session.session_token },
    });
    const data = await res.json();
    if (!data.ok) { rankEl.textContent = ''; return; }
    const rows = data.leaderboard;
    const myRank = rows.findIndex(r => r.student_id === session.student_id) + 1;
    rankEl.textContent = myRank > 0 ? `あなたの順位：${myRank} 位 / ${rows.length} 人中` : '';
    lbEl.innerHTML = rows.map((r, i) => `
      <div class="qp-lb-row${r.student_id === session.student_id ? ' me' : ''}">
        <span class="qp-lb-rank">${i + 1}</span>
        <span class="qp-lb-name">${esc(r.nickname)}</span>
        <span class="qp-lb-score">${r.score} / ${r.total}</span>
      </div>`).join('');
  } catch (e) {
    rankEl.textContent = '';
  }
}
