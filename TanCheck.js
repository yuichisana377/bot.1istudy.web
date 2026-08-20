// ============================================================
//  TanCheck.js — 単位チェッカー（情報工学科・1年生のみ、2026年度）
//  ─────────────────────────────
//  ★ 現時点ではサーバー保存はせず、入力値はこの端末の localStorage
//    にのみ保存する（ログイン不要・他人と共有されない・サーバー側の
//    実装追加も不要というシンプルさを優先した設計）。
//  ★ 評価割合のデータは、高専機構の公開シラバス検索システム
//    （https://syllabus.kosen-k.go.jp/ 、school_id=23＝豊田高専、
//    department_id=13＝情報工学科、year=2026）に掲載されている
//    「評価割合」欄をそのまま転記したもの（前期・後期とも実際に
//    シラバスを確認済み。前期後期で内容が異なる科目もあった＝
//    例えば公共は前期「定期65/課題5/小テスト30」、後期「定期60/
//    課題20/小テスト20」で異なる）。
//    専門科目も「開設期」（前期/後期）をシラバスで確認し、それぞれの
//    学期の一覧に含めてある（コンピュータリテラシ・情報技術概論・
//    情報工学ゼミⅠ・情報基礎＝前期、プログラミングⅠ・数理工学演習Ⅰ＝後期）。
//    A/B/Cの点数基準は、シラバスには記載が無いため、ユーザー（1I勉強会）
//    から教えてもらった基準（85点以上=A／70点以上=B／60点以上=C／
//    60点未満=不可）を使用。
//    ★ シラバス自体の変更・担当教員による運用の違いは反映されない
//      ため、あくまで参考値。正式な成績は学校の発表を必ず確認すること。
//  ★ 「小テスト」「課題」は複数回あり合算されることが多いという
//    指摘を受け、これらの項目だけは単一の点数ではなく「得点/満点」を
//    何回分でも追加できる方式にした（達成率＝得点合計÷満点合計）。
//    満点を空欄のままにした場合は100点満点として扱う。
// ============================================================

const SESSION_KEY = 'sl_session';
const LOGIN_PATH = '/Login.html';
const TC_STORAGE_KEY = 'tancheck_scores_v2';

// ── A/B/C 判定基準（1I勉強会から確認済み） ──────────────
const GRADE_THRESHOLDS = [
  { grade: 'A', min: 85 },
  { grade: 'B', min: 70 },
  { grade: 'C', min: 60 },
];

// ── 「小テスト」「課題」系は複数回・合算方式にする ───────
function isMultiLabel(label) {
  return label.includes('課題') || label.includes('小テスト');
}

// ── 科目データ（情報工学科 1年・2026年度シラバスより、前期・後期とも確認済み） ──
// items: [評価項目名, 割合(%)] の配列。合計は必ず100になるようにしてある。
const SUBJECTS = {
  zenkiSpecialized: [
    { name: 'コンピュータリテラシ', code: '31111', items: [['課題', 100]] },
    { name: '情報技術概論',         code: '31112', items: [['中間試験', 30], ['定期試験', 50], ['課題', 20]] },
    { name: '情報工学ゼミⅠ',        code: '31113', items: [['課題', 100]] },
    { name: '情報基礎',             code: '31114', items: [['定期試験', 40], ['課題', 60]] },
  ],
  zenkiGeneral: [
    { name: '国語Ⅰ',                 code: '01121', items: [['中間試験', 30], ['定期試験', 45], ['課題', 15], ['小テスト', 10]] },
    { name: '地理',                   code: '01124', items: [['中間試験', 30], ['定期試験', 50], ['課題', 20]] },
    { name: '基礎解析Ⅰ',              code: '01125', items: [['定期試験', 40], ['課題', 20], ['小テスト', 40]] },
    { name: '線形数学Ⅰ',              code: '01126', items: [['中間試験', 30], ['定期試験', 50], ['課題', 20]] },
    { name: '物理Ⅰ',                  code: '01127', items: [['定期試験', 50], ['課題', 20], ['小テスト', 30]] },
    { name: '化学Ⅰ',                  code: '01128', items: [['定期試験', 50], ['課題', 20], ['小テスト', 30]] },
    { name: '英語会話',                code: '01131', items: [['会話演習', 50], ['多読', 50]] },
    { name: '保健体育Ⅰ',              code: '01134', items: [['スポーツテスト', 10], ['水泳', 15], ['実技課題', 55], ['保健', 20]] },
    { name: '英語コミュニケーションⅠ', code: '01137', items: [['中間試験', 30], ['定期試験', 50], ['課題', 20]] },
    { name: '英語表現基礎',            code: '01138', items: [['中間試験', 30], ['定期試験', 50], ['課題', 20]] },
    { name: '公共',                    code: '01139', items: [['定期試験', 65], ['課題', 5], ['小テスト', 30]] },
  ],
  kokiSpecialized: [
    { name: 'プログラミングⅠ',      code: '31211', items: [['定期試験', 50], ['小テスト', 20], ['プログラミング演習課題', 30]] },
    { name: '数理工学演習Ⅰ',        code: '31213', items: [['定期試験', 40], ['課題', 10], ['小テスト', 50]] },
  ],
  kokiGeneral: [
    { name: '国語Ⅰ',                 code: '01221', items: [['中間試験', 30], ['定期試験', 45], ['課題', 15], ['小テスト', 10]] },
    { name: '地理',                   code: '01224', items: [['中間試験', 30], ['定期試験', 50], ['課題', 20]] },
    { name: '基礎解析Ⅰ',              code: '01225', items: [['定期試験', 40], ['課題', 20], ['小テスト', 40]] },
    { name: '線形数学Ⅰ',              code: '01226', items: [['中間試験', 30], ['定期試験', 50], ['課題', 20]] },
    { name: '物理Ⅰ',                  code: '01227', items: [['定期試験', 50], ['課題', 20], ['小テスト', 30]] },
    { name: '化学Ⅰ',                  code: '01228', items: [['定期試験', 50], ['課題', 20], ['小テスト', 30]] },
    { name: '英語会話',                code: '01231', items: [['会話演習', 50], ['多読', 50]] },
    { name: '保健体育Ⅰ',              code: '01233', items: [['持久走', 15], ['実技課題', 65], ['保健', 20]] },
    { name: '英語コミュニケーションⅠ', code: '01236', items: [['中間試験', 30], ['定期試験', 50], ['課題', 20]] },
    { name: '英語表現基礎',            code: '01237', items: [['中間試験', 30], ['定期試験', 50], ['課題', 20]] },
    { name: '公共',                    code: '01238', items: [['定期試験', 60], ['課題', 20], ['小テスト', 20]] },
    { name: '総合理科',                code: '01234', items: [['中間試験', 30], ['定期試験', 50], ['課題', 20]] },
  ],
};

// ── 保存済み入力値の読み書き ─────────────────────────
// 単一項目: entered[label] = 点数(number)
// 複数回項目（課題・小テスト）: entered[label] = [{s:得点, m:満点}, ...]
function loadScores() {
  try { return JSON.parse(localStorage.getItem(TC_STORAGE_KEY)) || {}; } catch { return {}; }
}
function saveScores(all) {
  try { localStorage.setItem(TC_STORAGE_KEY, JSON.stringify(all)); } catch {}
}

// ── 判定・計算ロジック ───────────────────────────────
function gradeOf(score) {
  for (const t of GRADE_THRESHOLDS) if (score >= t.min) return t.grade;
  return 'F';
}
function gradeLabel(grade) { return grade === 'F' ? '不可' : grade; }
function fmt(n) { return (Math.round(n * 10) / 10).toString(); }

// entered: そのsubjectのentered値一式
function computeResult(items, entered) {
  let enteredWeight = 0, enteredSum = 0, remainingWeight = 0;
  items.forEach(([label, weight]) => {
    const v = entered[label];
    if (Array.isArray(v)) {
      // 複数回（課題・小テスト）: 得点合計 ÷ 満点合計
      let sSum = 0, mSum = 0;
      v.forEach(row => {
        const s = row.s;
        const m = (row.m === undefined || row.m === null || row.m === '') ? 100 : Number(row.m);
        if (s !== undefined && s !== null && s !== '' && !isNaN(s) && m > 0) {
          sSum += Number(s);
          mSum += m;
        }
      });
      if (mSum > 0) {
        enteredWeight += weight;
        enteredSum += weight * (sSum / mSum);
      } else {
        remainingWeight += weight;
      }
    } else if (v === undefined || v === null || v === '' || isNaN(v)) {
      remainingWeight += weight;
    } else {
      enteredWeight += weight;
      enteredSum += weight * Number(v) / 100;
    }
  });
  return { enteredWeight, enteredSum, remainingWeight };
}

// ============================================================
//  描画
// ============================================================
function persistEntered(code, mutate) {
  const all = loadScores();
  const cur = all[code] || {};
  mutate(cur);
  all[code] = cur;
  saveScores(all);
}

function renderSingleItem(body, subject, label, weight, entered, onChange) {
  const row = document.createElement('div');
  row.className = 'tc-item-row';

  const lbl = document.createElement('span');
  lbl.className = 'tc-item-label';
  lbl.textContent = label;
  row.appendChild(lbl);

  const w = document.createElement('span');
  w.className = 'tc-item-weight';
  w.textContent = weight + '%';
  row.appendChild(w);

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'tc-item-input';
  input.min = '0';
  input.max = '100';
  input.placeholder = '未入力';
  input.inputMode = 'decimal';
  if (typeof entered[label] === 'number') input.value = entered[label];
  input.addEventListener('input', () => {
    persistEntered(subject.code, cur => {
      if (input.value === '') {
        delete cur[label];
      } else {
        let v = Number(input.value);
        if (!isNaN(v)) cur[label] = Math.max(0, Math.min(100, v));
      }
    });
    onChange();
  });
  row.appendChild(input);

  body.appendChild(row);
}

function renderMultiItem(body, subject, label, weight, entered, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'tc-multi-item';

  const head = document.createElement('div');
  head.className = 'tc-item-row';
  const lbl = document.createElement('span');
  lbl.className = 'tc-item-label';
  lbl.textContent = label + '（複数回・合算）';
  head.appendChild(lbl);
  const w = document.createElement('span');
  w.className = 'tc-item-weight';
  w.textContent = weight + '%';
  head.appendChild(w);
  wrap.appendChild(head);

  const rowsWrap = document.createElement('div');
  wrap.appendChild(rowsWrap);

  function getRows() {
    const all = loadScores();
    const cur = all[subject.code] || {};
    if (!Array.isArray(cur[label])) cur[label] = [];
    return cur[label];
  }

  function renderRows() {
    rowsWrap.innerHTML = '';
    const rows = getRows();
    rows.forEach((row, idx) => {
      const r = document.createElement('div');
      r.className = 'tc-multi-row';

      const sInput = document.createElement('input');
      sInput.type = 'number';
      sInput.inputMode = 'decimal';
      sInput.className = 'tc-item-input tc-multi-score';
      sInput.placeholder = '得点';
      if (row.s !== undefined && row.s !== null) sInput.value = row.s;
      sInput.addEventListener('input', () => {
        persistEntered(subject.code, cur => {
          const arr = cur[label] || [];
          arr[idx] = arr[idx] || {};
          arr[idx].s = sInput.value === '' ? undefined : Number(sInput.value);
          cur[label] = arr;
        });
        onChange();
      });

      const slash = document.createElement('span');
      slash.className = 'tc-multi-slash';
      slash.textContent = '/';

      const mInput = document.createElement('input');
      mInput.type = 'number';
      mInput.inputMode = 'decimal';
      mInput.className = 'tc-item-input tc-multi-max';
      mInput.placeholder = '100';
      if (row.m !== undefined && row.m !== null) mInput.value = row.m;
      mInput.addEventListener('input', () => {
        persistEntered(subject.code, cur => {
          const arr = cur[label] || [];
          arr[idx] = arr[idx] || {};
          arr[idx].m = mInput.value === '' ? undefined : Number(mInput.value);
          cur[label] = arr;
        });
        onChange();
      });

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'tc-multi-remove';
      rm.setAttribute('aria-label', 'この回を削除');
      rm.textContent = '×';
      rm.addEventListener('click', () => {
        persistEntered(subject.code, cur => {
          const arr = cur[label] || [];
          arr.splice(idx, 1);
          cur[label] = arr;
        });
        renderRows();
        onChange();
      });

      r.appendChild(sInput);
      r.appendChild(slash);
      r.appendChild(mInput);
      r.appendChild(document.createTextNode('点'));
      r.appendChild(rm);
      rowsWrap.appendChild(r);
    });
  }
  renderRows();

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'tc-multi-add';
  addBtn.textContent = '＋ ' + label + 'を1回分追加';
  addBtn.addEventListener('click', () => {
    persistEntered(subject.code, cur => {
      const arr = cur[label] || [];
      arr.push({});
      cur[label] = arr;
    });
    renderRows();
    onChange();
  });
  wrap.appendChild(addBtn);

  body.appendChild(wrap);
}

function renderSubjectCard(subject, allScores) {
  const card = document.createElement('div');
  card.className = 'tc-card';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'tc-card-head';

  const nameEl = document.createElement('span');
  nameEl.className = 'tc-card-name';
  nameEl.textContent = subject.name;
  head.appendChild(nameEl);

  const badge = document.createElement('span');
  badge.className = 'tc-grade-badge';
  badge.textContent = '−';
  head.appendChild(badge);

  const chevron = document.createElement('span');
  chevron.className = 'tc-card-chevron';
  chevron.textContent = '›';
  head.appendChild(chevron);

  const body = document.createElement('div');
  body.className = 'tc-card-body';

  const entered = allScores[subject.code] || {};
  const resultBox = document.createElement('div');
  resultBox.className = 'tc-result';

  function onChange() { updateCardResult(subject, badge, resultBox); }

  subject.items.forEach(([label, weight]) => {
    if (isMultiLabel(label)) {
      renderMultiItem(body, subject, label, weight, entered, onChange);
    } else {
      renderSingleItem(body, subject, label, weight, entered, onChange);
    }
  });

  body.appendChild(resultBox);

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'tc-card-reset';
  resetBtn.textContent = 'この科目の入力をリセット';
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const all = loadScores();
    delete all[subject.code];
    saveScores(all);
    body.innerHTML = '';
    subject.items.forEach(([label, weight]) => {
      if (isMultiLabel(label)) {
        renderMultiItem(body, subject, label, weight, {}, onChange);
      } else {
        renderSingleItem(body, subject, label, weight, {}, onChange);
      }
    });
    body.appendChild(resultBox);
    body.appendChild(resetBtn);
    onChange();
  });
  body.appendChild(resetBtn);

  head.addEventListener('click', () => {
    card.classList.toggle('is-open');
  });

  card.appendChild(head);
  card.appendChild(body);

  updateCardResult(subject, badge, resultBox);

  return card;
}

function updateCardResult(subject, badgeEl, resultBox) {
  const all = loadScores();
  const entered = all[subject.code] || {};
  const { enteredWeight, enteredSum, remainingWeight } = computeResult(subject.items, entered);

  resultBox.innerHTML = '';

  if (enteredWeight === 0) {
    badgeEl.textContent = '−';
    badgeEl.className = 'tc-grade-badge';
    const p = document.createElement('span');
    p.textContent = '点数を入力すると、この場で判定を確認できます。';
    resultBox.appendChild(p);
    return;
  }

  if (remainingWeight === 0) {
    const grade = gradeOf(enteredSum);
    badgeEl.textContent = gradeLabel(grade);
    badgeEl.className = 'tc-grade-badge grade-' + grade;

    const line = document.createElement('span');
    line.innerHTML = '現在の得点：<span class="tc-result-score">' + fmt(enteredSum) + '点</span>（全項目入力済み）';
    resultBox.appendChild(line);
    return;
  }

  // 一部だけ入力済み → 現在の暫定値（未入力=0点扱い）を仮の判定に使う
  const provisionalGrade = gradeOf(enteredSum);
  badgeEl.textContent = gradeLabel(provisionalGrade) + '?';
  badgeEl.className = 'tc-grade-badge grade-' + provisionalGrade;

  const minLine = document.createElement('span');
  minLine.innerHTML =
    '現在の得点（残り項目を0点とした場合）：<span class="tc-result-score">' + fmt(enteredSum) + '点</span>';
  resultBox.appendChild(minLine);

  const maxScore = enteredSum + remainingWeight;
  const maxLine = document.createElement('span');
  maxLine.className = 'tc-result-need';
  maxLine.textContent = '残り項目で満点なら：最大 ' + fmt(maxScore) + '点';
  resultBox.appendChild(maxLine);

  GRADE_THRESHOLDS.forEach(t => {
    const line = document.createElement('span');
    line.className = 'tc-result-need';
    if (enteredSum >= t.min) {
      line.classList.add('is-ok');
      line.textContent = `${t.grade}（${t.min}点以上）：残りが何点でも達成見込みです`;
    } else {
      const needAvg = (t.min - enteredSum) * 100 / remainingWeight;
      if (needAvg > 100) {
        line.classList.add('is-ng');
        line.textContent = `${t.grade}（${t.min}点以上）：残り全項目が満点でも届きません`;
      } else {
        line.textContent = `${t.grade}（${t.min}点以上）まで：残りの項目で平均 ${fmt(needAvg)}点 必要`;
      }
    }
    resultBox.appendChild(line);
  });
}

function renderGroup(listEl, subjects) {
  const allScores = loadScores();
  subjects.forEach(subject => {
    listEl.appendChild(renderSubjectCard(subject, allScores));
  });
}

function renderAllSubjects() {
  renderGroup(document.getElementById('tc-list-zenki-specialized'), SUBJECTS.zenkiSpecialized);
  renderGroup(document.getElementById('tc-list-zenki-general'), SUBJECTS.zenkiGeneral);
  renderGroup(document.getElementById('tc-list-koki-specialized'), SUBJECTS.kokiSpecialized);
  renderGroup(document.getElementById('tc-list-koki-general'), SUBJECTS.kokiGeneral);
}
renderAllSubjects();

// ============================================================
//  ドロワー・ログイン中表示（他ページと共通の挙動）
//  ★ このページ自体はログイン不要（入力はlocalStorageのみで完結する）。
// ============================================================
function getLoginSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function renderDrawerAccount() {
  const el = document.getElementById('drawer-account');
  if (!el) return;
  el.innerHTML = '';
  el.classList.remove('is-open');
  const s = getLoginSession();
  if (!(s && s.session_token && s.nickname)) {
    const link = document.createElement('a');
    link.className = 'drawer-account-login-link';
    link.href = LOGIN_PATH;
    link.textContent = 'ログインしていません';
    el.appendChild(link);
    return;
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'drawer-account-btn';

  const avatar = document.createElement('span');
  avatar.className = 'drawer-account-avatar';
  avatar.textContent = s.nickname.slice(0, 2).toUpperCase();
  if (s.color) avatar.style.background = s.color;
  if (s.text_color) avatar.style.color = s.text_color;
  btn.appendChild(avatar);

  const names = document.createElement('span');
  names.className = 'drawer-account-names';
  const nameEl = document.createElement('span');
  nameEl.className = 'drawer-account-name';
  nameEl.textContent = s.nickname;
  names.appendChild(nameEl);
  if (s.student_id) {
    const idEl = document.createElement('span');
    idEl.className = 'drawer-account-id';
    idEl.textContent = s.student_id;
    names.appendChild(idEl);
  }
  btn.appendChild(names);

  const chevron = document.createElement('span');
  chevron.className = 'drawer-account-chevron';
  chevron.textContent = '›';
  btn.appendChild(chevron);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    el.classList.toggle('is-open');
  });

  const menu = document.createElement('div');
  menu.className = 'drawer-account-menu';

  const settingsLink = document.createElement('a');
  settingsLink.className = 'drawer-account-menu-item';
  settingsLink.href = '/StudyLog.html?openAccount=1';
  settingsLink.innerHTML = Icons.html('settings', {size:16}) + ' アカウント設定';
  menu.appendChild(settingsLink);

  const logoutBtn = document.createElement('button');
  logoutBtn.type = 'button';
  logoutBtn.className = 'drawer-account-menu-item is-danger';
  logoutBtn.innerHTML = Icons.html('logout', {size:16}) + ' ログアウト';
  logoutBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await showAppConfirm({ title: 'ログアウトしますか？', okLabel: 'ログアウト', danger: true });
    if (!ok) return;
    localStorage.removeItem(SESSION_KEY);
    location.href = LOGIN_PATH;
  });
  menu.appendChild(logoutBtn);

  el.appendChild(btn);
  el.appendChild(menu);
}
document.addEventListener('click', (e) => {
  const el = document.getElementById('drawer-account');
  if (el && !el.contains(e.target)) el.classList.remove('is-open');
});
renderDrawerAccount();

function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}
document.querySelectorAll('.drawer-item[href]').forEach(a => {
  a.addEventListener('click', (e) => {
    if (a.classList.contains('active')) {
      e.preventDefault();
      closeDrawer();
      return;
    }
    const overlay = document.getElementById('page-nav-loading');
    if (overlay) overlay.classList.add('show');
  });
});
window.addEventListener('pageshow', () => {
  const overlay = document.getElementById('page-nav-loading');
  if (overlay) overlay.classList.remove('show');
});

// ★ ここまでエラーなく実行できた＝JSが生きている合図
hideLoadingFallback();
