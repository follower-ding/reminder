const TOAST = document.getElementById("toast");
const API_BASE = "/api";
let TOKEN = localStorage.getItem("token") || "";
let USER = JSON.parse(localStorage.getItem("user") || "null");

function toast(msg) { TOAST.textContent = msg; TOAST.classList.add("show"); setTimeout(() => TOAST.classList.remove("show"), 2500); }

function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
  return fetch(API_BASE + path, { ...opts, headers }).then(r => r.json().catch(() => ({ error: r.statusText })));
}

// Login
document.getElementById("login-btn").addEventListener("click", async () => {
  const username = document.getElementById("login-user").value.trim();
  const password = document.getElementById("login-pass").value.trim();
  const errEl = document.getElementById("login-error");
  if (!username || !password) { errEl.textContent = "请输入用户名和密码"; errEl.classList.remove("hidden"); return; }
  const res = await api("/login", { method: "POST", body: JSON.stringify({ username, password }) });
  if (res.token) {
    TOKEN = res.token; USER = res.user;
    localStorage.setItem("token", TOKEN); localStorage.setItem("user", JSON.stringify(USER));
    document.getElementById("user-label").textContent = USER.label || USER.username;
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("app").style.display = "block";
    navigate("dashboard");
  } else {
    errEl.textContent = res.error || "登录失败"; errEl.classList.remove("hidden");
  }
});
document.getElementById("login-pass").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("login-btn").click(); });

// Logout
document.getElementById("logout-btn").addEventListener("click", () => {
  TOKEN = ""; USER = null; localStorage.removeItem("token"); localStorage.removeItem("user");
  document.getElementById("app").style.display = "none";
  document.getElementById("login-screen").style.display = "flex";
});

// Check token on load
if (TOKEN && USER) { document.getElementById("user-label").textContent = USER.label || USER.username; document.getElementById("login-screen").style.display = "none"; document.getElementById("app").style.display = "block"; navigate("dashboard"); }

// Navigation
let currentView = "dashboard";
document.querySelectorAll(".tab-bar button").forEach(btn => {
  btn.addEventListener("click", () => navigate(btn.dataset.view));
});
function navigate(view) {
  currentView = view;
  document.querySelectorAll(".tab-bar button").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  renderView(view);
}

// Modal helpers
function openModal(html, center = false) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay" + (center ? " center" : "");
  overlay.innerHTML = `<div class="modal-content">${html}</div>`;
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  return overlay.querySelector(".modal-content");
}
function closeModal() { const m = document.querySelector(".modal-overlay"); if (m) m.remove(); }

// Type config
const TYPE_META = {
  birthday: { icon: "🎂", label: "生日", modes: ["yearly"] },
  anniversary: { icon: "💑", label: "纪念日", modes: ["yearly"] },
  period: { icon: "🩸", label: "经期", modes: ["cycle"] },
  medicine: { icon: "💊", label: "吃药", modes: ["daily"] },
  bill: { icon: "📄", label: "缴费", modes: ["monthly"] },
  health: { icon: "🏃", label: "健康", modes: ["daily", "weekly"] },
  festival: { icon: "🎉", label: "节日", modes: ["yearly"] },
  checkup: { icon: "🏥", label: "体检", modes: ["yearly"] },
  custom: { icon: "📌", label: "自定义", modes: ["daily", "weekly", "monthly", "yearly"] }
};

function typeIcon(type) { return TYPE_META[type]?.icon || "📌"; }
function typeLabel(type) { return TYPE_META[type]?.label || "自定义"; }

// ─── View Renderers ──────────────────────────────────

function renderView(view) {
  const el = document.getElementById("app-content");
  if (view === "dashboard") renderDashboard(el);
  else if (view === "events") renderEvents(el);
  else if (view === "stats") renderStats(el);
  else if (view === "recommend") renderRecommend(el);
  else if (view === "settings") renderSettings(el);
}

// ─── Dashboard ───────────────────────────────────────
async function renderDashboard(el) {
  el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text2)">⏳ 加载中...</div>`;
  const [dashboard, stats] = await Promise.all([api("/dashboard"), api("/stats")]);
  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h2>📅 ${dashboard.date || "今天"}</h2></div>
      <div class="stat-grid">
        <div class="stat-item"><div class="num">${stats.todayCount||0}</div><div class="label">今日提醒</div></div>
        <div class="stat-item"><div class="num">${stats.upcoming30||0}</div><div class="label">近30天待办</div></div>
        <div class="stat-item"><div class="num">${stats.enabled||0}</div><div class="label">已启用</div></div>
        <div class="stat-item"><div class="num">${stats.total||0}</div><div class="label">总事件</div></div>
      </div>
    </div>
    ${dashboard.today && dashboard.today.length ? renderEventList(dashboard.today, "今日提醒") : '<div class="card"><div class="empty-state"><div class="icon">✅</div><p>今天没有待办提醒</p></div></div>'}
    ${dashboard.upcoming && dashboard.upcoming.length ? renderEventList(dashboard.upcoming, "近期待办 (" + dashboard.upcoming.filter(r => r.days > 0).length + " 项)") : ''}
    <div style="text-align:center;padding:12px;color:var(--text2);font-size:.8rem">☀️ 日常提醒系统 v3.0</div>`;
}

function renderEventList(items, title) {
  return `<div class="card"><div class="card-header"><h2>${title}</h2></div>${items.map(r => {
    const isToday = r.days === 0;
    return `<div class="event-item">
      <div class="event-icon">${typeIcon(r.type)}</div>
      <div class="event-info">
        <div class="name">${r.name||r.message} <span class="badge ${isToday ? 'today' : ''}">${isToday ? '今天' : (r.days ? r.days+'天后' : '')}</span></div>
        <div class="message">${r.message}</div>
      </div>
    </div>`;
  }).join("")}</div>`;
}

// ─── Events ──────────────────────────────────────────
async function renderEvents(el) {
  el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text2)">⏳ 加载中...</div>`;
  const events = await api("/events");
  const enabled = events.filter(e => e.enabled);
  const disabled = events.filter(e => !e.enabled);
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2>📋 事件管理 (${events.length})</h2>
      <button class="btn-primary btn-small" id="add-event-btn">+ 新增</button>
    </div>
    <div class="card">${renderEventRows(enabled, true)}${renderEventRows(disabled, false)}</div>`;
  document.getElementById("add-event-btn").addEventListener("click", showEventForm);
  el.querySelectorAll(".edit-btn").forEach(b => b.addEventListener("click", () => showEventForm(parseInt(b.dataset.id))));
  el.querySelectorAll(".toggle-btn").forEach(b => b.addEventListener("click", () => toggleEvent(parseInt(b.dataset.id))));
  el.querySelectorAll(".delete-btn").forEach(b => b.addEventListener("click", () => deleteEvent(parseInt(b.dataset.id))));
}

function renderEventRows(events, active) {
  if (!events.length) return `<div class="empty-state"><p>${active ? '暂无启用的事件' : '暂无禁用的事件'}</p></div>`;
  return events.map(ev => {
    const type = TYPE_META[ev.type] || { icon: "📌", label: "自定义" };
    const sched = ev.schedule || {};
    const modeLabel = { daily: "每天", weekly: "每周", monthly: "每月", yearly: "每年", cycle: "周期" }[sched.mode] || sched.mode || "每年";
    return `<div class="event-item">
      <div class="event-icon">${type.icon}</div>
      <div class="event-info">
        <div class="name">${ev.name} <span class="badge ${active ? 'active' : ''}">${active ? '已启用' : '已禁用'}</span></div>
        <div class="meta">${type.label} · ${modeLabel}${sched.month ? ' · '+sched.month+'月'+sched.day+'日' : ''}${ev.remind_ahead ? ' · 提前'+ev.remind_ahead+'天' : ''}</div>
      </div>
      <div class="event-actions">
        <button class="edit-btn" data-id="${ev.id}">✏️</button>
        <button class="toggle-btn" data-id="${ev.id}">${active ? '⏸' : '▶️'}</button>
        <button class="btn-d delete-btn" data-id="${ev.id}">🗑</button>
      </div>
    </div>`;
  }).join("");
}

async function toggleEvent(id) {
  const events = await api("/events");
  const ev = events.find(e => e.id === id);
  if (!ev) return;
  await api("/events/"+id, { method: "PUT", body: JSON.stringify({ enabled: !ev.enabled }) });
  toast(`${ev.name} ${ev.enabled ? '已禁用' : '已启用'}`);
  renderView("events");
}

async function deleteEvent(id) {
  if (!confirm("确定删除此事件？")) return;
  await api("/events/"+id, { method: "DELETE" });
  toast("已删除");
  renderView("events");
}

function showEventForm(id) {
  (async () => {
    const events = id ? await api("/events") : [];
    const ev = id ? events.find(e => e.id === id) : null;
    const isNew = !ev;
    const content = document.createElement("div");
    content.innerHTML = eventFormHTML(ev);
    const modal = openModal(content.innerHTML, true);
    if (modal) setupEventForm(modal, ev, isNew);
  })();
}

function eventFormHTML(ev) {
  const s = ev?.schedule || {};
  const m = ev?.messages || {};
  const types = Object.entries(TYPE_META).map(([k,v]) => `<option value="${k}" ${ev?.type===k?'selected':''}>${v.icon} ${v.label}</option>`).join("");
  const modeOpts = ["daily","weekly","monthly","yearly","cycle"].map(mo => `<option value="${mo}" ${s.mode===mo?'selected':''}>${({daily:"每天",weekly:"每周",monthly:"每月",yearly:"每年",cycle:"周期"})[mo]}</option>`).join("");
  return `
    <div class="modal-header">
      <h2>${isNew ? '新增事件' : '编辑事件'}</h2>
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
    </div>
    <form id="event-form">
      <div class="form-row">
        <div class="form-group"><label>类型</label><select name="type">${types}</select></div>
        <div class="form-group"><label>调度模式</label><select name="mode">${modeOpts}</select></div>
      </div>
      <div class="form-group"><label>名称</label><input name="name" value="${ev?.name||''}" placeholder="事件名称" required></div>
      <div class="form-group"><label>分类</label><input name="category" value="${ev?.category||''}" placeholder="如 family, work, personal"></div>
      <div class="form-row">
        <div class="form-group"><label>月 (1-12)</label><input name="month" type="number" min="1" max="12" value="${s.month||''}"></div>
        <div class="form-group"><label>日 (1-31)</label><input name="day" type="number" min="1" max="31" value="${s.day||''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>提前提醒天数</label><input name="remind_ahead" type="number" min="0" value="${ev?.remind_ahead||0}"></div>
        <div class="form-group"><label>周期长度(经期)</label><input name="cycle_length" type="number" min="1" value="${s.cycle_length||28}"></div>
      </div>
      <div class="form-group"><label>上次开始日期(经期)</label><input name="last_start" type="date" value="${s.last_start||''}"></div>
      <div class="form-group"><label>提醒消息 (可用 {days} {name})</label><input name="msg_reminder" value="${m.reminder||''}" placeholder="还有 {days} 天"></div>
      <div class="form-group"><label>当日消息</label><input name="msg_today" value="${m.today||''}" placeholder="🎂 生日快乐！"></div>
      <div class="form-group"><label>默认消息 (日常/健康)</label><input name="msg_default" value="${m.default||''}"></div>
      <div class="form-actions">
        <button type="submit" class="btn-primary">${isNew ? '创建' : '保存'}</button>
        <button type="button" class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
      </div>
    </form>`;
}

function setupEventForm(modal, ev, isNew) {
  modal.querySelector("#event-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      type: fd.get("type"),
      name: fd.get("name"),
      category: fd.get("category") || "default",
      remind_ahead: parseInt(fd.get("remind_ahead")) || 0,
      schedule: {
        mode: fd.get("mode"),
        month: fd.get("month") ? parseInt(fd.get("month")) : undefined,
        day: fd.get("day") ? parseInt(fd.get("day")) : undefined,
        cycle_length: fd.get("cycle_length") ? parseInt(fd.get("cycle_length")) : undefined,
        last_start: fd.get("last_start") || undefined
      },
      messages: {
        reminder: fd.get("msg_reminder") || undefined,
        today: fd.get("msg_today") || undefined,
        default: fd.get("msg_default") || undefined
      }
    };
    Object.keys(body.messages).forEach(k => body.messages[k] === undefined && delete body.messages[k]);
    Object.keys(body.schedule).forEach(k => body.schedule[k] === undefined && delete body.schedule[k]);
    if (isNew) {
      await api("/events", { method: "POST", body: JSON.stringify(body) });
      toast("✅ 事件已创建");
    } else {
      await api("/events/"+ev.id, { method: "PUT", body: JSON.stringify(body) });
      toast("✅ 事件已更新");
    }
    closeModal();
    renderView("events");
  });
}

// ─── Stats ───────────────────────────────────────────
async function renderStats(el) {
  el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text2)">⏳ 加载中...</div>`;
  const stats = await api("/stats");
  const events = await api("/events");
  el.innerHTML = `
    <h2 style="margin-bottom:12px">📈 统计分析</h2>
    <div class="card">
      <div class="stat-grid">
        <div class="stat-item"><div class="num">${stats.total||0}</div><div class="label">总事件</div></div>
        <div class="stat-item"><div class="num">${stats.enabled||0}</div><div class="label">已启用</div></div>
        <div class="stat-item"><div class="num">${stats.disabled||0}</div><div class="label">已禁用</div></div>
        <div class="stat-item"><div class="num">${stats.todayCount||0}</div><div class="label">今日提醒</div></div>
      </div>
    </div>
    <div class="card"><div class="card-header"><h2>类型分布</h2></div>
      ${Object.entries(stats.byType||{}).map(([type, count]) => {
        const meta = TYPE_META[type] || { icon: "📌", label: type };
        const pct = stats.total ? ((count/stats.total)*100).toFixed(0) : 0;
        return `<div class="event-item"><div class="event-icon">${meta.icon}</div><div class="event-info"><div class="name">${meta.label}</div><div class="meta">${count} 项 (${pct}%)</div></div></div>`;
      }).join("")}
      ${!Object.keys(stats.byType||{}).length ? '<div class="empty-state"><p>暂无数据</p></div>' : ''}
    </div>
    <button class="btn-secondary" id="show-history-btn" style="width:100%;padding:12px">📜 查看操作历史</button>`;
  const historyBtn = document.getElementById("show-history-btn");
  if (historyBtn) historyBtn.addEventListener("click", () => renderHistory(el));
}

async function renderHistory(el) {
  const history = await api("/history");
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <button class="btn-secondary btn-small" id="back-to-stats">← 返回统计</button>
      <h2 style="margin:0">📜 操作历史</h2>
    </div>
    <div class="card">${(history||[]).map(h => `<div class="history-item"><span class="h-date">${h.date}</span><span>${h.action === 'create' ? '➕ 创建' : h.action === 'update' ? '✏️ 更新' : h.action === 'delete' ? '🗑 删除' : h.action} ${h.detail}</span></div>`).join("")}
    ${!history||!history.length ? '<div class="empty-state"><p>暂无历史记录</p></div>' : ''}</div>`;
  document.getElementById("back-to-stats").addEventListener("click", () => renderView("stats"));
}

// ─── Recommend ───────────────────────────────────────
async function renderRecommend(el) {
  el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text2)">⏳ 加载中...</div>`;
  const recs = await api("/recommend");
  // Also get dashboard for dynamic stats
  const db = await api("/dashboard");
  el.innerHTML = `
    <h2 style="margin-bottom:12px">💡 智能推荐</h2>
    ${db.today && db.today.length ? `<div class="card"><div class="card-header"><h2>⏰ 今日提醒</h2></div>${db.today.map(r => `<div class="rec-item"><div class="icon">${typeIcon(r.type)}</div><div class="body"><div class="title">${r.name||'事件'}</div><div class="desc">${r.message}</div></div></div>`).join("")}</div>` : ''}
    <div class="card"><div class="card-header"><h2>💡 建议</h2></div>
      ${recs.length ? recs.map(r => `<div class="rec-item"><div class="icon">${typeIcon(r.type)}</div><div class="body"><div class="title">${r.name}</div><div class="desc">${r.message}</div></div></div>`).join("") : '<div class="empty-state"><p>暂无特别建议</p></div>'}
    </div>`;
}

// ─── Settings ────────────────────────────────────────
async function renderSettings(el) {
  el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text2)">⏳ 加载中...</div>`;
  const config = await api("/config");
  const health = await api("/health");
  el.innerHTML = `
    <h2 style="margin-bottom:12px">⚙️ 系统设置</h2>
    <div class="card">
      <div class="config-section">
        <h3>飞书推送</h3>
        <div class="toggle-row"><span>启用飞书</span><div class="toggle ${config.feishu?.enabled ? 'on' : ''}" id="toggle-feishu"></div></div>
        <div class="form-group"><label>Webhook URL</label><input id="feishu-url" value="${config.feishu?.webhook_url||''}" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."></div>
        <div style="display:flex;gap:8px"><button class="btn-primary btn-small" id="save-feishu">保存</button><button class="btn-secondary btn-small" id="test-feishu">测试推送</button></div>
      </div>
    </div>
    <div class="card">
      <div class="config-section">
        <h3>Server酱 微信推送</h3>
        <div class="toggle-row"><span>启用 Server酱</span><div class="toggle ${config.serverchan?.enabled ? 'on' : ''}" id="toggle-serverchan"></div></div>
        <div class="form-group"><label>SendKey</label><input id="serverchan-key" value="${config.serverchan?.sendkey||''}" placeholder="SCTxxx"></div>
        <div style="display:flex;gap:8px"><button class="btn-primary btn-small" id="save-serverchan">保存</button><button class="btn-secondary btn-small" id="test-serverchan">测试推送</button></div>
      </div>
    </div>
    <div class="card">
      <div class="config-section">
        <h3>其他设置</h3>
        <div class="form-group"><label>时区</label>
          <select id="config-tz">
            <option value="Asia/Shanghai" ${config.timezone==='Asia/Shanghai'?'selected':''}>🇨🇳 亚洲/上海 (UTC+8)</option>
            <option value="Asia/Tokyo" ${config.timezone==='Asia/Tokyo'?'selected':''}>🇯🇵 亚洲/东京 (UTC+9)</option>
            <option value="America/New_York" ${config.timezone==='America/New_York'?'selected':''}>🇺🇸 美洲/纽约 (UTC-5)</option>
            <option value="Europe/London" ${config.timezone==='Europe/London'?'selected':''}>🇬🇧 欧洲/伦敦 (UTC+0)</option>
          </select>
        </div>
        <div class="form-group"><label>检查时间 (逗号分隔)</label><input id="config-times" value="${(config.check_times||[]).join(',')}" placeholder="09:00,14:00,21:00"></div>
        <button class="btn-primary btn-small" id="save-other">保存</button>
      </div>
    </div>
    <div class="card" style="text-align:center;color:var(--text2);font-size:.82rem">
      <p>☀️ 日常提醒系统 v${health.version||'3.0'}</p>
      <p>状态: ${health.status||'ok'} · ${health.time||''}</p>
      <p style="margin-top:8px"><a href="https://github.com/follower-ding/reminder" target="_blank">GitHub</a></p>
    </div>`;

  // Toggle handlers
  document.getElementById("toggle-feishu").addEventListener("click", function() {
    this.classList.toggle("on");
  });
  document.getElementById("toggle-serverchan").addEventListener("click", function() {
    this.classList.toggle("on");
  });
  document.getElementById("save-feishu").addEventListener("click", async () => {
    const cfg = await api("/config");
    cfg.feishu = cfg.feishu || {};
    cfg.feishu.enabled = document.getElementById("toggle-feishu").classList.contains("on");
    cfg.feishu.webhook_url = document.getElementById("feishu-url").value;
    await api("/config", { method: "PUT", body: JSON.stringify(cfg) });
    toast("✅ 飞书配置已保存");
  });
  document.getElementById("test-feishu").addEventListener("click", async () => {
    const res = await api("/feishu/test", { method: "POST" });
    toast(res.ok ? "✅ 飞书测试消息已发送" : "❌ " + (res.error || "发送失败"));
  });
  document.getElementById("save-serverchan").addEventListener("click", async () => {
    const cfg = await api("/config");
    cfg.serverchan = cfg.serverchan || {};
    cfg.serverchan.enabled = document.getElementById("toggle-serverchan").classList.contains("on");
    cfg.serverchan.sendkey = document.getElementById("serverchan-key").value;
    await api("/config", { method: "PUT", body: JSON.stringify(cfg) });
    toast("✅ Server酱配置已保存");
  });
  document.getElementById("test-serverchan").addEventListener("click", async () => {
    const res = await api("/serverchan/test", { method: "POST" });
    toast(res.ok ? "✅ 测试消息已发送" : "❌ " + (res.error || "发送失败"));
  });
  document.getElementById("save-other").addEventListener("click", async () => {
    const cfg = await api("/config");
    cfg.timezone = document.getElementById("config-tz").value;
    cfg.check_times = document.getElementById("config-times").value.split(",").map(s => s.trim()).filter(Boolean);
    await api("/config", { method: "PUT", body: JSON.stringify(cfg) });
    toast("✅ 设置已保存");
  });
}