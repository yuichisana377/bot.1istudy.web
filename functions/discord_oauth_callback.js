// ============================================================
//  functions/discord_oauth_callback.js — Discord OAuthコールバックの中継
//  ─────────────────────────────────────────────
//  Discord Developer PortalのOAuth2 Redirectには独自ドメイン
//  （study-web.chiro377.com/discord_oauth_callback）を登録しているため、
//  認可後にDiscordがブラウザを直接この同一オリジンのパスへリダイレクトしてくる。
//  実際の処理（コード交換・セッション発行）を行うFlaskバックエンドは別ホスト
//  （Tailscale経由のchiro-ubuntuserver）にあるため、このFunctionが
//  クエリ文字列ごとそのままバックエンドへ中継する。
//
//  functions/api/[[path]].js（同一オリジンの/api/*用の汎用プロキシ）と同じ
//  BACKEND_ORIGINだが、/discord_oauth_callbackはDiscordから直接ブラウザが
//  叩く固定パスなので/api/配下ではなくルート直下に置く必要がある
//  （こちらは常にGETのみ・bodyなし）。
// ============================================================

const BACKEND_ORIGIN = "https://chiro-ubuntuserver.tail1130ba.ts.net";

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const targetUrl = `${BACKEND_ORIGIN}/discord_oauth_callback${url.search}`;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("cf-connecting-ip");
  headers.delete("cf-ipcountry");
  headers.delete("cf-ray");
  headers.delete("cf-visitor");
  headers.delete("cf-worker");
  const clientIp = request.headers.get("cf-connecting-ip");
  if (clientIp) headers.set("x-forwarded-for", clientIp);

  let backendRes;
  try {
    backendRes = await fetch(targetUrl, {
      method: "GET",
      headers,
      redirect: "manual",
    });
  } catch (e) {
    return new Response("ログイン処理中にバックエンドへ接続できませんでした。時間をおいて再度お試しください。", {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(backendRes.body, {
    status: backendRes.status,
    statusText: backendRes.statusText,
    headers: backendRes.headers,
  });
}
