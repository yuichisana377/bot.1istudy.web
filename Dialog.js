// ============================================================
//  Dialog.js — 端末/ブラウザ標準の confirm()/alert()/prompt() を使わない
//  共通ダイアログUI
//  ─────────────────────────────
//  Style.css の既存クラス（.modal-bg / .modal / .modal-handle / .field /
//  .btn-primary / .btn-danger / .detail-actions）をそのまま流用して動的に
//  モーダルを生成するので、新規CSSを追加せずに他のモーダルと同じ見た目・
//  端末非依存の外観になる（Cardmaker.jsのshowCmConfirm/showCmAlertと
//  同じ考え方。Cardmaker.htmlだけは専用のCardmaker.cssを使っているため、
//  そちらは今回もCardmaker.js側の実装のまま。それ以外の全ページ共通）。
//
//  読み込み方法：index.html/Timetable.html/StudyLog.html/ServiceInfo.html/
//  Quiz.html/Notice.htmlの<script>末尾に読み込みタグを追加して使う。
//  ★ 他ページのJSと同じグローバル名（API_BASE等）と衝突しないよう、
//    関数名は showAppConfirm/showAppAlert/showAppPrompt という専用の
//    プレフィックス付きにしてある。
//  ★ 表示内容にはユーザー入力を含む場合があるため、innerHTMLではなく
//    必ずcreateElement/textContentで組み立てる（保存型XSS対策、
//    CLAUDE.md参照）。
// ============================================================

// icon: 省略可。Icons.html()の戻り値（絵文字の代わりに見出しの先頭に添える
// 固定アイコン）。title自体は常にtextNodeとして追加するので、呼び出し側が
// 万一ユーザー入力をtitleに渡しても安全なまま。
function _appDialogSkeleton(title, desc, icon) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-bg open';
  const box = document.createElement('div');
  box.className = 'modal';
  const handle = document.createElement('span');
  handle.className = 'modal-handle';
  box.appendChild(handle);
  const h3 = document.createElement('h3');
  h3.style.marginBottom = '.6rem';
  if (icon) h3.insertAdjacentHTML('beforeend', icon + ' ');
  h3.appendChild(document.createTextNode(title));
  box.appendChild(h3);
  if (desc) {
    const p = document.createElement('p');
    p.style.cssText = 'font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:1.1rem;white-space:pre-line';
    p.textContent = desc;
    box.appendChild(p);
  }
  overlay.appendChild(box);
  return { overlay, box };
}

// 選択肢が2つの確認ダイアログ（キャンセル + 実行）。confirm()の代替。
// danger: true で実行ボタンを .btn-danger（赤系アウトライン）にする。
function showAppConfirm({ title, desc = '', okLabel = 'OK', cancelLabel = 'キャンセル', danger = false, icon = '' }) {
  return new Promise(resolve => {
    const { overlay, box } = _appDialogSkeleton(title, desc, icon);

    const btnRow = document.createElement('div');
    btnRow.className = 'detail-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = cancelLabel;
    cancelBtn.style.cssText = 'flex:1;margin-top:0;padding:13px;border-radius:var(--r-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:15px;cursor:pointer';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.textContent = okLabel;
    okBtn.className = danger ? 'btn-danger' : 'btn-primary';

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);
    box.appendChild(btnRow);
    document.body.appendChild(overlay);

    function finish(value) {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 180);
      resolve(value);
    }
    cancelBtn.addEventListener('click', () => finish(false));
    okBtn.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', e => { if (e.target === overlay) finish(false); });
  });
}

// ボタン1つだけの通知ダイアログ。alert()の代替。
function showAppAlert({ title, desc = '', okLabel = '閉じる', icon = '' }) {
  return new Promise(resolve => {
    const { overlay, box } = _appDialogSkeleton(title, desc, icon);

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.textContent = okLabel;
    okBtn.className = 'btn-primary';
    box.appendChild(okBtn);
    document.body.appendChild(overlay);

    function finish() {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 180);
      resolve(true);
    }
    okBtn.addEventListener('click', finish);
    overlay.addEventListener('click', e => { if (e.target === overlay) finish(); });
  });
}

// 1行入力を求めるダイアログ。prompt()の代替。
// キャンセル時は null、OK時は入力文字列（空文字含む）を返す。
// inputType: 'text' | 'number'（number指定時はスマホでも数字キーボードが出る）
function showAppPrompt({ title, desc = '', label = '', value = '', okLabel = 'OK', cancelLabel = 'キャンセル', inputType = 'text', icon = '' }) {
  return new Promise(resolve => {
    const { overlay, box } = _appDialogSkeleton(title, desc, icon);

    const field = document.createElement('div');
    field.className = 'field';
    if (label) {
      const lab = document.createElement('label');
      lab.textContent = label;
      field.appendChild(lab);
    }
    const input = document.createElement('input');
    input.type = inputType;
    input.value = value;
    field.appendChild(input);
    box.appendChild(field);

    const btnRow = document.createElement('div');
    btnRow.className = 'detail-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = cancelLabel;
    cancelBtn.style.cssText = 'flex:1;margin-top:0;padding:13px;border-radius:var(--r-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:15px;cursor:pointer';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.textContent = okLabel;
    okBtn.className = 'btn-primary';

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);
    box.appendChild(btnRow);
    document.body.appendChild(overlay);

    function finish(value) {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 180);
      resolve(value);
    }
    cancelBtn.addEventListener('click', () => finish(null));
    okBtn.addEventListener('click', () => finish(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(input.value); });
    overlay.addEventListener('click', e => { if (e.target === overlay) finish(null); });
    setTimeout(() => input.focus(), 50);
  });
}
