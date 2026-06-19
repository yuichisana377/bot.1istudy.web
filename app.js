// 曜日を返す
function getWeekday(dateStr) {
  const week = ["日", "月", "火", "水", "木", "金", "土"];
  const d = new Date(dateStr);
  return week[d.getDay()];
}

// 科目名から安定した色を生成（Hue + Saturation + Lightness）
function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  const sat = 55 + (Math.abs(hash) % 20);
  const light = 55 + (Math.abs(hash * 3) % 20);

  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

function loadData() {
  const serverId = document.getElementById("serverId").value;

  const url = `https://raw.githubusercontent.com/yuichisana377/python.bot.1istudy/main/plans_${serverId}.json?t=${Date.now()}`;


  fetch(url)
    .then(res => res.json())
    .then(data => {

      const today = new Date().setHours(0,0,0,0);
      data = data.filter(item => new Date(item.date) >= today);

      data.sort((a, b) => new Date(a.date) - new Date(b.date));

      data = data.map(item => {
        const match = item.content.match(/【(.+?)】/);
        const type = match ? match[1] : "その他";
        const content = item.content.replace(/【.+?】/, "");
        return { ...item, type, content };
      });

      const grouped = {};
      data.forEach(item => {
        if (!grouped[item.date]) grouped[item.date] = [];
        grouped[item.date].push(item);
      });

      const container = document.getElementById("schedule");
      container.innerHTML = "";

      Object.keys(grouped).sort().forEach(date => {

        // ▼ 曜日を追加
        const weekday = getWeekday(date);

        const h2 = document.createElement("h2");
        h2.textContent = `${date}（${weekday}）`;
        container.appendChild(h2);

        grouped[date].forEach(item => {
          const p = document.createElement("p");

          if (item.type.includes("提出")) p.classList.add("submit");
          if (item.type.includes("宿題")) p.classList.add("homework");
          if (item.type.includes("持ち物")) p.classList.add("bring");

          const color = stringToColor(item.subject);
          p.style.borderLeftColor = color;

          p.textContent = `・${item.subject}【${item.type}】${item.content}`;
          container.appendChild(p);
        });
      });
    })
    .catch(err => {
      document.getElementById("schedule").innerHTML = "読み込みに失敗しました。";
      console.error(err);
    });
    document.getElementById("status").textContent =
  "更新しました：" + new Date().toLocaleTimeString();

}
