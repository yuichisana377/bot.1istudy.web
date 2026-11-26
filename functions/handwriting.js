// ============================================================
//  functions/handwriting.js — 手書き文字認識（漢字モード用）の中継
//  ─────────────────────────────────────────────
//  CardMakerの漢字デッキを「手書き」で解答するときに、ブラウザが集めた
//  ペンの軌跡（ストローク）を文字へ変換する。
//  ・画面のCSP（connect-src 'self'）を崩さないよう、ブラウザは同一オリジンの
//    /handwriting だけを呼び、外部サービスへの通信はこのFunctionが行う。
//  ・ストロークの座標しか送らない（ログイン情報・ユーザー情報は一切付けない）。
//  ・認識に失敗した場合はクライアント側が通常の文字入力にフォールバックする。
// ============================================================

const RECOGNIZE_URL = "https://inputtools.google.com/request?itc=ja-t-i0-handwrit&app=mobilesearch";
const MAX_STROKES = 60;
const MAX_POINTS_PER_STROKE = 400;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function onRequestPost({ request }) {
  let data;
  try { data = await request.json(); } catch (e) { return json({ ok: false, error: "bad_json" }, 400); }

  const width = Number(data.width), height = Number(data.height);
  const ink = data.ink;
  if (!(width > 0 && width <= 4000 && height > 0 && height <= 4000)) return json({ ok: false, error: "bad_size" }, 400);
  if (!Array.isArray(ink) || ink.length === 0 || ink.length > MAX_STROKES) return json({ ok: false, error: "bad_ink" }, 400);

  const cleanInk = [];
  for (const s of ink) {
    if (!Array.isArray(s) || s.length !== 3) return json({ ok: false, error: "bad_stroke" }, 400);
    const [xs, ys, ts] = s;
    if (![xs, ys, ts].every(Array.isArray)) return json({ ok: false, error: "bad_stroke" }, 400);
    if (xs.length === 0 || xs.length !== ys.length || xs.length !== ts.length || xs.length > MAX_POINTS_PER_STROKE) {
      return json({ ok: false, error: "bad_stroke" }, 400);
    }
    const num = a => a.map(Number).map(n => (Number.isFinite(n) ? n : 0));
    cleanInk.push([num(xs), num(ys), num(ts)]);
  }

  const payload = {
    options: "enable_pre_space",
    requests: [{
      writing_guide: { writing_area_width: width, writing_area_height: height },
      ink: cleanInk,
      language: "ja",
    }],
  };

  try {
    const res = await fetch(RECOGNIZE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const r = await res.json();
    // 形式: ["SUCCESS", [[ "<id>", ["候補1","候補2",...], ... ]]]
    if (!Array.isArray(r) || r[0] !== "SUCCESS" || !r[1] || !r[1][0] || !Array.isArray(r[1][0][1])) {
      return json({ ok: false, error: "recognize_failed" }, 502);
    }
    const candidates = r[1][0][1].filter(c => typeof c === "string" && c).slice(0, 8);
    return json({ ok: true, candidates });
  } catch (e) {
    return json({ ok: false, error: "upstream_error" }, 502);
  }
}
