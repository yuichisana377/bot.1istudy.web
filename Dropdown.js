// ============================================================
//  Dropdown.js — <select> を端末/ブラウザのネイティブ描画から切り離し、
//  開いたとき（選択肢一覧）も含めて完全にサイトのデザインで統一する
//  ─────────────────────────────
//  方針（段階的強化＝プログレッシブエンハンスメント）：
//  ・元の<select>はDOM上に残したまま「見えなく」するだけで、実際の値の
//    保持・フォーム送信・既存コードからの読み書き（.value / .innerHTML
//    での選択肢入れ替え / addEventListener('change', ...) や
//    onchange="..." 属性）はすべて元の<select>がそのまま担当し続ける。
//    このJSはその上に「見た目だけの」ボタン＋パネルを重ねて操作を仲介する。
//  ・そのため、他ページのJS側（Plan.js/Timetable.js/StudyLog.js/Quiz.js/
//    Cardmaker.js）は一切変更不要（sel.value=...やsel.innerHTML=...を
//    今まで通り書けば、自動的に見た目にも反映される）。
//  ・このJSが読み込まれない/失敗しても、<select>はCSSで隠されていない
//    （非表示にする処理はすべてJS側でinline styleとして付与する）ため、
//    普通のネイティブ<select>として問題なく動作し続ける
//    （＝壊れるのではなく、見た目の統一が効かないだけに留まる）。
//  ・見た目は Style.css に追加した .app-dd 系クラスを使う（全ページ共通）。
//    Cardmaker.htmlのみ独自のCardmaker.cssも読み込んでいるが、Style.css
//    自体はCardmaker.htmlでも読み込まれているためこのクラスは問題なく使える。
//  ・multiple属性つきの<select>やoptgroupを含む<select>は現状サイト内に
//    無いため未対応（あれば自動的にスキップし、ネイティブのまま残す）。
// ============================================================

function enhanceSelect(selectEl) {
  if (!selectEl || selectEl.tagName !== 'SELECT') return;
  if (selectEl.dataset.ddEnhanced) return;
  if (selectEl.multiple) return; // 複数選択は対象外（現状サイト内に無い）
  selectEl.dataset.ddEnhanced = '1';

  const wrap = document.createElement('div');
  wrap.className = 'app-dd';
  // ★ 元のselectに直接指定されていたレイアウト系のインラインstyle
  //   （margin/max-width等）だけをラッパーに引き継ぐ。border/padding/
  //   background等の見た目系はapp-dd-btn側の共通スタイルに統一するため
  //   引き継がない。
  ['marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'maxWidth'].forEach(k => {
    if (selectEl.style[k]) wrap.style[k] = selectEl.style[k];
  });
  if (selectEl.style.width && selectEl.style.width !== '100%') wrap.style.width = selectEl.style.width;

  selectEl.parentNode.insertBefore(wrap, selectEl);
  wrap.appendChild(selectEl);

  // 元のselectは「機能はそのまま・見た目だけ消す」。position:absoluteで
  // レイアウトからは外し、opacity:0 + pointer-events:noneで見た目・操作の
  // 対象からも外す。tabIndex=-1でTabキーの順番からも除外し、代わりに
  // 下のボタンがフォーカスを受け持つ。
  selectEl.style.position = 'absolute';
  selectEl.style.inset = '0';
  selectEl.style.width = '100%';
  selectEl.style.height = '100%';
  selectEl.style.opacity = '0';
  selectEl.style.pointerEvents = 'none';
  selectEl.tabIndex = -1;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'app-dd-btn';
  const labelSpan = document.createElement('span');
  labelSpan.className = 'app-dd-label';
  const arrowSpan = document.createElement('span');
  arrowSpan.className = 'app-dd-arrow';
  btn.appendChild(labelSpan);
  btn.appendChild(arrowSpan);
  wrap.appendChild(btn);

  const panel = document.createElement('div');
  panel.className = 'app-dd-panel';
  wrap.appendChild(panel);

  let highlighted = -1;

  function syncButton() {
    const opt = selectEl.options[selectEl.selectedIndex];
    const text = opt ? opt.textContent : '';
    labelSpan.textContent = text;
    btn.classList.toggle('app-dd-placeholder', !text);
    btn.disabled = selectEl.disabled;
  }

  function buildPanel() {
    panel.textContent = '';
    highlighted = selectEl.selectedIndex;
    Array.from(selectEl.options).forEach((opt, i) => {
      const row = document.createElement('div');
      row.className = 'app-dd-opt'
        + (opt.selected ? ' is-selected' : '')
        + (opt.disabled ? ' is-disabled' : '')
        + (i === highlighted ? ' is-highlighted' : '');
      row.dataset.idx = String(i);
      const check = document.createElement('span');
      check.className = 'app-dd-check';
      check.innerHTML = opt.selected ? Icons.html('check', {size:12}) : '';
      const label = document.createElement('span');
      label.textContent = opt.textContent;
      row.appendChild(check);
      row.appendChild(label);
      if (!opt.disabled) {
        // ★ preventDefault必須：この<select>が<label>の中に置かれている場合
        //   （例：Quiz.htmlの「出題数」）、ブラウザは「labelの中がクリックされたら
        //   中の<select>にもクリックを転送してネイティブの選択UIを開く」という
        //   標準動作を持っている。これはselect側のpointer-events:noneでは防げず
        //   （labelの転送はCSSの当たり判定を経由しない別経路のため）、この行の
        //   クリックイベントでpreventDefault()しない限り、選択直後に一瞬
        //   OS標準の選択肢一覧が開いてしまう不具合になっていた。
        row.addEventListener('click', (e) => { e.preventDefault(); selectOption(i); });
      }
      panel.appendChild(row);
    });
  }

  function selectOption(i) {
    const opt = selectEl.options[i];
    if (!opt || opt.disabled) return;
    if (selectEl.selectedIndex !== i) {
      selectEl.selectedIndex = i;
      selectEl.dispatchEvent(new Event('input', { bubbles: true }));
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
    closePanel();
  }

  function setHighlighted(i) {
    const rows = panel.querySelectorAll('.app-dd-opt');
    rows.forEach(r => r.classList.remove('is-highlighted'));
    if (rows[i]) {
      rows[i].classList.add('is-highlighted');
      rows[i].scrollIntoView({ block: 'nearest' });
    }
    highlighted = i;
  }

  function openPanel() {
    if (selectEl.disabled) return;
    document.querySelectorAll('.app-dd-panel.open').forEach(p => {
      if (p !== panel) { p.classList.remove('open'); p.closest('.app-dd').querySelector('.app-dd-btn').classList.remove('open'); }
    });
    buildPanel();
    panel.classList.add('open');
    btn.classList.add('open');
  }
  function closePanel() {
    panel.classList.remove('open');
    btn.classList.remove('open');
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault(); // ★ 上のrowクリックと同じ理由（labelの中にあるとネイティブUIも開いてしまうため）
    if (panel.classList.contains('open')) closePanel(); else openPanel();
  });
  btn.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Escape'].includes(e.key)) e.preventDefault();
    if (!panel.classList.contains('open')) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') openPanel();
      return;
    }
    const count = selectEl.options.length;
    if (e.key === 'ArrowDown') {
      let i = highlighted;
      do { i = (i + 1) % count; } while (selectEl.options[i].disabled && i !== highlighted);
      setHighlighted(i);
    } else if (e.key === 'ArrowUp') {
      let i = highlighted;
      do { i = (i - 1 + count) % count; } while (selectEl.options[i].disabled && i !== highlighted);
      setHighlighted(i);
    } else if (e.key === 'Enter' || e.key === ' ') {
      selectOption(highlighted);
    } else if (e.key === 'Escape') {
      closePanel();
    }
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) closePanel();
  });

  // ★ 他のページJSが sel.value=... で値を直接書き換えた場合も見た目に
  //   反映されるようにする（プロパティのgetter/setterを上書きして横取り）。
  //   .selectedIndex=... 経由の変更も一緒に拾えるよう、valueだけでなく
  //   selectedIndexも同様にラップする。
  ['value', 'selectedIndex'].forEach(prop => {
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
    if (!desc) return;
    Object.defineProperty(selectEl, prop, {
      get() { return desc.get.call(selectEl); },
      set(v) {
        desc.set.call(selectEl, v);
        syncButton();
        if (panel.classList.contains('open')) buildPanel();
      },
      configurable: true,
    });
  });

  // ★ 他のページJSが sel.innerHTML=... で選択肢を丸ごと入れ替えた場合
  //   （非同期で科目一覧を取得して差し替える処理等で多用されている）も
  //   検知して見た目に反映する。
  const mo = new MutationObserver(() => {
    syncButton();
    if (panel.classList.contains('open')) buildPanel();
  });
  mo.observe(selectEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['selected', 'disabled', 'value'] });

  // disabled属性そのものの変更も見た目に反映する（select本体を監視対象に
  // 含めているので上のMutationObserverでも拾えるが、プロパティ経由
  // （sel.disabled=true）の変更はDOM属性を伴わないことがあるため、
  // 念のためdisabledもラップしておく）。
  const disabledDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'disabled');
  if (disabledDesc) {
    Object.defineProperty(selectEl, 'disabled', {
      get() { return disabledDesc.get.call(selectEl); },
      set(v) { disabledDesc.set.call(selectEl, v); syncButton(); },
      configurable: true,
    });
  }

  syncButton();
}

function enhanceAllSelects(root) {
  (root || document).querySelectorAll('select').forEach(sel => {
    try { enhanceSelect(sel); } catch (e) { console.error('[Dropdown.js] enhance failed', sel, e); }
  });
}

// ★ ページ読み込み時点で既にDOMにある<select>を強化する。
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => enhanceAllSelects());
} else {
  enhanceAllSelects();
}

// ★ モーダルなどが後からHTMLをinnerHTMLで丸ごと差し替える形で<select>を
//   新規に追加するケースにも対応できるよう、body全体のDOM追加を監視して
//   新しく現れた<select>も自動的に強化する。
new MutationObserver((mutations) => {
  for (const m of mutations) {
    m.addedNodes.forEach(node => {
      if (node.nodeType !== 1) return;
      if (node.tagName === 'SELECT') { try { enhanceSelect(node); } catch (e) {} }
      else if (node.querySelectorAll) enhanceAllSelects(node);
    });
  }
}).observe(document.documentElement, { childList: true, subtree: true });
