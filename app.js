// ★ サーバーID固定
const SERVER_ID = "1509880344806162544";

// サイドバー開閉
function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
}

// ページ切り替え（押したら自動で閉じる）
function showPage(name) {
  document.getElementById("page-home").style.display = "none";
  document.getElementById("page-logs").style.display = "none";

  document.getElementById("page-" + name).style.display = "block";

  // ★ メニューを自動で閉じる
  document.getElementById("sidebar").classList.remove("open");

  if (name === "logs") loadLogs();
}

// 科目名から色生成
function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

// 曜日
function getWeekday(dateStr) {
  const date = new Date(dateStr);
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return weekdays[date.getDay()];
}

// 最終更新時刻
function updateLastUpdated() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  document.getElementById("lastUpdated").textContent =
    `最終更新：${hh}:${mm}:${ss}`;
}

// 課題一覧読み込み（HOME）
async function loadSchedule() {
  const url = `https://raw.githubusercontent.com/yuichisana377/python.bot.1istudy/main/plans_${SERVER_ID}.json?time=${Date.now()}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    const grouped = {};
    data.forEach(item => {
      if (!grouped[item.date]) grouped[item.date] = [];
      grouped[item.date].push(item);
    });

    const container = document.getElementById("schedule");
    container.innerHTML = "";

    const sortedDates = Object.keys(grouped).sort();

    sortedDates.forEach(date => {
      const card = document.createElement("div");
      card.className = "card";

      const dateTitle = document.createElement("div");
      dateTitle.className = "card-date";
      dateTitle.textContent = `${date}（${getWeekday(date)}）`;

      card.appendChild(dateTitle);

      grouped[date].forEach(entry => {
        const task = document.createElement("div");
        task.className = "task-card";

        // カテゴリ判定
        let cls = "task-other";
        if (entry.content.includes("【提出】")) cls = "task-submit";
        if (entry.content.includes("【宿題】")) cls = "task-homework";
        if (entry.content.includes("【持ち物】")) cls = "task-item";
        if (entry.content.includes("【テスト】")) cls = "task-test";

        task.classList.add(cls);

        // 科目色（左線の色）
        task.style.borderLeftColor = stringToColor(entry.subject);

        task.textContent = `・${entry.subject}：${entry.content}`;
        card.appendChild(task);
      });

      container.appendChild(card);
    });

    updateLastUpdated();

  } catch (e) {
    console.error(e);
  }
}

// Logs 読み込み（タイムライン）
async function loadLogs() {
  const url = `https://raw.githubusercontent.com/yuichisana377/python.bot.1istudy/main/logs_${SERVER_ID}.json?time=${Date.now()}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    const container = document.getElementById("logs");
    container.innerHTML = "";

    const timeline = document.createElement("div");
    timeline.className = "timeline";

    data.reverse().forEach(log => {
      const item = document.createElement("div");
      item.className = "timeline-item";

      if (log.type === "add") item.classList.add("timeline-add");
      if (log.type === "edit") item.classList.add("timeline-edit");
      if (log.type === "delete") item.classList.add("timeline-delete");

      const text = document.createElement("div");
      text.className = "timeline-text";
      text.innerHTML = `${log.time} / ${log.type}<br>${log.detail}`;
      item.appendChild(text);
      timeline.appendChild(item);
    });

    container.appendChild(timeline);

  } catch (e) {
    console.error(e);
  }
}

// ★ 30秒ごと更新
setInterval(loadSchedule, 30000);
setInterval(loadLogs, 30000);
loadSchedule();
loadLogs();
