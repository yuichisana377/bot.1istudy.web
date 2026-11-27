/*@ver*/(window.__jsVer=window.__jsVer||{})["Cardmaker-handwriting.js"]="f757dee963";/*@end*/// ============================================================
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
  let canvas = null, ctx = null, scroller = null, bar = null;
  const WIDTH_FACTOR = 3;   // 書く場所の横幅＝表示幅の何倍か
  let strokes = [];          // [{xs:[], ys:[], ts:[]}]
  let cur = null;            // 書いている最中のストローク
  let t0 = 0;
  let timer = null;
  let waiting = false;       // 書き終えて認識の開始待ち（タイマー中）
  let inflight = null;       // 認識リクエスト中のPromise
  let seq = 0;               // 古い認識結果で新しい結果を上書きしないための連番

  function el(id) { return document.getElementById(id); }

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  // 書く場所の横幅を表示幅の約3倍にし、下のスライダーの範囲を合わせる
  function layoutWidth() {
    const vw = scroller.clientWidth;
    if (vw > 0) canvas.style.width = Math.round(vw * WIDTH_FACTOR) + 'px';
    syncBar();
  }
  function syncBar() {
    if (!bar) return;
    bar.max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    bar.value = scroller.scrollLeft;
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
    layoutWidth();
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
    cancelTimer();
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
    const lastX = cur.xs[cur.xs.length - 1];
    strokes.push(cur); cur = null;
    redraw();
    // 表示の右端近くまで書き進めたら、続きが書けるよう少し右へスクロールする
    const vis = lastX - scroller.scrollLeft;
    if (vis > scroller.clientWidth * 0.7) {
      scroller.scrollTo({ left: Math.min(lastX - scroller.clientWidth * 0.35, scroller.scrollWidth), behavior: 'smooth' });
    }
    scheduleRecognize();
  }

  function cancelTimer() { clearTimeout(timer); waiting = false; }
  function startRecognize() { inflight = recognize().finally(() => { inflight = null; }); return inflight; }

  function scheduleRecognize() {
    cancelTimer();
    if (!strokes.length) return;
    waiting = true;
    timer = setTimeout(() => { waiting = false; startRecognize(); }, RECOGNIZE_DELAY_MS);
  }

  function setStatus(text) { const s = el('hw-status'); if (s) s.textContent = text; }

  async function recognize() {
    if (!strokes.length) return;
    const my = ++seq;
    const r = canvas.getBoundingClientRect();
    // 書いた範囲に合わせて左の空白を詰め、その幅を送る（空白の多い横長のままだと認識しにくいため）
    let minX = Infinity, maxX = 0;
    strokes.forEach(s => s.xs.forEach(x => { if (x < minX) minX = x; if (x > maxX) maxX = x; }));
    const offX = Math.max(0, Math.round(minX) - 10);
    const sendW = Math.max(60, Math.min(4000, Math.round(maxX) - offX + 30));
    setStatus('認識中…');
    try {
      const res = await fetch('/handwriting', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          width: sendW, height: Math.round(r.height),
          ink: strokes.map(s => [s.xs.map(x => Math.round(x) - offX), s.ys.map(Math.round), s.ts]),
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
    cancelTimer(); seq++;
    strokes = []; cur = null;
    if (scroller) scroller.scrollLeft = 0;
    if (canvas) redraw();
    setStatus('');
    const input = el('study-answer-input');
    if (input) input.value = '';
  };
  window.hwUndo = function () {
    if (!strokes.length) return;
    cancelTimer(); seq++;
    strokes.pop();
    redraw();
    if (strokes.length) scheduleRecognize();
    else { setStatus(''); el('study-answer-input').value = ''; }
  };
  // 認識待ち／認識中か。採点ボタンがスピナーを出して待つかの判定に使う
  window.hwPending = function () { return waiting || !!inflight; };
  // 認識が終わるまで待つ（待機中なら待たずにすぐ認識を始める）
  window.hwFlush = async function () {
    if (waiting) { cancelTimer(); await startRecognize(); }
    else if (inflight) { try { await inflight; } catch (_) {} }
  };
  // 採点が済んだら手書きパッドを隠す（次のカードでhwSetupが再び出す）。入力欄の値は残る。
  window.hwHide = function () {
    cancelTimer(); seq++;
    const wrap = el('study-handwriting-wrap');
    if (wrap) wrap.style.display = 'none';
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
      scroller = el('hw-scroll');
      bar = el('hw-scrollbar');
      ctx = canvas.getContext('2d');
      bar.addEventListener('input', () => { scroller.scrollLeft = Number(bar.value); });
      scroller.addEventListener('scroll', syncBar);
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
