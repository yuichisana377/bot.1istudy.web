/*@ver*/(window.__jsVer=window.__jsVer||{})["Cardmaker-handwriting.js"]="b89a347695";/*@end*/// ============================================================
//  Cardmaker-handwriting.js — 手書き解答パッド（漢字モード）
//  ─────────────────────────────────────────────
//  学習画面（screen-study）の自動採点で、解答入力欄の上に手書きキャンバスを出す。
//  ・書き終えて少し待つと /handwriting（functions/handwriting.js）へストロークを送り、
//    認識結果の最も可能性の高い第1候補だけを解答入力欄へ自動入力する（他の候補は出さない）。
//  ・入力欄は手で直せるので、認識が外れても／通信に失敗しても採点できる。
//  ・採点そのものは既存のgradeCurrentAnswer（入力欄の文字と正解の一致判定）をそのまま使う。
// ============================================================
(function () {
  const RECOGNIZE_DELAY_MS = 700;
  let canvas = null, ctx = null;
  let strokes = [];          // [{xs:[], ys:[], ts:[]}]
  let cur = null;            // 書いている最中のストローク
  let t0 = 0;
  let timer = null;
  let seq = 0;               // 古い認識結果で新しい結果を上書きしないための連番

  function el(id) { return document.getElementById(id); }

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function sizeCanvas() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function redraw() {
    if (!canvas) return;
    sizeCanvas();
    const r = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = cssVar('--text', '#111');
    const all = cur ? strokes.concat([cur]) : strokes;
    for (const s of all) {
      ctx.beginPath();
      for (let i = 0; i < s.xs.length; i++) {
        if (i === 0) ctx.moveTo(s.xs[i], s.ys[i]); else ctx.lineTo(s.xs[i], s.ys[i]);
      }
      if (s.xs.length === 1) ctx.lineTo(s.xs[0] + 0.1, s.ys[0]);
      ctx.stroke();
    }
    const hint = el('hw-hint');
    if (hint) hint.style.display = all.length ? 'none' : '';
  }

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function onDown(e) {
    if (e.button !== undefined && e.button > 0) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    clearTimeout(timer);
    if (!strokes.length) t0 = Date.now();
    const [x, y] = pos(e);
    cur = { xs: [x], ys: [y], ts: [Date.now() - t0] };
    redraw();
  }
  function onMove(e) {
    if (!cur) return;
    e.preventDefault();
    const [x, y] = pos(e);
    cur.xs.push(x); cur.ys.push(y); cur.ts.push(Date.now() - t0);
    redraw();
  }
  function onUp(e) {
    if (!cur) return;
    e.preventDefault();
    if (cur.xs.length > 400) { // 長すぎるストロークは間引く（サーバー側の上限対策）
      const step = Math.ceil(cur.xs.length / 400);
      const pick = a => a.filter((_, i) => i % step === 0);
      cur = { xs: pick(cur.xs), ys: pick(cur.ys), ts: pick(cur.ts) };
    }
    strokes.push(cur); cur = null;
    redraw();
    scheduleRecognize();
  }

  function scheduleRecognize() {
    clearTimeout(timer);
    if (!strokes.length) return;
    timer = setTimeout(recognize, RECOGNIZE_DELAY_MS);
  }

  function setStatus(text) { const s = el('hw-status'); if (s) s.textContent = text; }

  async function recognize() {
    if (!strokes.length) return;
    const my = ++seq;
    const r = canvas.getBoundingClientRect();
    setStatus('認識中…');
    try {
      const res = await fetch('/handwriting', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          width: Math.round(r.width), height: Math.round(r.height),
          ink: strokes.map(s => [s.xs.map(Math.round), s.ys.map(Math.round), s.ts]),
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      if (my !== seq) return; // 認識中にさらに書き足された／消された
      if (!data.ok || !data.candidates || !data.candidates.length) throw new Error(data.error || 'no_result');
      el('study-answer-input').value = data.candidates[0];
      setStatus('認識結果（違う時は書き直すか、下の欄で直接直せます）');
    } catch (e) {
      if (my !== seq) return;
      setStatus('認識できませんでした。もう一度書くか、下の欄に直接入力してください');
    }
  }

  // ── 公開関数（Cardmaker.js / Cardmaker.html から呼ぶ） ──
  window.hwClear = function () {
    clearTimeout(timer); seq++;
    strokes = []; cur = null;
    if (canvas) redraw();
    setStatus('');
    const input = el('study-answer-input');
    if (input) input.value = '';
  };
  window.hwUndo = function () {
    if (!strokes.length) return;
    clearTimeout(timer); seq++;
    strokes.pop();
    redraw();
    if (strokes.length) scheduleRecognize();
    else { setStatus(''); el('study-answer-input').value = ''; }
  };
  // 書く場所の大きさ（普通／大きい）を切り替える。高さだけ変わるので、書いた線はそのまま残る。
  function applySize(big) {
    if (!canvas) return;
    canvas.classList.toggle('big', big);
    const b = el('hw-size-btn');
    if (b) b.textContent = big ? '小さくする' : '大きくする';
    redraw();
  }
  window.hwToggleSize = function () {
    const big = !canvas.classList.contains('big');
    applySize(big);
    try { localStorage.setItem('cm-hw-big', big ? '1' : '0'); } catch (_) {}
  };
  // 学習画面のカードが切り替わった時／手書きモードの表示を切り替える時に呼ぶ
  window.hwSetup = function (enabled) {
    const wrap = el('study-handwriting-wrap');
    if (!wrap) return;
    wrap.style.display = enabled ? '' : 'none';
    if (!enabled) { window.hwClear(); return; }
    if (!canvas) {
      canvas = el('hw-canvas');
      ctx = canvas.getContext('2d');
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
      window.addEventListener('resize', redraw);
    }
    window.hwClear();
    let big = false;
    try { big = localStorage.getItem('cm-hw-big') === '1'; } catch (_) {}
    applySize(big);
    requestAnimationFrame(redraw);
  };
})();
