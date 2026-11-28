/*@ver*/(window.__jsVer=window.__jsVer||{})["QuizFx.js"]="cc35f028bc";/*@end*/// みんなでクイズの演出（紙吹雪・効果音・連続正解・加点表示・カウントアップ）。2026/11/28 追加
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
  function tone(freq, start, dur, type, vol) {
    var c = getCtx(); if (!c || c.state !== 'running') return;
    var t0 = c.currentTime + start;
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  var SFX = {
    correct: function () { tone(660, 0, 0.14, 'triangle'); tone(880, 0.1, 0.22, 'triangle'); },
    wrong: function () { tone(220, 0, 0.18, 'sawtooth', 0.08); tone(160, 0.14, 0.28, 'sawtooth', 0.08); },
    combo: function () { tone(784, 0, 0.1, 'triangle'); tone(988, 0.08, 0.1, 'triangle'); tone(1319, 0.16, 0.26, 'triangle'); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.12, 0.3, 'triangle', 0.13); }); },
    tick: function () { tone(1200, 0, 0.05, 'square', 0.05); }
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
