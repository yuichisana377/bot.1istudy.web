// ★ サーバーIDを固定
const FIXED_SERVER_ID = "1509880344806162544";

// 科目名から安定した色を生成
function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

// 曜日を返す
function getWeekday(dateStr) {
  const date = new Date(dateStr);
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return weekdays[date.getDay()];
}

// 最終更新時刻を表示
function updateLastUpdated() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  document.getElementById("lastUpdated").textContent =
    `最終更新：${hh}:${mm}:${ss}`;
}

async function loadSchedule() {
  // ★ キャッシュ完全無効化
  const url = `https://raw.githubusercontent.com/yuichisana377/python.bot.1istudy/main/plans_${FIXED_SERVER_ID}.json?time=${Date.now()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("読み込み失敗");

    const data = await res.json();

    // 日付ごとにまとめる
    const grouped = {};
    data.forEach(item => {
      if (!grouped[item.date]) grouped[item.date] = [];
      grouped[item.date].push(item);
    });

    const container = document.getElementById("schedule");
    container.innerHTML = "";

    // 日付順にソート
    const sortedDates = Object.keys(grouped).sort();

    sortedDates.forEach(date => {
      const card = document.createElement("div");
      card.className = "card";

      const dateTitle = document.createElement("div");
      dateTitle.className = "card-date";

      // ★ 曜日を追加
      const w = getWeekday(date);
      dateTitle.textContent = `${date}（${w}）`;

      card.appendChild(dateTitle);

      grouped[date].forEach(entry => {
        const task = document.createElement("div");
        task.className = "task";

        const content = entry.content;

        // カテゴリ色
        if (content.includes("【提出】")) task.classList.add("submit");
        if (content.includes("【宿題】")) task.classList.add("homework");
        if (content.includes("【持ち物】")) task.classList.add("item");
        if (content.includes("【テスト】")) task.classList.add("test");

        // ★ 科目ごとの色（左ライン）
        const subjectColor = stringToColor(entry.subject);
        task.style.borderLeftColor = subjectColor;

        task.textContent = `・${entry.subject}：${entry.content}`;
        card.appendChild(task);
      });

      container.appendChild(card);
    });

    // ★ 最終更新時刻を更新
    updateLastUpdated();

  } catch (e) {
    console.error(e);
    alert("データの読み込みに失敗しました");
  }
}

// ★ ページ読み込み時に自動実行
window.onload = () => {
  loadSchedule();
};

// ★ 10秒ごとに自動更新
setInterval(() => {
  loadSchedule();
}, 10000);
