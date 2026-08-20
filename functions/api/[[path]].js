// ============================================================
//  functions/api/[[path]].js — バックエンド（bot.py）へのリバースプロキシ
//  ─────────────────────────────────────────────
//  ★ 追加（2026/08/20）：以前はフロントの公開JS各所に
//    バックエンドの実ホスト名（Tailscale Funnelのホスト名）が
//    直書きされており、それがそのまま利用者のブラウザ履歴・
//    アクセスログ・fetch先として外部に見えてしまっていた。
//    このCloudflare Pages Functionが同一オリジンの /api/* 宛のリクエストを
//    受け取り、裏でバックエンドへ中継することで、フロント側からは
//    常に相対パス（例：/api/get_study_data）だけを扱えばよくなる
//    （実ホスト名はこのファイル1箇所にしか出てこない）。
//
//  ・GET/POST等どのメソッドも中身を見ずに透過的に中継する。
//  ・EventSource（/api/events、SSEのライブ更新通知）も、fetch()の
//    レスポンスをそのまま返すことでストリーミングとして機能する
//    （bodyを読み込んで再構築するとバッファリングされてしまうため、
//    必ずbackendのResponseをそのまま包んで返す）。
//  ・バックエンド（bot.py）はIPアドレス単位のレート制限
//    （ログイン試行・確認コード等）に X-Forwarded-For の先頭値を
//    使っている。何もしないと全リクエストがこのWorkerの発信元IPから
//    来たように見えてしまいレート制限が壊れるため、Cloudflareが
//    教えてくれる実クライアントIP（CF-Connecting-IP）を
//    X-Forwarded-For として明示的に引き継ぐ。
// ============================================================

const BACKEND_ORIGIN = "https://chiro-ubuntuserver.tail1130ba.ts.net";

// ヘッダーをそのまま転送すると問題になりうるもの（Cloudflare内部用・
// Workerが自動再計算すべきもの）だけを取り除く。それ以外
// （Content-Type/Authorization等）はそのまま中継する。
const STRIP_REQUEST_HEADERS = [
  "host", "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor",
  "cf-worker", "x-forwarded-for", "content-length",
];

export async function onRequest(context) {
  const { request, params } = context;
  const segments = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const url = new URL(request.url);
  const targetUrl = `${BACKEND_ORIGIN}/${segments.map(encodeURIComponent).join('/')}${url.search}`;

  const headers = new Headers(request.headers);
  STRIP_REQUEST_HEADERS.forEach(h => headers.delete(h));
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) headers.set('x-forwarded-for', clientIp);

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = await request.arrayBuffer();
  }

  let backendRes;
  try {
    backendRes = await fetch(targetUrl, init);
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'backend_unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ★ SSE（/events）を含め、レスポンスはそのまま（ストリーミングのまま）返す。
  return new Response(backendRes.body, {
    status: backendRes.status,
    statusText: backendRes.statusText,
    headers: backendRes.headers,
  });
}
