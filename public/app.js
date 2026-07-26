/* Nudge v4.1.2 — Today polish + space list; ack/chat in Feishu */
const API = "/api";
const BRAND = { name: "Nudge", tagline: "轻推一下，刚好想起" };
const HINT_KEY = "nudge_hide_feishu_hint";
let token = localStorage.getItem("nudge_token") || localStorage.getItem("reminder_token") || "";
let currentUser = null;
let currentView = "today";
let detailId = null;
let spaceFilter = "habit"; // habit | moment | task
let selectedIds = new Set();
let createSpaceHint = "habit";

const SPACE_META = {
  habit: { label: "习惯", hint: "每天 / 每周重复", badge: "habit" },
  moment: { label: "日子", hint: "生日、经期、纪念日", badge: "moment" },
  task: { label: "待办", hint: "临时一次", badge: "task" }
};
const TYPE_META = {
  birthday: { label: "生日" },
  period: { label: "经期" },
  custom: { label: "事项" }
};
const HABIT_TEMPLATES = [
  { id: "study", label: "每日学习", name: "每日学习", mode: "daily", time: "08:00", message: "开始今日学习" },
  { id: "med", label: "吃药", name: "吃药提醒", mode: "daily", time: "09:00", message: "该吃药了" },
  { id: "bill", label: "缴费", name: "月度缴费", mode: "monthly", time: "09:00", message: "今天记得缴费" }
];

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text || "解析失败" }; }
  // /login 的 401 是账号密码错误，不要当成会话过期
  if (res.status === 401 && path !== "/login") {
    logout(true);
    throw new Error(body.error || "未登录或登录已过期");
  }
  if (res.status === 401 && path === "/login") {
    return { error: body.error || "用户名或密码错误" };
  }
  return body;
}
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2800);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function spaceOf(ev) {
  if (ev?.space && SPACE_META[ev.space]) return ev.space;
  if (ev?.type === "birthday" || ev?.type === "period") return "moment";
  if (ev?.category === "temporary") return "task";
  return "habit";
}
function spaceBadge(space) {
  const m = SPACE_META[space] || SPACE_META.habit;
  return `<span class="badge ${m.badge}">${m.label}</span>`;
}
function typeLabel(t) { return TYPE_META[t]?.label || "事项"; }
function cleanText(s) {
  return String(s ?? "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/\s{2,}/g, " ").trim();
}
function formatDateCN(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd || "";
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const week = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  return `${+m[2]}月${+m[3]}日 周${week}`;
}
function labelFromToken(t) {
  try {
    const part = String(t || "").split(".")[0];
    if (!part) return "已登录";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "===".slice((b64.length + 3) % 4);
    const data = JSON.parse(decodeURIComponent(escape(atob(pad))));
    return data.l || data.u || "已登录";
  } catch { return "已登录"; }
}
function skeletonBlocks(n = 3) {
  return `<div class="skel-list">${Array.from({ length: n }, () => `<div class="skel-card"><div class="skel-line w60"></div><div class="skel-line w40"></div><div class="skel-line w80"></div></div>`).join("")}</div>`;
}
function groupPending(list) {
  const map = new Map();
  for (const r of list || []) {
    const key = `${r.name || ""}|${r.message || ""}|${r.space || ""}`;
    if (!map.has(key)) map.set(key, { ...r, _count: 1, _ids: [r.eventId] });
    else {
      const g = map.get(key);
      g._count += 1;
      g._ids.push(r.eventId);
    }
  }
  return [...map.values()];
}
function closeModal() { document.querySelectorAll(".modal-overlay").forEach((m) => m.remove()); }
function openModal(html, center = true) {
  closeModal();
  const o = document.createElement("div");
  o.className = "modal-overlay" + (center ? " center" : "");
  o.innerHTML = `<div class="modal-content">${html}</div>`;
  o.addEventListener("click", (e) => { if (e.target === o) o.remove(); });
  document.body.appendChild(o);
  return o.querySelector(".modal-content");
}
function scheduleMeta(ev) {
  const s = ev.schedule || {};
  const mode = { daily: "每天", weekly: "每周", monthly: "每月", yearly: "每年", cycle: "周期" }[s.mode] || "";
  const bits = [SPACE_META[spaceOf(ev)]?.label, mode, s.time];
  if (ev.subtype === "birthday" || ev.type === "birthday") bits.push(s.month && s.day ? `${s.month}/${s.day}` : "");
  if (ev.subtype === "anniversary") bits.push(s.month && s.day ? `${s.month}/${s.day}` : "");
  return bits.filter(Boolean).join(" · ");
}

async function login() {
  const username = document.getElementById("login-user").value.trim();
  const password = document.getElementById("login-pass").value;
  const err = document.getElementById("login-error");
  const btn = document.getElementById("login-btn");
  err.classList.add("hidden");
  if (!username || !password) {
    err.textContent = "请输入用户名和密码";
    err.classList.remove("hidden");
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = "登录中…"; }
  try {
    const res = await api("/login", { method: "POST", body: JSON.stringify({ username, password }) });
    if (res.error || !res.token) { err.textContent = res.error || "登录失败"; err.classList.remove("hidden"); return; }
    token = res.token;
    localStorage.setItem("nudge_token", token);
    localStorage.setItem("reminder_token", token);
    currentUser = res.user;
    showApp();
  } catch (e) {
    err.textContent = e.message || "登录失败";
    err.classList.remove("hidden");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "进入"; }
  }
}
function logout(redirect = true) {
  token = ""; currentUser = null;
  localStorage.removeItem("nudge_token");
  localStorage.removeItem("reminder_token");
  document.getElementById("app").style.display = "none";
  document.getElementById("login-screen").style.display = "grid";
  if (!redirect) return;
}
function showApp() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "block";
  document.getElementById("user-label").textContent = currentUser?.label || labelFromToken(token) || "";
  renderView(currentView);
}
async function consumeAckQuery() {
  const q = new URLSearchParams(location.search);
  if (q.get("ack_error")) {
    toast("确认链接无效或已过期");
    history.replaceState({}, "", location.pathname);
    return;
  }
  if (q.get("acked")) {
    toast(q.get("archived") ? "已确认，待办已归档" : "飞书已确认");
    history.replaceState({}, "", location.pathname);
  }
}

async function boot() {
  if (!token) return;
  try {
    // /api/health 不校验登录；用 /config 验证 token，避免「假登录」后白屏
    const cfg = await api("/config");
    if (cfg.error) throw new Error(cfg.error);
    currentUser = { label: labelFromToken(token) };
    await consumeAckQuery();
    showApp();
  } catch {
    logout(true);
  }
}

function renderView(view) {
  if (view !== "detail") detailId = null;
  if (view !== "events") selectedIds = new Set();
  currentView = view;
  document.querySelectorAll(".tab-bar button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.getElementById("fab-add").style.display = (view === "events" || view === "today") ? "grid" : "none";
  const el = document.getElementById("app-content");
  if (view === "today") renderToday(el);
  else if (view === "events") renderEvents(el);
  else if (view === "detail") renderDetail(el, detailId);
  else if (view === "subscribe") renderSubscribe(el);
  else if (view === "settings") renderSettings(el);
}

function openDetail(id) {
  if (!id) return;
  detailId = id;
  renderView("detail");
}

async function renderToday(el) {
  el.innerHTML = skeletonBlocks(3);
  const [dash, cfg] = await Promise.all([api("/dashboard"), api("/config")]);
  if (dash.error) { el.innerHTML = `<div class="empty-state"><p>${esc(dash.error)}</p></div>`; return; }
  const pending = dash.pending || dash.today || [];
  const done = dash.done || [];
  const grouped = groupPending(pending);
  const total = pending.length + done.length;
  const pct = total ? Math.round((done.length / total) * 100) : 0;
  const feishuOn = !!cfg.feishu?.enabled;
  const botOn = !!cfg.feishu?.bot_configured;
  const hideHint = localStorage.getItem(HINT_KEY) === "1";
  const subtitle = pending.length
    ? `还有 ${pending.length} 件 · 飞书卡片点「已收到」确认`
    : (done.length ? "今天都搞定了" : "今天没有待办，留白也好");

  let hint = "";
  if (!hideHint) {
    if (!feishuOn) {
      hint = `<div class="hint-banner" id="feishu-hint">要收到推送，请到「设置」打开飞书 Webhook。<button type="button" class="hint-dismiss" data-dismiss-hint aria-label="关闭提示">关闭</button></div>`;
    } else {
      hint = `<div class="hint-banner soft" id="feishu-hint">在飞书回复或点卡片「已收到」确认；问答可私聊机器人。误点可在下方已确认里撤销。<button type="button" class="hint-dismiss" data-dismiss-hint aria-label="关闭提示">知道了</button></div>`;
    }
  }

  el.innerHTML = `
    <div class="hero today-hero">
      <div>
        <div class="eyebrow">${esc(formatDateCN(dash.date))}</div>
        <h2>今日</h2>
        <p class="sub">${esc(subtitle)}</p>
      </div>
      ${!feishuOn ? `<span class="badge fail">飞书未启用</span>` : botOn ? `<span class="badge ok">飞书机器人</span>` : `<span class="badge ok">飞书推送</span>`}
    </div>
    ${total ? `
      <div class="progress-wrap" aria-label="今日进度">
        <div class="progress-meta"><span>已确认 ${done.length}/${total}</span><span>${pct}%</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>` : ""}
    ${hint}
    <div class="today-list">
      ${grouped.length ? grouped.map((r, i) => pendingCard(r, i)).join("") : `
        <div class="empty-done">
          <div class="empty-ico" aria-hidden="true">✓</div>
          <p>${done.length ? "今天都搞定了" : "今天没有待办"}</p>
          <p class="form-hint">可在「清单」添加习惯或待办</p>
        </div>`}
    </div>
    ${done.length ? `
      <details class="done-fold"${pending.length ? "" : " open"}>
        <summary>已确认 · ${done.length}</summary>
        <div class="done-list">${done.map((r) => doneCard(r)).join("")}</div>
      </details>` : ""}
    ${(dash.upcoming || []).length ? `
      <div class="section-title soft"><h3>即将到来</h3></div>
      <div class="upcoming-list">${dash.upcoming.map((r) => upcomingRow(r)).join("")}</div>` : ""}
  `;
  el.querySelectorAll("[data-dismiss-hint]").forEach((b) => {
    b.onclick = () => {
      localStorage.setItem(HINT_KEY, "1");
      document.getElementById("feishu-hint")?.remove();
    };
  });
  el.querySelectorAll("[data-open]").forEach((n) => {
    n.addEventListener("click", (e) => {
      if (e.target.closest("[data-unack]")) return;
      openDetail(+n.dataset.open);
    });
  });
  el.querySelectorAll("[data-unack]").forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const id = +b.dataset.unack;
      const r = await api("/events/" + id + "/unack", {
        method: "POST",
        body: JSON.stringify({ date: dash.date })
      });
      toast(r.error || "已撤销确认");
      renderToday(el);
    };
  });
}

function pendingCard(r, idx = 0) {
  const space = r.space || "habit";
  const count = r._count > 1 ? `<span class="badge soft-count">×${r._count}</span>` : "";
  const msg = cleanText(r.message || "");
  return `<article class="action-card ${esc(space)} ${esc(r.type || "")}" data-open="${r.eventId || ""}" style="animation-delay:${Math.min(idx, 8) * 40}ms">
    <div class="action-rail" aria-hidden="true"></div>
    <div class="action-main">
      <div class="action-top">
        <h3>${esc(r.name || "")}${count}</h3>
        ${spaceBadge(space)}
      </div>
      <p class="action-meta">${r.time ? esc(r.time) + " · " : ""}${esc(typeLabel(r.type))}</p>
      ${msg ? `<p class="action-body">${esc(msg)}</p>` : ""}
      <p class="action-go">查看详情</p>
    </div>
  </article>`;
}
function doneCard(r) {
  return `<div class="done-row" data-open="${r.eventId || ""}">
    <span class="done-check" aria-hidden="true">✓</span>
    <div class="done-main">
      <div class="done-name">${esc(r.name || "")}${r.archived ? `<span class="badge">已归档</span>` : ""}</div>
      <div class="form-hint">${esc(cleanText(r.message || ""))}</div>
    </div>
    <button type="button" class="btn-secondary btn-small" data-unack="${r.eventId || ""}" aria-label="撤销确认">撤销</button>
  </div>`;
}
function upcomingRow(r) {
  return `<button type="button" class="upcoming-row" data-open="${r.eventId || ""}">
    <span>${esc(r.name || "")}</span>
    <span class="form-hint">${r.days != null ? r.days + " 天后" : ""}</span>
  </button>`;
}

async function renderEvents(el) {
  el.innerHTML = skeletonBlocks(4);
  const events = await api("/events");
  if (!Array.isArray(events)) { el.innerHTML = `<div class="empty-state"><p>${esc(events.error)}</p></div>`; return; }
  const enabled = events.filter((e) => e.enabled);
  const counts = { habit: 0, moment: 0, task: 0 };
  enabled.forEach((e) => { counts[spaceOf(e)] = (counts[spaceOf(e)] || 0) + 1; });
  const filtered = enabled.filter((e) => spaceOf(e) === spaceFilter && !e.archived);
  const disabled = events.filter((e) => !e.enabled && !e.archived && spaceOf(e) === spaceFilter);
  const archived = events.filter((e) => e.archived && spaceOf(e) === spaceFilter);

  el.innerHTML = `
    <div class="hero">
      <div>
        <div class="eyebrow">清单</div>
        <h2>${SPACE_META[spaceFilter].label}</h2>
        <p class="sub">${esc(SPACE_META[spaceFilter].hint)} · 共 ${filtered.length} 项</p>
      </div>
      <button class="btn-secondary btn-small" id="toggle-batch" type="button">批量</button>
    </div>
    <div class="segment" role="tablist" aria-label="清单空间">
      ${["habit", "moment", "task"].map((k) => `
        <button type="button" class="seg ${spaceFilter === k ? "active" : ""}" data-space="${k}" role="tab" aria-selected="${spaceFilter === k}">
          ${SPACE_META[k].label}<span class="seg-count">${counts[k] || 0}</span>
        </button>`).join("")}
    </div>
    <div class="batch-bar" id="batch-bar">
      <span class="form-hint">已选 <strong id="sel-count">0</strong></span>
      <button class="btn-danger btn-small" id="batch-del" type="button">删除</button>
    </div>
    <div class="card-grid" id="event-grid">
      ${filtered.length ? filtered.map((ev) => eventCard(ev)).join("") : `<div class="empty-panel">还没有${SPACE_META[spaceFilter].label}，点右下角新增</div>`}
    </div>
    ${disabled.length ? `
      <div class="section-title soft" style="margin-top:1.3rem"><h3>已停用</h3></div>
      <div class="card-grid">${disabled.map((ev) => eventCard(ev)).join("")}</div>` : ""}
    ${archived.length ? `
      <div class="section-title soft" style="margin-top:1.3rem"><h3>已归档</h3></div>
      <div class="card-grid">${archived.map((ev) => eventCard(ev)).join("")}</div>` : ""}
  `;
  el.querySelectorAll("[data-space]").forEach((b) => {
    b.onclick = () => {
      spaceFilter = b.dataset.space;
      createSpaceHint = spaceFilter;
      renderEvents(el);
    };
  });
  let batchMode = false;
  const bar = document.getElementById("batch-bar");
  document.getElementById("toggle-batch").onclick = () => {
    batchMode = !batchMode;
    bar.classList.toggle("show", batchMode);
    document.getElementById("toggle-batch").textContent = batchMode ? "完成" : "批量";
    if (!batchMode) { selectedIds = new Set(); syncChecks(); }
  };
  const syncChecks = () => {
    const c = document.getElementById("sel-count");
    if (c) c.textContent = String(selectedIds.size);
    el.querySelectorAll(".sel-box").forEach((box) => { box.checked = selectedIds.has(+box.dataset.id); });
  };
  el.querySelectorAll(".sel-box").forEach((box) => {
    box.onclick = (e) => {
      e.stopPropagation();
      const id = +box.dataset.id;
      if (box.checked) selectedIds.add(id); else selectedIds.delete(id);
      syncChecks();
    };
  });
  el.querySelectorAll("[data-open]").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.classList.contains("sel-box")) return;
      if (batchMode) {
        const id = +card.dataset.open;
        if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
        syncChecks();
        return;
      }
      openDetail(+card.dataset.open);
    });
  });
  document.getElementById("batch-del").onclick = async () => {
    if (!selectedIds.size) return toast("请先选择");
    if (!confirm(`删除选中的 ${selectedIds.size} 项？`)) return;
    const r = await api("/events/batch-delete", { method: "POST", body: JSON.stringify({ ids: [...selectedIds] }) });
    toast(r.error || `已删除 ${r.deleted} 项`);
    selectedIds = new Set();
    renderEvents(el);
  };
}

function eventCard(ev) {
  const space = spaceOf(ev);
  return `<article class="nudge-card clickable space-${space} ${esc(ev.type)}" data-open="${ev.id}">
    <div class="rail"></div>
    <div class="card-top">
      <div class="title">${esc(ev.name)}</div>
      <div class="badge-row">${spaceBadge(space)}${ev.archived ? `<span class="badge">已归档</span>` : ev.enabled ? "" : `<span class="badge">停用</span>`}</div>
    </div>
    <div class="meta">${esc(scheduleMeta(ev))}</div>
    <div class="card-foot">
      <label class="check-wrap" onclick="event.stopPropagation()">
        <input type="checkbox" class="sel-box" data-id="${ev.id}" ${selectedIds.has(ev.id) ? "checked" : ""}>
        <span class="form-hint">选</span>
      </label>
      <span class="form-hint">详情 →</span>
    </div>
  </article>`;
}

function periodPhaseLabel(f) {
  if (!f) return "待记录";
  if (f.overdue) return "可能推迟";
  if (f.in_period) return `经期中 · 第 ${f.day_in_cycle} 天`;
  if (f.in_ovulation) return "易孕期附近";
  return "周期中";
}

function periodConfidenceLabel(level) {
  return ({ high: "较高", medium: "中等", low: "偏低" })[level] || "偏低";
}

function periodForecastHTML(period) {
  if (!period) return "";
  const f = period.forecast;
  const hist = period.history || [];
  if (!f) {
    return `
      <div class="nudge-card span-2 period-forecast">
        <div class="section-title"><h3>预测</h3></div>
        <p class="form-hint">还没有经期开始记录。点「今天开始了」记一次后，即可预测下次日期。</p>
      </div>`;
  }
  const nextShort = String(f.next_start || "").slice(5);
  const daysHint = f.days_to_next === 0 ? "就是今天" : `还有 ${f.days_to_next} 天`;
  const histRows = hist.length
    ? hist.map((h) => `
        <div class="period-hist-row">
          <span>${esc(h.start)}</span>
          <span class="form-hint">${h.gap_days != null ? `间隔 ${h.gap_days} 天` : "起始记录"}</span>
        </div>`).join("")
    : `<p class="form-hint">暂无历史。每次点「今天开始了」会记一笔。</p>`;
  return `
    <div class="nudge-card span-2 period-forecast">
      <div class="section-title">
        <h3>预测</h3>
        <span class="badge ${f.confidence === "high" ? "ok" : ""}">可信度 ${periodConfidenceLabel(f.confidence)}</span>
      </div>
      <div class="forecast-grid">
        <div class="forecast-cell">
          <div class="label">下次预计</div>
          <div class="num">${esc(nextShort || "—")}</div>
          <div class="hint">${esc(daysHint)}</div>
        </div>
        <div class="forecast-cell">
          <div class="label">平均周期</div>
          <div class="num">${esc(String(f.cycle_length || 28))}</div>
          <div class="hint">天 · 经期约 ${esc(String(f.period_length || 5))} 天</div>
        </div>
        <div class="forecast-cell">
          <div class="label">当前阶段</div>
          <div class="num phase">${esc(periodPhaseLabel(f))}</div>
          <div class="hint">波动约 ±${esc(String(f.variance || 3))} 天</div>
        </div>
      </div>
      <p class="form-hint" style="margin-top:.75rem">基于 ${esc(String(f.history_count || 0))} 次记录；多记几次「今天开始了」会更准。</p>
    </div>
    <div class="nudge-card">
      <div class="section-title"><h3>最近记录</h3></div>
      ${histRows}
    </div>`;
}

async function renderDetail(el, id) {
  el.innerHTML = `<div class="empty-state"><p>加载中…</p></div>`;
  const res = await api("/events/" + id + "/detail");
  if (res.error || !res.item) { el.innerHTML = `<div class="empty-state"><p>${esc(res.error || "未找到")}</p></div>`; return; }
  const ev = res.item;
  const hist = res.push_history || [];
  const space = spaceOf(ev);
  el.innerHTML = `
    <button class="btn-secondary btn-small" id="back-events" type="button" style="margin-bottom:.8rem">← 返回清单</button>
    <div class="detail-hero ${esc(ev.type)} space-${space}">
      <div class="eyebrow">${SPACE_META[space].label}${ev.subtype ? " · " + esc(ev.subtype) : ""}</div>
      <h2>${esc(ev.name)}</h2>
      <p class="form-hint">${esc(scheduleMeta(ev))}</p>
      ${res.check ? `<p class="detail-msg">${esc(res.check.message)}</p>` : `<p class="form-hint" style="margin-top:.55rem">当前未到触发条件</p>`}
    </div>
    <div class="card-grid">
      ${ev.type === "period" ? periodForecastHTML(res.period) : ""}
      <div class="nudge-card">
        <div class="section-title"><h3>操作</h3></div>
        <div class="action-btns">
          ${ev.type === "period" ? `<button class="btn-secondary btn-small" id="period-log" type="button">今天开始了</button>` : ""}
          <button class="btn-secondary btn-small" id="edit-item" type="button">编辑</button>
          ${ev.archived ? `<button class="btn-secondary btn-small" id="restore-item" type="button">取消归档</button>` : `<button class="btn-secondary btn-small" id="toggle-item" type="button">${ev.enabled ? "停用" : "启用"}</button>`}
          <button class="btn-secondary btn-small" id="unack-item" type="button">撤销今日确认</button>
          <button class="btn-danger btn-small" id="delete-item" type="button">删除</button>
        </div>
        <p class="form-hint" style="margin-top:10px">确认请在飞书卡片点「已收到」。待办确认后会归档。保存不会立刻推送。</p>
      </div>
      <div class="nudge-card">
        <div class="section-title"><h3>推送记录</h3></div>
        ${hist.length ? hist.map(timelineRow).join("") : `<div class="empty-state"><p>还没有推送记录</p></div>`}
      </div>
    </div>
  `;
  document.getElementById("back-events").onclick = () => renderView("events");
  document.getElementById("edit-item").onclick = () => showEventForm(ev.id);
  const toggleBtn = document.getElementById("toggle-item");
  if (toggleBtn) {
    toggleBtn.onclick = async () => {
      await api("/events/" + ev.id, { method: "PUT", body: JSON.stringify({ ...ev, enabled: !ev.enabled }) });
      toast(ev.enabled ? "已停用" : "已启用");
      openDetail(ev.id);
    };
  }
  const restoreBtn = document.getElementById("restore-item");
  if (restoreBtn) {
    restoreBtn.onclick = async () => {
      await api("/events/" + ev.id, {
        method: "PUT",
        body: JSON.stringify({ ...ev, archived: false, enabled: true, archived_at: null })
      });
      toast("已取消归档");
      openDetail(ev.id);
    };
  }
  document.getElementById("unack-item").onclick = async () => {
    const r = await api("/events/" + ev.id + "/unack", { method: "POST", body: "{}" });
    toast(r.error || "已撤销今日确认");
    openDetail(ev.id);
  };
  document.getElementById("delete-item").onclick = async () => {
    if (!confirm("确定删除？")) return;
    await api("/events/" + ev.id, { method: "DELETE" });
    toast("已删除");
    renderView("events");
  };
  const pl = document.getElementById("period-log");
  if (pl) pl.onclick = async () => {
    const r = await api("/events/" + ev.id + "/period-log", { method: "POST", body: "{}" });
    toast(r.error || "已记录");
    openDetail(ev.id);
  };
}

function timelineRow(h) {
  return `<div class="timeline-item">
    <div class="dot ${h.status === "success" ? "ok" : "fail"}"></div>
    <div>
      <div style="font-weight:650;font-size:.9rem">${esc(h.card_preview || h.channel)}</div>
      <div class="form-hint">${esc(h.sent_at || "")} · ${esc(h.channel)} · ${esc(h.status)}${h.error ? " · " + esc(h.error) : ""}</div>
    </div>
  </div>`;
}

async function renderSubscribe(el) {
  el.innerHTML = `<div class="empty-state"><p>加载中…</p></div>`;
  const [cfg, dig] = await Promise.all([api("/config"), api("/recommend")]);
  if (cfg.error) { el.innerHTML = `<div class="empty-state"><p>${esc(cfg.error)}</p></div>`; return; }
  const d = cfg.digests || {};
  const sections = dig.digests?.sections || [];
  el.innerHTML = `
    <div class="hero">
      <div>
        <div class="eyebrow">Digest</div>
        <h2>订阅</h2>
        <p class="sub">热点与事项分开发 · 独立推送通道</p>
      </div>
    </div>
    <div class="nudge-card digest-card" style="margin-bottom:1rem">
      <div class="toggle-row"><span><strong>启用每日热点</strong></span><div class="toggle ${d.enabled !== false ? "on" : ""}" id="tog-dig"></div></div>
      <div class="form-group"><label>推送时刻</label><input id="dig-time" type="time" value="${esc(d.push_time || "20:00")}"></div>
      <p class="form-hint">到点后单独推送「Nudge · 每日热点」卡，不与事项合并。</p>
    </div>
    <div class="section-title"><h3>来源</h3></div>
    <div class="source-grid">
      <div class="nudge-card source-card digest-card">
        <div class="toggle-row">
          <div><div class="title">GitHub 热门</div><div class="desc">近期高星仓库</div></div>
          <div class="toggle ${d.github?.enabled !== false ? "on" : ""}" id="tog-gh"></div>
        </div>
      </div>
      <div class="nudge-card source-card digest-card">
        <div class="toggle-row">
          <div><div class="title">Hacker News</div><div class="desc">Frontpage</div></div>
          <div class="toggle ${d.news?.enabled !== false ? "on" : ""}" id="tog-news"></div>
        </div>
      </div>
      <div class="nudge-card source-card digest-card">
        <div class="toggle-row">
          <div><div class="title">学习推荐</div><div class="desc">主题轮换</div></div>
          <div class="toggle ${d.learning?.enabled !== false ? "on" : ""}" id="tog-learn"></div>
        </div>
      </div>
    </div>
    <button class="btn-primary btn-small" id="save-sub" type="button" style="margin:1rem 0">保存订阅</button>
    <div class="section-title"><h3>今日预览</h3></div>
    <div class="card-grid">
      ${sections.length ? sections.map((sec) => `
        <div class="nudge-card span-2 digest-card">
          <div class="section-title"><h3>${esc(sec.title)}</h3></div>
          ${(sec.items || []).slice(0, 4).map((it) => `
            <div class="preview-row">
              <div class="preview-title">${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title)}</div>
              <div class="form-hint">${esc(it.desc || it.meta || "")}</div>
            </div>`).join("") || `<div class="empty-state"><p>${esc(sec.error || "暂无")}</p></div>`}
        </div>`).join("") : `<div class="empty-panel">保存并启用源后可预览</div>`}
    </div>
  `;
  ["tog-dig", "tog-gh", "tog-news", "tog-learn"].forEach((id) => {
    document.getElementById(id).onclick = function () { this.classList.toggle("on"); };
  });
  document.getElementById("save-sub").onclick = async () => {
    const c = await api("/config");
    c.digests = {
      ...(c.digests || {}),
      enabled: document.getElementById("tog-dig").classList.contains("on"),
      push_time: document.getElementById("dig-time").value || "20:00",
      github: { enabled: document.getElementById("tog-gh").classList.contains("on") },
      news: { ...(c.digests?.news || {}), enabled: document.getElementById("tog-news").classList.contains("on") },
      learning: { ...(c.digests?.learning || {}), enabled: document.getElementById("tog-learn").classList.contains("on") }
    };
    await api("/config", { method: "PUT", body: JSON.stringify(c) });
    toast("订阅已保存");
    renderSubscribe(el);
  };
}

async function renderSettings(el) {
  el.innerHTML = `<div class="empty-state"><p>加载中…</p></div>`;
  const [config, health] = await Promise.all([api("/config"), api("/health")]);
  if (config.error) { el.innerHTML = `<div class="empty-state"><p>${esc(config.error)}</p></div>`; return; }
  el.innerHTML = `
    <div class="hero"><div><div class="eyebrow">Settings</div><h2>设置</h2><p class="sub">v${esc(health.version || "4.1")} · ${esc(health.persistence?.backend || "")}</p></div></div>
    <div class="card-grid">
      <div class="nudge-card">
        <div class="toggle-row"><span><strong>DeepSeek</strong></span><span class="badge ${config.deepseek?.configured ? "ok" : "fail"}">${config.deepseek?.configured ? "已配置" : "未配置"}</span></div>
        <p class="form-hint">问答在飞书机器人里完成。Key 仅读环境变量 DEEPSEEK_API_KEY。</p>
      </div>
      <div class="nudge-card">
        <h3 style="margin-bottom:.7rem">飞书推送（应用机器人）</h3>
        <div class="toggle-row"><span>启用飞书推送</span><div class="toggle ${config.feishu?.enabled ? "on" : ""}" id="tog-fs"></div></div>
        <div class="toggle-row">
          <span>应用凭证 FEISHU_APP_*</span>
          <span class="badge ${config.feishu?.bot_configured ? "ok" : "fail"}">${config.feishu?.bot_configured ? "已配置" : "未配置"}</span>
        </div>
        <div class="toggle-row">
          <span>推送目标 chat_id</span>
          <span class="badge ${config.feishu?.chat_id ? "ok" : "fail"}">${config.feishu?.chat_id ? "已绑定" : "未绑定"}</span>
        </div>
        <div class="form-group"><label>chat_id（可选，群里 @Nudge 会自动写入）</label><input id="fs-chat" value="${esc(config.feishu?.chat_id || "")}" placeholder="oc_xxx"></div>
        <div class="form-group"><label>Webhook（可选，旧版群自定义机器人）</label><input id="fs-url" value="${esc(config.feishu?.webhook_url || "")}" placeholder="可不填"></div>
        <div class="action-btns">
          <button class="btn-primary btn-small" id="save-fs" type="button">保存</button>
          <button class="btn-secondary btn-small" id="test-fs" type="button">连通性测试</button>
          <button class="btn-secondary btn-small" id="run-cron" type="button">立即扫描</button>
        </div>
        <p class="form-hint"><strong>无需 Webhook</strong>：企业自建应用 + 长连接即可。在目标群 @Nudge 发「绑定」自动记下 chat_id，打开「启用」后点连通性测试。</p>
        <p class="form-hint">权限需含发消息；事项卡 / 热点卡分开发。</p>
      </div>
      <div class="nudge-card">
        <h3 style="margin-bottom:.7rem">Server酱</h3>
        <div class="toggle-row"><span>启用</span><div class="toggle ${config.serverchan?.enabled ? "on" : ""}" id="tog-sc"></div></div>
        <div class="form-group"><label>SendKey</label><input id="sc-key" value="${esc(config.serverchan?.sendkey || "")}"></div>
        <button class="btn-primary btn-small" id="save-sc" type="button">保存</button>
      </div>
      <div class="nudge-card">
        <h3 style="margin-bottom:.7rem">默认时刻</h3>
        <div class="form-group"><label>未单独设置时</label><input id="def-time" type="time" value="${esc(config.default_push_time || "09:00")}"></div>
        <button class="btn-primary btn-small" id="save-sched" type="button">保存</button>
      </div>
    </div>
    <div class="nudge-card" style="margin-top:1rem">
      <h3 style="margin-bottom:.6rem">联调</h3>
      <div class="action-btns">
        <button class="btn-secondary btn-small" id="demo-load" type="button">加载测试数据</button>
        <button class="btn-primary btn-small" id="demo-run" type="button">手动推送</button>
        <button class="btn-danger btn-small" id="demo-clear" type="button">清空事项</button>
      </div>
    </div>
  `;
  ["tog-fs", "tog-sc"].forEach((id) => { document.getElementById(id).onclick = function () { this.classList.toggle("on"); }; });
  document.getElementById("save-fs").onclick = async () => {
    const c = await api("/config");
    c.feishu = {
      ...(c.feishu || {}),
      enabled: document.getElementById("tog-fs").classList.contains("on"),
      webhook_url: document.getElementById("fs-url").value.trim(),
      chat_id: document.getElementById("fs-chat").value.trim()
    };
    await api("/config", { method: "PUT", body: JSON.stringify(c) });
    toast("飞书已保存");
  };
  document.getElementById("test-fs").onclick = async () => {
    if (!confirm("发送【连通性测试】卡？不是事项提醒。")) return;
    const res = await api("/feishu/test", { method: "POST", body: JSON.stringify({
      enabled: true,
      webhook_url: document.getElementById("fs-url").value.trim(),
      chat_id: document.getElementById("fs-chat").value.trim(),
      persist: true
    }) });
    toast(res.ok ? "测试卡已发送" : (res.error || "失败"));
  };
  document.getElementById("run-cron").onclick = async () => {
    const r = await api("/cron/check");
    if (r.error) return toast(r.error);
    if (r.pushed) toast(`已推送事项 ${r.toPush || 0}` + (r.digest_pushed ? " · 热点已发" : ""));
    else toast(r.message || (`待推 ${r.toPush} · 飞书${r.feishu_enabled ? "开" : "关"}`));
  };
  document.getElementById("save-sc").onclick = async () => {
    const c = await api("/config");
    c.serverchan = { enabled: document.getElementById("tog-sc").classList.contains("on"), sendkey: document.getElementById("sc-key").value.trim() };
    await api("/config", { method: "PUT", body: JSON.stringify(c) });
    toast("已保存");
  };
  document.getElementById("save-sched").onclick = async () => {
    const c = await api("/config");
    c.default_push_time = document.getElementById("def-time").value || "09:00";
    await api("/config", { method: "PUT", body: JSON.stringify(c) });
    toast("已保存");
  };
  document.getElementById("demo-load").onclick = async () => {
    const r = await api("/demo/load-push-test", { method: "POST", body: "{}" });
    toast(r.error || `已加载 ${r.events} 条`);
  };
  document.getElementById("demo-run").onclick = async () => {
    if (!confirm("手动推送？事项与热点会分两张卡。")) return;
    const r = await api("/push/run", { method: "POST", body: JSON.stringify({
      feishu_enabled: document.getElementById("tog-fs").classList.contains("on"),
      serverchan_enabled: document.getElementById("tog-sc").classList.contains("on"),
      webhook_url: document.getElementById("fs-url").value.trim(),
      chat_id: document.getElementById("fs-chat").value.trim(),
      sendkey: document.getElementById("sc-key").value.trim(),
      include_digest: true
    }) });
    const ok = r.items_push?.feishu?.ok || r.digest_push?.feishu?.ok || r.feishu?.ok;
    toast(r.message || (ok ? "已分通道推送" : `推送失败 · ${r.feishu?.error || ""}`));
  };
  document.getElementById("demo-clear").onclick = async () => {
    if (!confirm("清空全部事项？")) return;
    await api("/demo/clear", { method: "POST", body: "{}" });
    toast("已清空");
  };
}

function showCreatePicker() {
  const modal = openModal(`
    <div class="modal-header"><h2>新增</h2><button class="modal-close" type="button">✕</button></div>
    <p class="form-hint" style="margin-bottom:1rem">先选空间，再填详情</p>
    <div class="space-picker">
      ${["habit", "moment", "task"].map((k) => `
        <button type="button" class="space-pick" data-pick="${k}">
          <strong>${SPACE_META[k].label}</strong>
          <span>${SPACE_META[k].hint}</span>
        </button>`).join("")}
    </div>
  `, true);
  modal.querySelector(".modal-close").onclick = closeModal;
  modal.querySelectorAll("[data-pick]").forEach((b) => {
    b.onclick = () => {
      createSpaceHint = b.dataset.pick;
      closeModal();
      showEventForm(null, createSpaceHint);
    };
  });
}

function showEventForm(id, spaceHint) {
  (async () => {
    const editId = Number.isFinite(id) ? id : null;
    const events = editId != null ? await api("/events") : [];
    const ev = editId != null && Array.isArray(events) ? events.find((e) => e.id === editId) : null;
    const modal = openModal(eventFormHTML(ev, spaceHint || createSpaceHint), true);
    setupEventForm(modal, ev, spaceHint || createSpaceHint);
  })();
}

function eventFormHTML(ev, spaceHint) {
  const space = ev ? spaceOf(ev) : (spaceHint || "habit");
  const subtype = ev?.subtype || (ev?.type === "period" ? "period" : ev?.type === "birthday" ? "birthday" : "anniversary");
  const s = ev?.schedule || {};
  const m = ev?.messages || {};
  const mode = s.mode || (space === "habit" ? "daily" : space === "task" ? "daily" : "yearly");
  return `
    <div class="modal-header"><h2>${ev ? "编辑" : "新增" + SPACE_META[space].label}</h2><button class="modal-close" type="button">✕</button></div>
    <form id="event-form">
      <input type="hidden" name="space" id="field-space" value="${space}">
      ${!ev ? `
      <div class="segment compact" id="space-seg">
        ${["habit", "moment", "task"].map((k) => `<button type="button" class="seg ${space === k ? "active" : ""}" data-set-space="${k}">${SPACE_META[k].label}</button>`).join("")}
      </div>` : `<p class="form-hint" style="margin-bottom:.8rem">${SPACE_META[space].label}</p>`}
      <div id="moment-sub" class="${space === "moment" ? "" : "hidden"}">
        <div class="segment compact">
          ${["birthday", "period", "anniversary"].map((k) => `
            <button type="button" class="seg ${subtype === k ? "active" : ""}" data-subtype="${k}">${({ birthday: "生日", period: "经期", anniversary: "纪念日" })[k]}</button>`).join("")}
        </div>
        <input type="hidden" name="subtype" id="field-subtype" value="${subtype}">
      </div>
      <div id="tpl-wrap" class="${space === "habit" ? "" : "hidden"}">
        <div class="template-row" id="template-row">${HABIT_TEMPLATES.map((t) => `<button type="button" data-tpl="${t.id}">${t.label}</button>`).join("")}</div>
      </div>
      <div class="form-group"><label>名称</label><input name="name" required value="${esc(ev?.name || "")}"></div>
      <div id="fields-birthday" class="${space === "moment" && subtype === "birthday" ? "" : "hidden"}">
        <div class="form-row">
          <div class="form-group"><label>月</label><input name="month" type="number" min="1" max="12" value="${s.month || ""}"></div>
          <div class="form-group"><label>日</label><input name="day" type="number" min="1" max="31" value="${s.day || ""}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>提前（天）</label><input name="remind_ahead" type="number" min="0" value="${ev?.remind_ahead ?? 3}"></div>
          <div class="form-group"><label>推送时刻</label><input name="time" type="time" value="${s.time || "09:00"}"></div>
        </div>
      </div>
      <div id="fields-period" class="${space === "moment" && subtype === "period" ? "" : "hidden"}">
        <div class="form-group"><label>上次开始</label><input name="last_start" type="date" value="${s.last_start || ""}"></div>
        <div class="form-row">
          <div class="form-group"><label>周期</label><input name="cycle_length" type="number" value="${s.cycle_length || 28}"></div>
          <div class="form-group"><label>持续</label><input name="period_length" type="number" value="${s.period_length || 5}"></div>
        </div>
        <div class="form-group"><label>推送时刻</label><input name="time_period" type="time" value="${s.time || "09:00"}"></div>
      </div>
      <div id="fields-anni" class="${space === "moment" && subtype === "anniversary" ? "" : "hidden"}">
        <div class="form-row">
          <div class="form-group"><label>月</label><input name="month_a" type="number" value="${s.month || ""}"></div>
          <div class="form-group"><label>日</label><input name="day_a" type="number" value="${s.day || ""}"></div>
        </div>
        <div class="form-group"><label>推送时刻</label><input name="time_anni" type="time" value="${s.time || "09:00"}"></div>
        <div class="form-group"><label>提醒文案</label><input name="msg_anni" value="${esc(m.default || "")}"></div>
      </div>
      <div id="fields-habit" class="${space === "habit" || space === "task" ? "" : "hidden"}">
        <div class="form-row">
          <div class="form-group"><label>频率</label>
            <select name="mode">${["daily", "weekly", "monthly", "yearly"].map((mo) => `<option value="${mo}" ${mode === mo ? "selected" : ""}>${({ daily: "每天", weekly: "每周", monthly: "每月", yearly: "每年" })[mo]}</option>`).join("")}</select>
          </div>
          <div class="form-group"><label>推送时刻</label><input name="time_custom" type="time" value="${s.time || "08:00"}"></div>
        </div>
        <div class="form-row" id="custom-md">
          <div class="form-group"><label>月</label><input name="month_c" type="number" value="${s.month || ""}"></div>
          <div class="form-group"><label>日</label><input name="day_c" type="number" value="${s.day || ""}"></div>
        </div>
        <div class="form-group"><label>提醒文案</label><input name="msg_default" value="${esc(m.default || m.today || "")}"></div>
      </div>
      <p class="form-hint">创建后不会立刻推送；到点自动推（需启用飞书）。</p>
      <div class="form-actions">
        <button type="submit" class="btn-primary">${ev ? "保存" : "创建"}</button>
        <button type="button" class="btn-secondary" id="cancel-form">取消</button>
      </div>
    </form>`;
}

function setupEventForm(modal, ev, spaceHint) {
  const form = modal.querySelector("#event-form");
  const spaceInput = modal.querySelector("#field-space");
  modal.querySelector(".modal-close").onclick = closeModal;
  modal.querySelector("#cancel-form").onclick = closeModal;

  const syncSpaceUI = (space, subtype) => {
    spaceInput.value = space;
    modal.querySelectorAll("[data-set-space]").forEach((c) => c.classList.toggle("active", c.dataset.setSpace === space));
    modal.querySelector("#moment-sub").classList.toggle("hidden", space !== "moment");
    modal.querySelector("#tpl-wrap").classList.toggle("hidden", space !== "habit");
    const st = subtype || modal.querySelector("#field-subtype")?.value || "birthday";
    if (modal.querySelector("#field-subtype")) modal.querySelector("#field-subtype").value = st;
    modal.querySelectorAll("[data-subtype]").forEach((c) => c.classList.toggle("active", c.dataset.subtype === st));
    modal.querySelector("#fields-birthday").classList.toggle("hidden", !(space === "moment" && st === "birthday"));
    modal.querySelector("#fields-period").classList.toggle("hidden", !(space === "moment" && st === "period"));
    modal.querySelector("#fields-anni").classList.toggle("hidden", !(space === "moment" && st === "anniversary"));
    modal.querySelector("#fields-habit").classList.toggle("hidden", !(space === "habit" || space === "task"));
  };

  modal.querySelectorAll("[data-set-space]").forEach((c) => {
    c.addEventListener("click", () => syncSpaceUI(c.dataset.setSpace, c.dataset.setSpace === "moment" ? "birthday" : null));
  });
  modal.querySelectorAll("[data-subtype]").forEach((c) => {
    c.addEventListener("click", () => syncSpaceUI("moment", c.dataset.subtype));
  });
  modal.querySelectorAll("#template-row button").forEach((btn) => {
    btn.onclick = () => {
      const tpl = HABIT_TEMPLATES.find((t) => t.id === btn.dataset.tpl);
      if (!tpl) return;
      syncSpaceUI("habit");
      form.name.value = tpl.name;
      form.mode.value = tpl.mode;
      form.time_custom.value = tpl.time;
      form.msg_default.value = tpl.message;
    };
  });
  const syncMd = () => {
    const mode = form.mode?.value;
    const md = modal.querySelector("#custom-md");
    if (md) md.classList.toggle("hidden", !(mode === "monthly" || mode === "yearly"));
  };
  form.mode?.addEventListener("change", syncMd);
  syncMd();
  syncSpaceUI(spaceInput.value, modal.querySelector("#field-subtype")?.value);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const space = fd.get("space") || spaceHint || "habit";
    const subtype = space === "moment" ? (fd.get("subtype") || "birthday") : null;
    let body;
    if (space === "moment" && subtype === "birthday") {
      body = {
        space, subtype, name: fd.get("name"),
        remind_ahead: +fd.get("remind_ahead") || 0,
        schedule: { mode: "yearly", month: +fd.get("month"), day: +fd.get("day"), time: fd.get("time") || "09:00" },
        messages: {}
      };
    } else if (space === "moment" && subtype === "period") {
      body = {
        space, subtype, name: fd.get("name"),
        schedule: {
          mode: "cycle",
          last_start: fd.get("last_start") || undefined,
          cycle_length: +fd.get("cycle_length") || 28,
          period_length: +fd.get("period_length") || 5,
          time: fd.get("time_period") || "09:00",
          cycle_history: ev?.schedule?.cycle_history
        },
        messages: {}
      };
    } else if (space === "moment") {
      body = {
        space, subtype: "anniversary", name: fd.get("name"),
        schedule: { mode: "yearly", month: fd.get("month_a") ? +fd.get("month_a") : undefined, day: fd.get("day_a") ? +fd.get("day_a") : undefined, time: fd.get("time_anni") || "09:00" },
        messages: { default: fd.get("msg_anni") || undefined }
      };
    } else {
      body = {
        space, name: fd.get("name"),
        schedule: {
          mode: fd.get("mode"),
          time: fd.get("time_custom") || "08:00",
          month: fd.get("month_c") ? +fd.get("month_c") : undefined,
          day: fd.get("day_c") ? +fd.get("day_c") : undefined
        },
        messages: { default: fd.get("msg_default") || undefined }
      };
    }
    Object.keys(body.schedule).forEach((k) => body.schedule[k] == null && delete body.schedule[k]);
    const res = ev
      ? await api("/events/" + ev.id, { method: "PUT", body: JSON.stringify({ ...ev, ...body }) })
      : await api("/events", { method: "POST", body: JSON.stringify(body) });
    if (res.error) return toast(res.error);
    toast(ev ? "已保存（未推送）" : "已创建（未推送）");
    closeModal();
    if (detailId) openDetail(detailId);
    else {
      if (!ev && body.space) {
        spaceFilter = body.space;
        createSpaceHint = body.space;
      }
      renderView(currentView === "detail" ? "events" : currentView === "today" ? "today" : "events");
    }
  };
}

const loginForm = document.getElementById("login-form");
if (loginForm) loginForm.addEventListener("submit", (e) => { e.preventDefault(); login(); });
else {
  document.getElementById("login-btn").onclick = login;
  document.getElementById("login-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
}
document.getElementById("logout-btn").onclick = () => logout(true);
document.getElementById("fab-add").onclick = () => {
  if (currentView === "events") showEventForm(null, spaceFilter);
  else showCreatePicker();
};
document.getElementById("tab-bar").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (btn) renderView(btn.dataset.view);
});
boot();
