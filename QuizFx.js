/*@ver*/(window.__jsVer=window.__jsVer||{})["QuizFx.js"]="2c3b5e50cb";/*@end*/// みんなでクイズの演出（紙吹雪・効果音・連続正解・加点表示・カウントアップ）。2026/11/28 追加
// 見た目だけを担当し、サーバーやクイズの進行には一切関与しない（失敗しても本編は止まらない）。
// 動きを減らす設定（prefers-reduced-motion）の人には、紙吹雪・揺れ・浮かぶ文字を出さない。
(function () {
  'use strict';
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var MUTE_KEY = 'qz_fx_mute';
  var muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}

  // ---- 効果音（WebAudio。自動再生の制限があるため、最初のタップで有効化する） ----
  var ctx = null;
  function getCtx() {
    if (ctx) return ctx;
    try { var AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = new AC(); } catch (e) {}
    return ctx;
  }
  function unlock() {
    var c = getCtx();
    if (c && c.state !== 'running') { try { var pr = c.resume(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {} }
  }
  ['pointerdown', 'touchend', 'click'].forEach(function (ev) { document.addEventListener(ev, unlock, { passive: true }); });
  // ---- 音づくり：単純なピー音ではなく、倍音を重ねた「ベル／マリンバ風」の音と、軽い残響で作る ----
  var master = null, reverb = null;
  function chain() {
    var c = getCtx(); if (!c) return null;
    if (master) return master;
    master = c.createGain(); master.gain.value = 0.9;
    var comp = c.createDynamicsCompressor();
    master.connect(comp); comp.connect(c.destination);
    try { // 短い残響（ノイズを減衰させたインパルス応答）
      var len = Math.floor(c.sampleRate * 0.9), buf = c.createBuffer(2, len, c.sampleRate);
      for (var ch = 0; ch < 2; ch++) { var d = buf.getChannelData(ch); for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
      reverb = c.createConvolver(); reverb.buffer = buf;
      var wet = c.createGain(); wet.gain.value = 0.22;
      master.connect(reverb); reverb.connect(wet); wet.connect(comp);
    } catch (e) { reverb = null; }
    return master;
  }
  // 1音：partials=[倍音の倍率, 音量]の列。attack/decayの包絡線で「ポン」と鳴って自然に消える
  function note(freq, start, dur, partials, vol, opt) {
    var c = getCtx(), m = chain(); if (!c || !m || c.state !== 'running') return;
    opt = opt || {};
    var t0 = c.currentTime + start;
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (opt.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    var out = g;
    if (opt.lowpass) { var f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(opt.lowpass, t0); if (opt.lowpassTo) f.frequency.exponentialRampToValueAtTime(opt.lowpassTo, t0 + dur); g.connect(f); out = f; }
    out.connect(m);
    partials.forEach(function (p) {
      var o = c.createOscillator(), pg = c.createGain();
      o.type = opt.type || 'sine';
      o.frequency.setValueAtTime(freq * p[0], t0);
      if (opt.glideTo) o.frequency.exponentialRampToValueAtTime(opt.glideTo * p[0], t0 + dur);
      pg.gain.value = p[1];
      o.connect(pg); pg.connect(g); o.start(t0); o.stop(t0 + dur + 0.05);
    });
  }
  var BELL = [[1, 1], [2.76, 0.35], [5.4, 0.14], [8.9, 0.06]];   // 鐘の非整数倍音
  var MARIMBA = [[1, 1], [4, 0.28], [10, 0.07]];                 // 木琴・マリンバ風
  var SOFT = [[1, 1], [2, 0.3], [3, 0.12]];
  var SFX = {
    // 正解：明るい2音の「ピンポン」（鐘）
    correct: function () { note(1046.5, 0, 0.7, BELL, 0.16); note(1568, 0.11, 0.9, BELL, 0.15); },
    // 不正解：やわらかく沈む「ぼよん」（音程が下がる）。耳に痛くならないようローパスで丸める
    wrong: function () { note(330, 0, 0.42, SOFT, 0.2, { type: 'triangle', glideTo: 196, lowpass: 1400 }); },
    // 連続正解：上がっていくマリンバのアルペジオ＋最後にきらめく鐘
    combo: function () { [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { note(f, i * 0.07, 0.35, MARIMBA, 0.16); }); note(2093, 0.3, 0.9, BELL, 0.12); },
    // 結果発表：ブラス風のファンファーレ（ローパスが開く）＋最後に和音の鐘
    win: function () {
      var seq = [[392, 0], [523.25, 0.14], [659.25, 0.28], [783.99, 0.46]];
      seq.forEach(function (s, i) { note(s[0], s[1], i === 3 ? 0.9 : 0.3, [[1, 1], [2, 0.5], [3, 0.3], [4, 0.15]], 0.11, { type: 'sawtooth', attack: 0.02, lowpass: 900, lowpassTo: 3200 }); });
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f) { note(f, 0.5, 1.4, BELL, 0.08); });
    },
    // ボーナス問題の予告：きらきらした上昇音
    bonus: function () { [783.99, 987.77, 1174.66, 1567.98, 1975.5].forEach(function (f, i) { note(f, i * 0.06, 0.6, BELL, 0.11); }); },
    tick: function () { note(1760, 0, 0.12, MARIMBA, 0.1); }
  };
  function sfx(name) { if (muted) return; try { SFX[name] && SFX[name](); } catch (e) {} }

  // ---- 紙吹雪 ----
  var COLORS = ['#f59e0b', '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#ec4899'];
  function confetti(n, originY) {
    if (reduced) return;
    var layer = document.createElement('div');
    layer.className = 'qzfx-confetti';
    for (var i = 0; i < (n || 36); i++) {
      var p = document.createElement('i');
      var ang = (Math.random() * 140 - 70) * Math.PI / 180; // 上向き中心に扇状
      var dist = 120 + Math.random() * 220;
      p.style.cssText = 'left:50%;top:' + (originY || 55) + '%;background:' + COLORS[i % COLORS.length] +
        ';--dx:' + Math.round(Math.sin(ang) * dist) + 'px;--dy:' + Math.round(-Math.cos(ang) * dist) +
        'px;--rot:' + Math.round(Math.random() * 720 - 360) + 'deg;animation-delay:' + Math.round(Math.random() * 120) + 'ms';
      layer.appendChild(p);
    }
    document.body.appendChild(layer);
    setTimeout(function () { layer.remove(); }, 2200);
  }

  // ---- 加点「+N」が浮かぶ ----
  function floatPoints(anchor, text) {
    if (reduced || !anchor) return;
    var r = anchor.getBoundingClientRect();
    var f = document.createElement('div');
    f.className = 'qzfx-float';
    f.textContent = text;
    f.style.left = (r.left + r.width / 2) + 'px';
    f.style.top = (r.top) + 'px';
    document.body.appendChild(f);
    setTimeout(function () { f.remove(); }, 1300);
  }

  // ---- 正解発表ごとの1回きりの演出と、連続正解の数え上げ ----
  var seen = {};          // key -> { streak }
  var lastRoom = null;
  var streak = 0;
  // 同じ問題の発表を何度描画しても、演出は最初の1回だけ（streakは毎回同じ値を返す）
  function onReveal(o) {
    var roomPart = String(o.key).split(':')[0];
    if (roomPart !== lastRoom) { lastRoom = roomPart; seen = {}; streak = 0; }
    var rec = seen[o.key];
    if (rec) return { first: false, streak: rec.streak };
    streak = o.correct ? streak + 1 : 0;
    seen[o.key] = { streak: streak };
    try {
      if (o.correct) {
        if (streak >= 3) sfx('combo'); else sfx('correct');
        confetti(streak >= 3 ? 52 : 28, 60);
        floatPoints(o.anchor, '+' + o.points);
      } else {
        sfx('wrong');
        if (!reduced && o.wrongBtn) { o.wrongBtn.classList.add('qz-shake'); }
      }
    } catch (e) {}
    return { first: true, streak: streak };
  }

  // ---- 数字のカウントアップ（data-n に最終値、data-unit に単位） ----
  function countUp(container) {
    var els = container.querySelectorAll('[data-n]');
    els.forEach(function (el) {
      var raw = el.getAttribute('data-n'), to = Number(raw), unit = el.getAttribute('data-unit') || '';
      if (reduced || !isFinite(to) || to <= 0) { el.textContent = raw + unit; return; }
      var dec = (String(raw).split('.')[1] || '').length;
      var col = el.closest ? el.closest('.qz-podium-col') : null;
      var delay = !col ? 0 : col.classList.contains('qz-podium-1') ? 1700 : col.classList.contains('qz-podium-2') ? 1100 : 500;
      el.textContent = (0).toFixed(dec) + unit;
      var t0 = performance.now() + delay, dur = 900;
      (function step(now) {
        if (now < t0) { requestAnimationFrame(step); return; }
        var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = (k >= 1 ? raw : (to * e).toFixed(dec)) + unit;
        if (k < 1) requestAnimationFrame(step);
      })(performance.now());
    });
  }

  // ---- 結果発表：表彰台がせり上がった後に紙吹雪と音 ----
  var resultDone = null, resultTimer = null;
  function cancelResult() { clearTimeout(resultTimer); resultDone = null; }
  function onResult(key) {
    if (resultDone === key) return;
    resultDone = key;
    resultTimer = setTimeout(function () { sfx('win'); confetti(70, 40); }, reduced ? 0 : 1700);
  }

  // ---- ミュートボタン ----
  function mountMute() {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'qzfx-mute'; b.setAttribute('aria-label', '効果音の切り替え');
    b.innerHTML = muteSvg();
    b.addEventListener('click', function () {
      muted = !muted;
      try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
      b.innerHTML = muteSvg(); unlock(); if (!muted) sfx('tick');
    });
    document.body.appendChild(b);
  }
  function muteSvg() {
    var wave = muted ? '<path d="M16 9l5 6M21 9l-5 6"/>' : '<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>';
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/>' + wave + '</svg>';
  }
  if (document.body) mountMute(); else document.addEventListener('DOMContentLoaded', mountMute);

  window.QzFx = { onReveal: onReveal, countUp: countUp, onResult: onResult, cancelResult: cancelResult, confetti: confetti, sfx: sfx };
})();
