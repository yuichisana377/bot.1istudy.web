// ============================================================
//  Icons.js — 絵文字の代わりに使う自作アイコン（OS/フォントに依存しない
//  純粋なSVG）
//  ─────────────────────────────
//  2026/08/19、ユーザーの要望「見た目は基本的にOSのUIに頼らないように」
//  を絵文字にも広げる形で追加。全ページ共通の「ライン」方向性（線だけ・
//  currentColorで文脈の色をそのまま継承）と、CardMakerだけの「塗りつぶし
//  多め・色付き」方向性の2系統を持つ。
//
//  使い方：
//    Icons.html('trash')                    → <svg>…</svg> のHTML文字列
//    Icons.html('trash', {size:20})          → サイズ指定
//    Icons.html('trash', {color:'#991b1b'})  → 色を明示指定（省略時はcurrentColor）
//    Icons.cmHtml('folder')                  → CardMaker用の色付きアイコン
//    Icons.cmBadgeHtml('folder', {size:40})  → 色付き角丸チップに乗せた形
//
//  ★ 表示内容は全てこのファイル内の固定データ（開発者が書いたSVGのみ）で、
//    利用者の入力を一切含まないため、innerHTML/insertAdjacentHTMLで挿入
//    しても保存型XSSのリスクは無い（Notice.js等の「ユーザー入力は必ず
//    textContentで」という方針とは別の話）。
// ============================================================

const Icons = (function () {
  // ── 共通（ライン、currentColor）────────────────────
  const LINE = {
    // ナビゲーション
    logo:      '<path d="M12 6.2c-2-1.3-4.6-2-7.2-2v13c2.6 0 5.2.7 7.2 2 2-1.3 4.6-2 7.2-2v-13c-2.6 0-5.2.7-7.2 2Z"/><path d="M12 6.2v13"/>',
    plan:      '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M8.4 14.6l2 2 4.2-4.6"/>',
    timetable: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17"/><path d="M9.5 9.5v10"/><path d="M15 9.5v10"/>',
    cardmaker: '<rect x="3.5" y="8.5" width="13" height="9" rx="1.6"/><rect x="7.5" y="4.8" width="13" height="9" rx="1.6"/>',
    studylog:  '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M4 20h16"/>',
    notice:    '<path d="M3 10.2v3.6h3.2l6.8 3.7V6.5l-6.8 3.7Z"/><path d="M15.5 9a3.8 3.8 0 0 1 0 6"/><path d="M18 6.7a7.3 7.3 0 0 1 0 10.6"/>',
    tools:     '<path d="M14.8 6.4a4 4 0 0 0-5.5 5.5L4 17.2 6.8 20l5.3-5.3a4 4 0 0 0 5.5-5.5l-2.7 2.7-2-2 2.7-2.7Z"/>',
    menu:      '<path d="M4 6.5h16"/><path d="M4 12h16"/><path d="M4 17.5h16"/>',
    home:      '<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',

    // 操作
    trash:     '<path d="M4 7h16"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><path d="M6.5 7 7.3 19a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7"/><path d="M10.3 11v6"/><path d="M13.7 11v6"/>',
    mailSent:  '<rect x="3.5" y="6" width="17" height="13" rx="2.2"/><path d="M4.2 7.2 12 13l7.8-5.8"/>',
    edit:      '<path d="M4 20h4L18.5 9.5a2 2 0 0 0-4-4L4 16v4Z"/><path d="M14 6l4 4"/>',
    memo:      '<path d="M6 4h9l3 3v13H6Z"/><path d="M15 4v3h3"/><path d="M9 13h6"/><path d="M9 17h6"/><path d="M9 9h3"/>',
    save:      '<path d="M5 4h11l3 3v13H5Z"/><path d="M8 4v6h8V4"/><path d="M8 14h8v6H8Z"/>',
    refresh:   '<path d="M4 12a8 8 0 0 1 13.6-5.7L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.6 5.7L4 15.5"/><path d="M4 20v-4.5h4.5"/>',
    search:    '<circle cx="10.3" cy="10.3" r="6.3"/><path d="M20 20l-5-5"/>',
    link:      '<path d="M9.5 14.5 14.5 9.5"/><path d="M11 6.5l1.8-1.8a3.5 3.5 0 0 1 5 5L16 11.5"/><path d="M13 17.5l-1.8 1.8a3.5 3.5 0 0 1-5-5L8 12.5"/>',
    list:      '<rect x="6" y="4.5" width="12" height="16" rx="2"/><rect x="9" y="3" width="6" height="3" rx="1"/><path d="M9 11h6"/><path d="M9 15h6"/>',

    // 状態・フィードバック
    checkCircle: '<circle cx="12" cy="12" r="8.3"/><path d="M8.2 12.3l2.4 2.4 5.2-5.6"/>',
    check:       '<path d="M5 12.5l4.5 4.5L19 7"/>',
    close:       '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
    warning:     '<path d="M12 4 3 20h18Z"/><path d="M12 10v4.3"/><path d="M12 17.3h.01"/>',
    forbidden:   '<circle cx="12" cy="12" r="8.3"/><path d="M6.6 6.6l10.8 10.8"/>',
    wrong:       '<circle cx="12" cy="12" r="8.3"/><path d="M8.8 8.8l6.4 6.4"/><path d="M15.2 8.8l-6.4 6.4"/>',
    celebrate:   '<path d="M12 3v3.4"/><path d="M12 17.6V21"/><path d="M3 12h3.4"/><path d="M17.6 12H21"/><path d="M5.8 5.8l2.4 2.4"/><path d="M15.8 15.8l2.4 2.4"/><path d="M18.2 5.8l-2.4 2.4"/><path d="M8.2 15.8l-2.4 2.4"/>',
    hint:        '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3.2a5.8 5.8 0 0 0-3.4 10.5c.6.5 1 1.2 1 2h4.8c0-.8.4-1.5 1-2A5.8 5.8 0 0 0 12 3.2Z"/>',
    lock:        '<rect x="5" y="10.3" width="14" height="10.2" rx="2"/><path d="M8 10.3V7a4 4 0 0 1 8 0v3.3"/>',
    bolt:        '<path d="M13 3 4 14h6l-1 7 9-11h-6Z"/>',
    medal:       '<path d="M9 9.6 6.3 3.2h3.1L12 8.4"/><path d="M15 9.6 17.7 3.2h-3.1L12 8.4"/><circle cx="12" cy="15" r="5.8"/><path d="M12 12v6"/>',
    trophy:      '<path d="M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 6H4.7A2.3 2.3 0 0 0 7 8.5"/><path d="M17 6h2.3A2.3 2.3 0 0 1 17 8.5"/><path d="M12 14v3"/><path d="M9 17.5h6l.6 3H8.4Z"/>',
    star:        '<path d="M12 3.5l2.5 5.3 5.8.8-4.2 4.1 1 5.8-5.1-2.7-5.1 2.7 1-5.8-4.2-4.1 5.8-.8Z"/>',

    // モノ
    logFolder: '<path d="M4 6.7h6l2 2h8v10.6H4Z"/><path d="M8 14h8"/><path d="M8 16.5h5"/>',
    file:      '<path d="M7 3.5h7l4 4v13H7Z"/><path d="M14 3.5v4h4"/>',
    calendar:  '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/>',
    paperclip: '<path d="M16.3 6.7 8.9 14.1a3 3 0 0 0 4.2 4.2l7.6-7.6a5 5 0 0 0-7-7l-7.6 7.6a1.8 1.8 0 0 0 2.5 2.5l6.7-6.7"/>',
    globe:     '<circle cx="12" cy="12" r="8.3"/><path d="M3.7 12h16.6"/><path d="M12 3.7a12.7 12.7 0 0 1 0 16.6"/><path d="M12 3.7a12.7 12.7 0 0 0 0 16.6"/>',
    bot:       '<rect x="4.5" y="8" width="15" height="11" rx="2.5"/><path d="M12 8V4.7"/><circle cx="12" cy="3.6" r="1"/><circle cx="9" cy="13" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="13" r="1.1" fill="currentColor" stroke="none"/><path d="M9 17h6"/>',
    school:    '<path d="M12 3 3 8l9 5 9-5Z"/><path d="M7 10.3V16c0 1.5 2.2 2.6 5 2.6s5-1.1 5-2.6v-5.7"/><path d="M21 8v6.3"/>',

    // アカウント・人
    person:  '<circle cx="12" cy="8.3" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
    people:  '<circle cx="9" cy="8.3" r="3"/><path d="M3.4 19c0-3.3 2.5-6 5.6-6s5.6 2.7 5.6 6"/><circle cx="16.6" cy="9.3" r="2.3"/><path d="M15.3 13.1c2.5.3 4.5 2.6 4.7 5.6"/>',
    wave:    '<path d="M8 12V6.2a2 2 0 1 1 4 0V11"/><path d="M12 11V5a2 2 0 1 1 4 0v6"/><path d="M16 11.4V7a2 2 0 1 1 4 0v7c0 3.5-2.5 6-6 6h-2c-2 0-3-.7-4-2l-3-4.5a1.7 1.7 0 0 1 2.6-2.1L9 12.4"/>',
    key:     '<circle cx="7.3" cy="14.5" r="3.5"/><path d="M9.9 12l7.9-7.9"/><path d="M15 6.7l2.4 2.4"/><path d="M18 3.7l2 2"/>',
    logout:  '<path d="M13 4H6.5a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6.5 20H13"/><path d="M10.5 12H20"/><path d="M16.5 8.5 20 12l-3.5 3.5"/>',
    // 設定＝歯車。放射状の線だけだと太陽に見えるため、外周リング＋短い
    // 太めの歯（stroke-linecap:butt）で「歯車」と分かる形にしてある。
    settings: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>'
      + '<path d="M12 3v2.3" stroke-width="2.4" stroke-linecap="butt"/>'
      + '<path d="M12 18.7v2.3" stroke-width="2.4" stroke-linecap="butt"/>'
      + '<path d="M3 12h2.3" stroke-width="2.4" stroke-linecap="butt"/>'
      + '<path d="M18.7 12h2.3" stroke-width="2.4" stroke-linecap="butt"/>'
      + '<path d="M17.8 6.2l-1.6 1.6" stroke-width="2.4" stroke-linecap="butt"/>'
      + '<path d="M17.8 17.8l-1.6-1.6" stroke-width="2.4" stroke-linecap="butt"/>'
      + '<path d="M6.2 17.8l1.6-1.6" stroke-width="2.4" stroke-linecap="butt"/>'
      + '<path d="M6.2 6.2l1.6 1.6" stroke-width="2.4" stroke-linecap="butt"/>',
    avatar:  '<circle cx="12" cy="9" r="4"/><path d="M4.5 20.5c0-4.1 3.4-7.5 7.5-7.5s7.5 3.4 7.5 7.5"/>',
    // 汎用の塗りつぶし丸。CardMakerの公開状態バッジ（🔴🟠🟡🔵）のように、
    // 色そのものはCSS側（.pub-badge.*のcolor）が既に持っている場合に、
    // currentColorで自動的にその色を継承させるためのアイコン。
    dot: '<circle cx="12" cy="12" r="7.2" fill="currentColor" stroke="none"/>',
  };

  // ── CardMaker専用（塗りつぶし多め・色付き）────────────
  // color: アイコン本体の色 / bg: 乗せる角丸チップの背景色
  const CM = {
    search: { color: '#2563eb', bg: '#eff6ff', svg:
      '<circle cx="10.3" cy="10.3" r="6.3" fill="currentColor" fill-opacity=".16" stroke-width="2"/><path d="M20 20l-5-5" stroke-width="2.4" stroke-linecap="round"/>' },
    bookmark: { color: '#7c3aed', bg: '#f3ebfe', svg:
      '<path d="M6 3.2h12v18l-6-4.4-6 4.4Z" fill="currentColor" stroke="none"/>' },
    shuffle: { color: '#7c3aed', bg: '#f3ebfe', svg:
      '<path d="M4 6.5h3.3l9 11H18" stroke-width="2.4" stroke-linecap="round"/><path d="M4 17.5h3.3l2.2-2.9" stroke-width="2.4" stroke-linecap="round"/><path d="M14.7 6.5H18" stroke-width="2.4" stroke-linecap="round"/><path d="M16.2 3.1l4.6 3.4-4.6 3.4Z" fill="currentColor" stroke="none"/><path d="M16.2 14.1l4.6 3.4-4.6 3.4Z" fill="currentColor" stroke="none"/>' },
    choice: { color: '#db2777', bg: '#fce7f3', svg:
      '<circle cx="12" cy="12" r="8" fill="currentColor" fill-opacity=".16" stroke-width="2"/><circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/>' },
    folder: { color: '#f5a623', bg: '#fff6e0', svg:
      '<path d="M4 6.7h6l2 2h8v10.6H4Z" fill="currentColor" stroke="none"/>' },
    emptyList: { color: '#64748b', bg: '#f1f5f9', svg:
      '<path d="M4 12v7h16v-7l-4-8H8Z" fill="currentColor" fill-opacity=".16" stroke="none"/><path d="M4 12 8 4h8l4 8" stroke-width="2"/><path d="M4 12h5.3l1 2h3.4l1-2H20" stroke-width="2"/><path d="M4 12v7h16v-7" stroke-width="2"/>' },
    image: { color: '#0d9488', bg: '#e6fbf8', svg:
      '<rect x="4" y="5" width="16" height="14" rx="2.5" fill="currentColor" fill-opacity=".16" stroke-width="1.8"/><circle cx="9" cy="10" r="1.7" fill="currentColor" stroke="none"/><path d="M5 17l5-5 4 4 3-3 3 3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' },
    home: { color: '#2563eb', bg: '#eff6ff', svg:
      '<path d="M4 11 12 4l8 7Z" fill="currentColor" stroke="none"/><rect x="6" y="11" width="12" height="8" rx="1.5" fill="currentColor" fill-opacity=".16" stroke-width="1.8"/>' },
    quiz: { color: '#c2410c', bg: '#fff7ed', svg:
      '<rect x="3" y="8" width="18" height="9" rx="4.5" fill="currentColor" fill-opacity=".16" stroke-width="1.8"/><path d="M7.4 11v4" stroke-width="1.9" stroke-linecap="round"/><path d="M5.4 13h4" stroke-width="1.9" stroke-linecap="round"/><circle cx="15" cy="11.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="17.5" cy="14" r="1.2" fill="currentColor" stroke="none"/>' },
    tally: { color: '#16a34a', bg: '#eefdf3', svg:
      '<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" fill-opacity=".16" stroke-width="1.8"/><path d="M4 9.3h16" stroke-width="1.6"/><path d="M4 14.3h16" stroke-width="1.6"/><circle cx="8" cy="9.3" r="1.2" fill="currentColor" stroke="none"/><circle cx="13" cy="9.3" r="1.2" fill="currentColor" stroke="none"/><circle cx="10" cy="14.3" r="1.2" fill="currentColor" stroke="none"/><circle cx="16" cy="14.3" r="1.2" fill="currentColor" stroke="none"/>' },
    statusDot: { color: '#22c55e', bg: '#eafcf1', svg:
      '<circle cx="12" cy="12" r="7.2" fill="currentColor" stroke="none"/>' },
    // ★ 追加（一覧の11種の確定後、実装中に見つかった他のCardMaker固有アイコン。
    //   同じ「本体を薄く塗り＋輪郭を太めの線／完全な塗り」の作風で追加）
    write: { color: '#4f46e5', bg: '#eef0fe', svg: // ✍️ ようこそ画面
      '<path d="M4 20h4L18.5 9.5a2 2 0 0 0-4-4L4 16v4Z" fill="currentColor" fill-opacity=".16" stroke-width="1.8"/><path d="M14 6l4 4" stroke-width="1.8"/>' },
    study: { color: '#0d9488', bg: '#e6fbf8', svg: // 📚 プレイモード「暗記カード」
      '<path d="M12 6.2c-2-1.3-4.6-2-7.2-2v13c2.6 0 5.2.7 7.2 2 2-1.3 4.6-2 7.2-2v-13c-2.6 0-5.2.7-7.2 2Z" fill="currentColor" fill-opacity=".16" stroke-width="1.8"/><path d="M12 6.2v13" stroke-width="1.8"/>' },
    listview: { color: '#2563eb', bg: '#eff6ff', svg: // 📋 プレイモード「一覧」
      '<rect x="6" y="4.5" width="12" height="16" rx="2" fill="currentColor" fill-opacity=".16" stroke-width="1.8"/><rect x="9" y="3" width="6" height="3" rx="1" fill="currentColor" stroke="none"/><path d="M9 11h6" stroke-width="1.6"/><path d="M9 15h6" stroke-width="1.6"/>' },
    globe: { color: '#0891b2', bg: '#e6f9fc', svg: // 🌐 公開予定のデッキにする
      '<circle cx="12" cy="12" r="8.3" fill="currentColor" fill-opacity=".16" stroke-width="1.8"/><path d="M3.7 12h16.6" stroke-width="1.6"/><path d="M12 3.7a12.7 12.7 0 0 1 0 16.6" stroke-width="1.6"/><path d="M12 3.7a12.7 12.7 0 0 0 0 16.6" stroke-width="1.6"/>' },
    unpublish: { color: '#dc2626', bg: '#fef2f2', svg: // 🔴 非公開に戻す
      '<circle cx="12" cy="12" r="7.2" fill="currentColor" stroke="none"/>' },
  };

  function html(name, opts) {
    const inner = LINE[name];
    if (!inner) { console.warn('[Icons] unknown line icon:', name); return ''; }
    const o = opts || {};
    const size = o.size || 20;
    const color = o.color || 'currentColor';
    const cls = o.class ? ` class="${o.class}"` : '';
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${o.strokeWidth || 1.8}" stroke-linecap="round" stroke-linejoin="round"${cls}>${inner}</svg>`;
  }

  function cmHtml(name, opts) {
    const def = CM[name];
    if (!def) { console.warn('[Icons] unknown CardMaker icon:', name); return ''; }
    const o = opts || {};
    const size = o.size || 20;
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${def.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" color="${def.color}">${def.svg}</svg>`;
  }

  // CardMakerの色付きアイコンを、角丸の色付きチップに乗せた形で返す
  // （一覧のバッジ・メニューアイコン用）。
  function cmBadgeHtml(name, opts) {
    const def = CM[name];
    if (!def) { console.warn('[Icons] unknown CardMaker icon:', name); return ''; }
    const o = opts || {};
    const box = o.box || 32;
    const iconSize = o.size || Math.round(box * 0.62);
    const radius = o.radius != null ? o.radius : Math.round(box * 0.3);
    return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${box}px;height:${box}px;border-radius:${radius}px;background:${def.bg};flex-shrink:0;">`
      + `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="${def.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${def.svg}</svg>`
      + `</span>`;
  }

  return { html, cmHtml, cmBadgeHtml, LINE, CM };
})();
