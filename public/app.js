/* Nudge v4.1.2 — Today polish + space list; ack/chat in Feishu */
const API = "/api";
const BRAND = { name: "Nudge", tagline: "轻推一下，刚好想起" };
const HINT_KEY = "nudge_hide_feishu_hint";
const VERSION_KEY = "nudge_app_version";
const SKIP_UPDATE_KEY = "nudge_skip_update";
let token = localStorage.getItem("nudge_token") || localStorage.getItem("reminder_token") || "";
let currentUser = null;
let currentView = "today";
let detailId = null;
let spaceFilter = "habit"; // habit | moment | task
let tagFilter = ""; // tag name or empty for all
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

async function forceAppUpdate(targetVersion) {
  try {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (_) { /* ignore */ }
  if (targetVersion) localStorage.setItem(VERSION_KEY, targetVersion);
  const u = new URL(location.href);
  u.searchParams.set("_t", String(Date.now()));
  location.replace(u.pathname + u.search + (u.hash || ""));
}

async function checkAndApplyUpdate() {
  const health = await api("/health");
  if (health.error || !health.version) {
    toast(health.error || "无法获取版本");
    return;
  }
  const server = String(health.version);
  const local = localStorage.getItem(VERSION_KEY) || "";
  if (local && local === server) {
    toast("已是最新 v" + server);
    return;
  }
  toast("正在更新到 v" + server + "…");
  await forceAppUpdate(server);
}

function showUpdateBanner(serverVersion) {
  if (document.getElementById("update-banner")) return;
  const bar = document.createElement("div");
  bar.id = "update-banner";
  bar.className = "update-banner";
  bar.setAttribute("role", "status");
  bar.innerHTML = `
    <span>发现新版本 v${esc(serverVersion)}</span>
    <span class="update-banner-actions">
      <button type="button" class="btn-primary btn-small" id="update-now">更新</button>
      <button type="button" class="btn-ghost btn-small" id="update-later">稍后</button>
    </span>`;
  const header = document.querySelector(".app-header");
  if (header && header.parentNode) header.insertAdjacentElement("afterend", bar);
  else document.getElementById("app").prepend(bar);
  document.getElementById("update-now").onclick = () => forceAppUpdate(serverVersion);
  document.getElementById("update-later").onclick = () => {
    sessionStorage.setItem(SKIP_UPDATE_KEY, "1");
    bar.remove();
  };
}

async function maybePromptUpdate() {
  if (sessionStorage.getItem(SKIP_UPDATE_KEY) === "1") return;
  try {
    const health = await api("/health");
    const server = health.version ? String(health.version) : "";
    if (!server) return;
    const local = localStorage.getItem(VERSION_KEY);
    if (!local) {
      localStorage.setItem(VERSION_KEY, server);
      return;
    }
    if (local !== server) showUpdateBanner(server);
  } catch (_) { /* ignore */ }
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
/* Lunar conversion (Intl API) */
const LUNAR_CN = {正:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10,十一:11,十二:12,腊:12,冬:11};
const LUNAR_MONTH_NAME = ["", "正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "冬月", "腊月"];
const LUNAR_DAY_DIGIT = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
let _lunFmt = null;
function _lunF() { if (!_lunFmt) _lunFmt = new Intl.DateTimeFormat("zh-CN-u-ca-chinese",{year:"numeric",month:"numeric",day:"numeric"}); return _lunFmt; }
function parseLunarMonthLabel(raw) {
  const s = String(raw || "").replace(/月$/, "");
  const leap = s.startsWith("闰");
  const key = leap ? s.slice(1) : s;
  return { month: LUNAR_CN[key] || 0, leap };
}
function lunarDayName(day) {
  const n = Number(day) || 0;
  if (n <= 0) return String(day || "");
  if (n <= 10) return "初" + LUNAR_DAY_DIGIT[n];
  if (n < 20) return "十" + LUNAR_DAY_DIGIT[n - 10];
  if (n === 20) return "二十";
  if (n < 30) return "廿" + LUNAR_DAY_DIGIT[n - 20];
  if (n === 30) return "三十";
  return String(n);
}
function formatLunarMD(mon, day, leap) {
  const base = LUNAR_MONTH_NAME[mon] || (mon + "月");
  return (leap ? "闰" + base : base) + lunarDayName(day);
}
function lunarToSolar(mon, day, year, leap) {
  const wantLeap = !!leap;
  const s = new Date(year, 0, 1, 12, 0, 0, 0);
  const e = new Date(year + 1, 0, 20, 12, 0, 0, 0);
  const f = _lunF();
  const d = new Date(s);
  let fallback = null;
  while (d <= e) {
    const p = f.formatToParts(d);
    let monthLabel = "";
    let ld = 0;
    for (const x of p) {
      if (x.type === "month") monthLabel = x.value;
      if (x.type === "day") ld = parseInt(x.value, 10) || 0;
    }
    const parsed = parseLunarMonthLabel(monthLabel);
    if (parsed.month === mon && ld === day) {
      const hit = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
      if (parsed.leap === wantLeap) return hit;
      if (!parsed.leap && !fallback) fallback = hit;
    }
    d.setDate(d.getDate() + 1);
  }
  return wantLeap ? fallback : null;
}
function solarToLunar(date) {
  const raw = date instanceof Date ? date : new Date(date);
  const d = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate(), 12, 0, 0, 0);
  const parts = _lunF().formatToParts(d);
  let monthLabel = "";
  let day = 0;
  for (const p of parts) {
    if (p.type === "month") monthLabel = p.value;
    if (p.type === "day") day = parseInt(p.value, 10) || 0;
  }
  const parsed = parseLunarMonthLabel(monthLabel);
  if (!parsed.month || !day) return null;
  return { month: parsed.month, day, leap: parsed.leap, label: formatLunarMD(parsed.month, day, parsed.leap) };
}
function formatSolarMD(date) {
  const d = date instanceof Date ? date : new Date(date);
  return (d.getMonth() + 1) + "月" + d.getDate() + "日";
}
function pad2(n) { return String(n).padStart(2, "0"); }
function toYMD(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
/** 统一展示：YYYY-MM-DD · 周X */
function formatDateDisplay(date, { withWeek = true } = {}) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  const ymd = toYMD(d);
  if (!withWeek) return ymd;
  const wd = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  return ymd + " · 周" + wd;
}
function parseYmdToDate(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], 12);
}
/** Birthday form value: prefer stored birth_solar, else reconstruct from lunar/solar fields. */
function birthdayBirthDateValue(ev) {
  if (ev?.birth_solar && /^\d{4}-\d{2}-\d{2}$/.test(ev.birth_solar)) return ev.birth_solar;
  const s = ev?.schedule || {};
  if (ev?.calendar === "lunar" && ev.birth_year && s.month && s.day) {
    const solar = lunarToSolar(s.month, s.day, ev.birth_year, !!s.leap_month);
    if (solar) return toYMD(solar);
  }
  if (ev?.birth_year && s.month && s.day) {
    return ev.birth_year + "-" + pad2(s.month) + "-" + pad2(s.day);
  }
  return "";
}
/** From solar YMD → lunar birthday payload fields. */
function birthdayFromSolarYmd(ymd) {
  const normalized = String(ymd || "").trim().replace(/[/.]/g, "-");
  const m = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const lun = solarToLunar(new Date(y, mo - 1, d, 12));
  if (!lun) return null;
  const birth_solar = y + "-" + pad2(mo) + "-" + pad2(d);
  return {
    birth_solar,
    birth_year: y,
    calendar: "lunar",
    lunar_month: lun.month,
    lunar_day: lun.day,
    lunar_leap: !!lun.leap,
    lunar_label: lun.label
  };
}
function iconSvg(name) {
  /* 科技感：实心几何 + 细描边，统一 18 viewBox */
  const a = 'class="ico" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"';
  if (name === "cake") return `<svg ${a}><path fill="currentColor" d="M4 13h16v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7z"/><path fill="currentColor" opacity=".35" d="M4 13c1.2 1.4 2.6 2 4 2s2.8-.6 4-2c1.2 1.4 2.6 2 4 2s2.8-.6 4-2v2.2c-1.2 1-2.6 1.5-4 1.5s-2.8-.5-4-1.5c-1.2 1-2.6 1.5-4 1.5S5.2 16.2 4 15.2V13z"/><rect fill="currentColor" x="6.2" y="7.2" width="2.2" height="4.2" rx="1.1"/><rect fill="currentColor" x="10.9" y="5.5" width="2.2" height="5.9" rx="1.1"/><rect fill="currentColor" x="15.6" y="7.2" width="2.2" height="4.2" rx="1.1"/><circle fill="currentColor" cx="7.3" cy="5.4" r="1.35"/><circle fill="currentColor" cx="12" cy="3.8" r="1.35"/><circle fill="currentColor" cx="16.7" cy="5.4" r="1.35"/></svg>`;
  if (name === "sun") return `<svg ${a}><circle fill="currentColor" cx="12" cy="12" r="4.2"/><g stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M5.1 18.9l1.6-1.6M17.3 6.7l1.6-1.6"/></g></svg>`;
  if (name === "moon") return `<svg ${a}><path fill="currentColor" d="M14.8 2.6A9.5 9.5 0 1 0 21.4 15 7.6 7.6 0 0 1 14.8 2.6z"/><circle fill="currentColor" opacity=".35" cx="9.2" cy="10.2" r="1.1"/><circle fill="currentColor" opacity=".35" cx="12.4" cy="14.8" r=".8"/></svg>`;
  if (name === "calendar") return `<svg ${a}><rect fill="currentColor" opacity=".2" x="3" y="6" width="18" height="15" rx="3"/><path fill="currentColor" d="M3 9h18v2.2H3z"/><rect fill="currentColor" x="3" y="6" width="18" height="3.2" rx="1.5"/><rect fill="currentColor" x="7" y="3" width="2" height="5" rx="1"/><rect fill="currentColor" x="15" y="3" width="2" height="5" rx="1"/><rect fill="currentColor" x="7" y="14" width="3.2" height="3.2" rx=".7"/><rect fill="currentColor" x="11.4" y="14" width="3.2" height="3.2" rx=".7"/><rect fill="currentColor" opacity=".45" x="15.8" y="14" width="3.2" height="3.2" rx=".7"/></svg>`;
  if (name === "clock") return `<svg ${a}><circle fill="currentColor" opacity=".18" cx="12" cy="12" r="9.5"/><circle fill="none" stroke="currentColor" stroke-width="2.2" cx="12" cy="12" r="8.2"/><path stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M12 7.2v5.1l3.4 2"/></svg>`;
  if (name === "heart") return `<svg ${a}><path fill="currentColor" d="M12 20.6S3.5 15.2 3.5 9.6A4.6 4.6 0 0 1 12 7.2a4.6 4.6 0 0 1 8.5 2.4C20.5 15.2 12 20.6 12 20.6z"/><path fill="#fff" opacity=".35" d="M8.2 8.4c1.4-.9 2.8-.3 3.4.6.4-.8 1.7-1.7 3.3-1.1-1.7.2-2.7 1.3-3.1 2.4-.6-1.2-1.9-2-3.6-1.9z"/></svg>`;
  if (name === "chip") return `<svg ${a}><rect fill="currentColor" opacity=".2" x="6" y="6" width="12" height="12" rx="2"/><rect fill="currentColor" x="8" y="8" width="8" height="8" rx="1.2"/><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M9 3.5v2.2M12 3.5v2.2M15 3.5v2.2M9 18.3v2.2M12 18.3v2.2M15 18.3v2.2M3.5 9h2.2M3.5 12h2.2M3.5 15h2.2M18.3 9h2.2M18.3 12h2.2M18.3 15h2.2"/></svg>`;
  return "";
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
  return sortPendingItems([...map.values()]);
}

/** Client-side mirror of server sortDashboardPending. */
function sortPendingItems(list) {
  const rank = (r) => {
    if (r.type === "period") return r.urgent || r.care?.phase === "period" ? 0 : 1;
    if (r.type === "birthday") return 2;
    if (r.urgent) return 3;
    if (r.space === "task") return 4;
    if (r.space === "moment") return 5;
    return 6;
  };
  return [...(list || [])].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d) return d;
    return String(a.time || "99:99").localeCompare(String(b.time || "99:99"));
  });
}
function closeModal(opts = {}) {
  const had = !!document.querySelector(".modal-overlay");
  document.querySelectorAll(".modal-overlay").forEach((m) => m.remove());
  if (had && !opts.fromPop && history.state && history.state.nudge === "modal") {
    navSilent = true;
    history.back();
  }
  syncChrome();
}
function openModal(html, center = false) {
  closeModal({ fromPop: true });
  const o = document.createElement("div");
  o.className = "modal-overlay" + (center ? " center" : " sheet");
  o.innerHTML = `<div class="modal-content"><div class="modal-grab" aria-hidden="true"></div>${html}</div>`;
  o.addEventListener("click", (e) => { if (e.target === o) closeModal(); });
  document.body.appendChild(o);
  history.pushState({ nudge: "modal" }, "");
  syncChrome();
  return o.querySelector(".modal-content");
}

let navSilent = false;
function syncChrome() {
  const back = document.getElementById("nav-back");
  const brand = document.getElementById("brand-block");
  const hasModal = !!document.querySelector(".modal-overlay");
  const onDetail = currentView === "detail";
  const showBack = hasModal || onDetail;
  if (back) back.classList.toggle("hidden", !showBack);
  if (brand) brand.classList.toggle("compact", showBack);
  document.body.classList.toggle("has-overlay", hasModal);
}
function goBackInApp() {
  if (document.querySelector(".modal-overlay")) {
    closeModal();
    return true;
  }
  if (currentView === "detail") {
    if (history.state && history.state.nudge === "detail") {
      navSilent = true;
      history.back();
    }
    detailId = null;
    renderView("events");
    syncChrome();
    return true;
  }
  return false;
}
function setupNavigation() {
  window.addEventListener("popstate", () => {
    if (navSilent) {
      navSilent = false;
      syncChrome();
      return;
    }
    if (document.querySelector(".modal-overlay")) {
      document.querySelectorAll(".modal-overlay").forEach((m) => m.remove());
      syncChrome();
      return;
    }
    if (currentView === "detail") {
      detailId = null;
      renderView("events");
      syncChrome();
    }
  });
  const backBtn = document.getElementById("nav-back");
  if (backBtn) backBtn.onclick = () => goBackInApp();
  // Capacitor / Android：有历史时先退应用内；根页不主动 exitApp
  try {
    const CapApp = window.Capacitor?.Plugins?.App;
    if (CapApp?.addListener) {
      CapApp.addListener("backButton", () => {
        if (goBackInApp()) return;
        if (history.state && history.state.nudge) {
          history.back();
          return;
        }
        // 停留在今日/清单，避免一按就退出
      });
    }
  } catch (_) { /* ignore */ }
}
function scheduleMeta(ev) {
  const s = ev.schedule || {};
  const mode = { daily: "每天", weekly: "每周", monthly: "每月", yearly: "每年", cycle: "周期" }[s.mode] || "";
  const bits = [SPACE_META[spaceOf(ev)]?.label, mode, s.time].filter(Boolean);
  const next = nextOccurrence(ev);
  if (next) {
    if (next.anchorLabel) bits.push(next.anchorLabel);
    bits.push(next.days === 0 ? "就是今天" : "剩" + next.days + "天");
    if (next.pairLabel) bits.push(next.pairLabel);
    if (next.age != null) bits.push(next.age + "岁");
  }
  return bits.join(" · ");
}

/** Next occurrence for yearly/monthly (and period via forecastDays). */
function nextOccurrence(ev, forecastDays) {
  const s = ev.schedule || {};
  const now = new Date();
  const curY = now.getFullYear();
  const isLunar = ev.calendar === "lunar";
  let t = null;
  let cycle = 365;
  if (s.mode === "yearly" && s.month && s.day) {
    if (isLunar) {
      const leap = !!s.leap_month;
      t = lunarToSolar(s.month, s.day, curY, leap);
      if (!t) t = new Date(curY, s.month - 1, s.day);
      if (t < now) {
        const t2 = lunarToSolar(s.month, s.day, curY + 1, leap);
        t = t2 || new Date(curY + 1, s.month - 1, s.day);
      }
    } else {
      t = new Date(curY, s.month - 1, s.day);
      if (t < now) t = new Date(curY + 1, s.month - 1, s.day);
    }
    cycle = 366;
  } else if (s.mode === "monthly" && s.day) {
    t = new Date(now.getFullYear(), now.getMonth(), s.day);
    if (t < now) t = new Date(now.getFullYear(), now.getMonth() + 1, s.day);
    cycle = 31;
  } else if (s.mode === "daily") {
    t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    cycle = 1;
  } else if (s.mode === "cycle" && forecastDays != null && Number.isFinite(forecastDays)) {
    t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + forecastDays);
    cycle = 28;
  }
  if (!t) return null;
  const days = Math.max(0, Math.ceil((t - now) / 86400000));
  const wd = ["日", "一", "二", "三", "四", "五", "六"][t.getDay()];
  const nextLabel = formatSolarMD(t) + " 周" + wd;
  let age = null;
  if ((ev.type === "birthday" || ev.subtype === "birthday") && ev.birth_year) {
    age = t.getFullYear() - ev.birth_year;
  }
  const progress = Math.min(1, Math.max(0, 1 - days / cycle));

  let anchorLabel = "";
  let pairLabel = "";
  let solarText = formatSolarMD(t);
  let lunarText = "";
  if (s.mode === "yearly" && s.month && s.day) {
    if (isLunar) {
      lunarText = formatLunarMD(s.month, s.day, !!s.leap_month);
      anchorLabel = "农历" + lunarText;
      pairLabel = "阳历" + solarText;
    } else {
      solarText = s.month + "月" + s.day + "日";
      const lun = solarToLunar(t);
      lunarText = lun ? lun.label : "";
      anchorLabel = "阳历" + solarText;
      pairLabel = lunarText ? "农历" + lunarText : "";
    }
  } else if (s.mode === "monthly" && s.day) {
    anchorLabel = "每月" + s.day + "日";
  }

  return {
    days, nextLabel, age, progress, date: t,
    isLunar, anchorLabel, pairLabel, solarText, lunarText,
    yearlySameSolar: s.mode === "yearly" && !isLunar
  };
}

function countdownHeroHTML(ev, check, forecastDays, forecast) {
  const next = nextOccurrence(ev, forecastDays);
  const inPeriod = ev.type === "period" && forecast?.in_period;
  const periodLen = forecast?.period_length || 5;
  const urgent = inPeriod || (next && next.days <= 3);
  const today = inPeriod || (next && next.days === 0);
  const r = 54;
  const c = 2 * Math.PI * r;
  let progress = next ? next.progress : 0;
  let daysText = !next ? "—" : today && !inPeriod ? "今" : String(next.days);
  let unit = !next ? "" : "天";
  if (inPeriod) {
    daysText = String(forecast.day_in_cycle);
    unit = `/${periodLen}`;
    progress = Math.min(1, (forecast.day_in_cycle || 1) / periodLen);
  }
  const dash = (progress * c).toFixed(1);
  const status = check
    ? `<p class="detail-status is-active">${esc(check.message)}</p>`
    : `<p class="detail-status">当前未到触发条件</p>`;

  const isBday = ev.type === "birthday" || ev.subtype === "birthday";
  const fun = birthdayFunFacts(ev, next);
  const chips = [];
  if (ev.type === "period") chips.push(`<span class="detail-chip with-icon">${iconSvg("heart")}经期</span>`);
  if (inPeriod) chips.push(`<span class="detail-chip">第 ${forecast.day_in_cycle} 天</span>`);
  if (isBday) chips.push(`<span class="detail-chip with-icon">${iconSvg("cake")}生日</span>`);
  if (next?.age != null) chips.push(`<span class="detail-chip">${next.age}岁</span>`);
  if (fun) {
    chips.push(`<span class="detail-chip">${fun.west.sym} ${fun.west.name}</span>`);
    chips.push(`<span class="detail-chip">${fun.east.emoji} 属${fun.east.name}</span>`);
  }
  if (next?.isLunar) chips.push(`<span class="detail-chip with-icon">${iconSvg("moon")}农历</span>`);
  else if (ev.schedule?.mode === "yearly") chips.push(`<span class="detail-chip with-icon">${iconSvg("sun")}阳历</span>`);

  let dateBlock = `<p class="detail-next">${!next ? "暂无下次日期" : today && !inPeriod ? "就是今天" : "下次 " + next.nextLabel}</p>`;
  if (inPeriod) {
    dateBlock = `<p class="detail-next">经期中 · 第 ${esc(String(forecast.day_in_cycle))} / ${esc(String(periodLen))} 天</p>
      <p class="detail-next-note">这几天会每天推送关怀内容</p>`;
  } else if (next && ev.schedule?.mode === "yearly" && (next.solarText || next.lunarText)) {
    if (next.isLunar) {
      let birthSolarRow = "";
      const birthYmd = birthdayBirthDateValue(ev);
      if (birthYmd) {
        birthSolarRow = `
        <div class="cal-row">
          <span class="cal-ico">${iconSvg("sun")}</span>
          <span class="cal-k">出生阳历</span>
          <span class="cal-v mono">${esc(birthYmd)}</span>
        </div>`;
      }
      dateBlock = `
      <div class="cal-pair">
        <div class="cal-row">
          <span class="cal-ico">${iconSvg("moon")}</span>
          <span class="cal-k">农历生日</span>
          <span class="cal-v">${esc(next.lunarText)} · 每年固定</span>
        </div>
        ${birthSolarRow}
        <div class="cal-row highlight">
          <span class="cal-ico">${iconSvg("sun")}</span>
          <span class="cal-k">下次阳历</span>
          <span class="cal-v mono">${esc(formatDateDisplay(next.date))}</span>
        </div>
      </div>
      <p class="detail-next-note">按农历过：农历月日固定，每年阳历会变</p>`;
    } else {
      let birthLunarRow = "";
      if (ev.birth_year && ev.schedule?.month && ev.schedule?.day) {
        const born = new Date(ev.birth_year, ev.schedule.month - 1, ev.schedule.day, 12);
        const bornLun = solarToLunar(born);
        if (bornLun) {
          birthLunarRow = `
        <div class="cal-row highlight">
          <span class="cal-ico">${iconSvg("moon")}</span>
          <span class="cal-k">出生年农历</span>
          <span class="cal-v">${esc(bornLun.label)} · ${esc(String(ev.birth_year))}</span>
        </div>`;
        }
      }
      dateBlock = `
      <div class="cal-pair">
        <div class="cal-row">
          <span class="cal-ico">${iconSvg("sun")}</span>
          <span class="cal-k">阳历生日</span>
          <span class="cal-v mono">${esc(formatDateDisplay(next.date, { withWeek: false }))} · 每年固定</span>
        </div>
        ${birthLunarRow}
        <div class="cal-row">
          <span class="cal-ico">${iconSvg("moon")}</span>
          <span class="cal-k">下次农历</span>
          <span class="cal-v">${esc(next.lunarText || "—")} · ${esc(String(next.date.getFullYear()))}</span>
        </div>
      </div>
      <p class="detail-next-note">当前按阳历每年同日。可改为按农历过（推荐）</p>
      <button class="btn-action is-primary btn-migrate-lunar" id="migrate-lunar" type="button">改为按农历过</button>`;
    }
  }

  return `
    <div class="detail-countdown ${urgent ? "is-urgent" : ""} ${today ? "is-today" : ""}" aria-label="倒计时">
      <svg class="countdown-ring" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="ring-track" cx="60" cy="60" r="${r}" />
        <circle class="ring-progress" cx="60" cy="60" r="${r}"
          style="--ring-len:${c}; --ring-dash:${dash}" />
      </svg>
      <div class="countdown-core">
        <span class="countdown-num">${daysText}</span>
        <span class="countdown-unit">${unit}</span>
      </div>
    </div>
    <div class="detail-copy">
      <div class="detail-chips">${chips.join("")}</div>
      ${dateBlock}
      ${status}
    </div>`;
}

/** Build next N years of lunar↔solar birthday mappings for the chart. */
function yearCalendarRows(ev, years = 8) {
  const s = ev.schedule || {};
  if (s.mode !== "yearly" || !s.month || !s.day) return [];
  const isLunar = ev.calendar === "lunar";
  const now = new Date();
  const startY = now.getFullYear();
  const rows = [];
  for (let i = 0; i < years; i++) {
    const y = startY + i;
    let solar;
    let lunarLabel;
    if (isLunar) {
      solar = lunarToSolar(s.month, s.day, y, !!s.leap_month);
      if (!solar) continue;
      lunarLabel = formatLunarMD(s.month, s.day, !!s.leap_month);
    } else {
      solar = new Date(y, s.month - 1, s.day);
      const lun = solarToLunar(solar);
      lunarLabel = lun ? lun.label : "—";
    }
    const wd = ["日", "一", "二", "三", "四", "五", "六"][solar.getDay()];
    const past = solar < now && !(solar.toDateString() === now.toDateString());
    let age = null;
    if ((ev.type === "birthday" || ev.subtype === "birthday") && ev.birth_year) {
      age = y - ev.birth_year;
    }
    rows.push({
      year: y,
      solar,
      solarLabel: formatDateDisplay(solar),
      lunarLabel,
      month: solar.getMonth() + 1,
      past,
      age,
      isNext: false
    });
  }
  let marked = false;
  for (const r of rows) {
    if (!r.past && !marked) { r.isNext = true; marked = true; }
  }
  return rows;
}

function zodiacWestern(month, day) {
  const md = month * 100 + day;
  const table = [
    [120, "摩羯座", "♑"], [219, "水瓶座", "♒"], [320, "双鱼座", "♓"],
    [420, "白羊座", "♈"], [521, "金牛座", "♉"], [621, "双子座", "♊"],
    [722, "巨蟹座", "♋"], [823, "狮子座", "♌"], [923, "处女座", "♍"],
    [1023, "天秤座", "♎"], [1122, "天蝎座", "♏"], [1222, "射手座", "♐"], [1231, "摩羯座", "♑"]
  ];
  for (const [end, name, sym] of table) {
    if (md <= end) return { name, sym };
  }
  return { name: "摩羯座", sym: "♑" };
}

function zodiacChinese(year) {
  const animals = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"];
  const emoji = ["🐭", "🐮", "🐯", "🐰", "🐲", "🐍", "🐴", "🐑", "🐵", "🐔", "🐶", "🐷"];
  const idx = ((year - 1900) % 12 + 12) % 12;
  return { name: animals[idx], emoji: emoji[idx] };
}

function wuxingOfYear(year) {
  const stems = ["金", "金", "水", "水", "木", "木", "火", "火", "土", "土"];
  return stems[((year % 10) + 10) % 10];
}

const ZODIAC_PROFILES = {
  "白羊座": {
    tag: "行动派", element: "火象",
    blurb: "热情直球，想到就干。适合当冲锋的人，讨厌拖泥带水；记得给自己留一点喘息。",
    keywords: ["勇敢", "直率", "开创"]
  },
  "金牛座": {
    tag: "踏实派", element: "土象",
    blurb: "讲究质感与稳定，一旦认定就不轻易变。慢热但可靠，享受把日子过成仪式感。",
    keywords: ["稳重", "品味", "坚持"]
  },
  "双子座": {
    tag: "灵光派", element: "风象",
    blurb: "好奇心旺盛，脑子转得快，聊天能聊一整天。信息量很大，适合多线并行的生活。",
    keywords: ["聪慧", "多变", "表达"]
  },
  "巨蟹座": {
    tag: "守护派", element: "水象",
    blurb: "重感情、护短，家与关系是安全感来源。外表柔和，内心其实很有主见。",
    keywords: ["体贴", "直觉", "忠诚"]
  },
  "狮子座": {
    tag: "光芒派", element: "火象",
    blurb: "天生有舞台感，喜欢被看见也被信任。大方、有领导欲，也需要真诚的欣赏。",
    keywords: ["自信", "热情", "气场"]
  },
  "处女座": {
    tag: "精致派", element: "土象",
    blurb: "眼里容不得潦草，细节控到骨子里。标准高不是挑剔，是认真对待人和事。",
    keywords: ["细致", "理性", "完美"]
  },
  "天秤座": {
    tag: "平衡派", element: "风象",
    blurb: "在意和谐与美感，擅长协调不同意见。选择困难症？那是因为你太在乎公平。",
    keywords: ["优雅", "公正", "社交"]
  },
  "天蝎座": {
    tag: "洞察派", element: "水象",
    blurb: "感知力强，看人很准。外表冷静，内心波涛汹涌；一旦信任，会很深很久。",
    keywords: ["深沉", "专注", "锋利"]
  },
  "射手座": {
    tag: "自由派", element: "火象",
    blurb: "向往远方与新鲜事，乐观到有点欠打。讨厌被框住，最怕无聊的重复。",
    keywords: ["洒脱", "好奇", "坦诚"]
  },
  "摩羯座": {
    tag: "攀登派", element: "土象",
    blurb: "目标感强，愿意为长远结果熬。外表克制，实则野心和责任心都很大。",
    keywords: ["坚韧", "务实", "自律"]
  },
  "水瓶座": {
    tag: "脑洞派", element: "风象",
    blurb: "想法常领先半步，独立又讲义气。不喜欢随大流，更爱自己的节奏和朋友圈。",
    keywords: ["独特", "理想", "疏离感"]
  },
  "双鱼座": {
    tag: "想象派", element: "水象",
    blurb: "共情力满格，容易被氛围和故事打动。世界对他们来说可以很柔软，也可以很梦幻。",
    keywords: ["浪漫", "敏感", "慈悲"]
  }
};

const SHENGXIAO_BLURB = {
  "鼠": "机灵会抓机会", "牛": "踏实能扛事", "虎": "有魄力敢冲",
  "兔": "细腻会照顾人", "龙": "气场足有格局", "蛇": "冷静有洞见",
  "马": "热情闲不住", "羊": "温柔重情义", "猴": "聪明爱折腾",
  "鸡": "讲究有条理", "狗": "忠诚讲信用", "猪": "豁达爱生活"
};

function birthdayFunFacts(ev, next) {
  const isBday = ev.type === "birthday" || ev.subtype === "birthday";
  if (!isBday || !next?.date) return null;
  let westDate = next.date;
  if (ev.birth_year && ev.calendar === "lunar" && ev.schedule?.month && ev.schedule?.day) {
    const bornSolar = lunarToSolar(ev.schedule.month, ev.schedule.day, ev.birth_year, !!ev.schedule.leap_month);
    if (bornSolar) westDate = bornSolar;
  } else if (ev.birth_year && ev.calendar !== "lunar" && ev.schedule?.month && ev.schedule?.day) {
    westDate = new Date(ev.birth_year, ev.schedule.month - 1, ev.schedule.day);
  }
  const west = zodiacWestern(westDate.getMonth() + 1, westDate.getDate());
  const yearForShengxiao = ev.birth_year || next.date.getFullYear();
  const east = zodiacChinese(yearForShengxiao);
  const wx = wuxingOfYear(yearForShengxiao);
  const profile = ZODIAC_PROFILES[west.name] || {
    tag: "好运连连", element: "—", blurb: "独一无二的你，继续被轻轻推醒就好。", keywords: ["特别"]
  };
  return {
    west, east, wx, profile,
    trait: profile.tag,
    solarHint: `${westDate.getMonth() + 1}月${westDate.getDate()}日`,
    shengxiaoBlurb: SHENGXIAO_BLURB[east.name] || "好运常在",
    ageNow: ev.birth_year ? (new Date().getFullYear() - ev.birth_year) : null
  };
}

function funFactsHTML(ev, forecastDays) {
  const next = nextOccurrence(ev, forecastDays);
  const fun = birthdayFunFacts(ev, next);
  if (!fun) return "";
  const kw = (fun.profile.keywords || []).map((k) => `<span class="fun-kw">${esc(k)}</span>`).join("");
  return `
    <div class="span-2 fun-facts-card">
      <div class="fun-bento">
        <article class="fun-feature" style="--i:0">
          <div class="fun-feature-top">
            <span class="fun-sym huge">${fun.west.sym}</span>
            <div>
              <p class="fun-k">星座档案</p>
              <h3 class="fun-feature-title">${esc(fun.west.name)}</h3>
              <p class="fun-feature-tag">${esc(fun.profile.element)} · ${esc(fun.profile.tag)}</p>
            </div>
          </div>
          <p class="fun-blurb">${esc(fun.profile.blurb)}</p>
          <div class="fun-kw-row">${kw}</div>
          <p class="fun-sub">推算参考阳历 ${esc(fun.solarHint)}${ev.birth_year ? " · 出生年 " + esc(String(ev.birth_year)) : ""}</p>
        </article>
        <aside class="fun-side">
          <div class="fun-tile" style="--i:1">
            <div class="fun-sym">${fun.east.emoji}</div>
            <div class="fun-k">生肖</div>
            <div class="fun-v">属${esc(fun.east.name)}</div>
            <div class="fun-sub">${esc(fun.shengxiaoBlurb)}</div>
          </div>
          <div class="fun-tile accent" style="--i:2">
            <div class="fun-sym">✦</div>
            <div class="fun-k">五行</div>
            <div class="fun-v">${esc(fun.wx)}</div>
            <div class="fun-sub">年柱简推 · 仅供玩乐</div>
          </div>
          <div class="fun-tile wide" style="--i:3">
            <div class="fun-inline">
              <span class="fun-sym">${next && next.days === 0 ? "🎂" : "⏳"}</span>
              <div>
                <div class="fun-k">距离下次</div>
                <div class="fun-v">${next ? (next.days === 0 ? "就是今天" : next.days + " 天") : "—"}</div>
                <div class="fun-sub">${fun.ageNow != null ? "大约 " + fun.ageNow + " 周岁" : "轻推一下，刚好想起"}</div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>`;
}

function yearCalendarChartHTML(ev) {
  const s = ev.schedule || {};
  if (s.mode !== "yearly" || !s.month || !s.day) return "";
  const lunarMode = ev.calendar === "lunar";
  const rows = yearCalendarRows(ev, 8);
  if (!rows.length) return "";

  if (lunarMode) {
    const lunarName = formatLunarMD(s.month, s.day, !!s.leap_month);
    const tableRows = rows.map((r, i) => `
      <tr class="${r.isNext ? "is-next" : ""} ${r.past ? "is-past" : ""}" style="--row:${i}">
        <td>${r.year}${r.isNext ? '<span class="tag-next">下次</span>' : ""}</td>
        <td class="mono">${esc(lunarName)}</td>
        <td><strong>${esc(formatSolarMD(r.solar))}</strong> <span class="wd">周${["日","一","二","三","四","五","六"][r.solar.getDay()]}</span></td>
        <td>${r.age != null ? r.age + "岁" : "—"}</td>
      </tr>`).join("");
    return `
      <div class="nudge-card span-2 cal-chart-card">
        <div class="section-title">
          <h3><span class="title-ico sm">${iconSvg("calendar")}</span> 历年阳历日期</h3>
        </div>
        <p class="form-hint">农历 <strong>${esc(lunarName)}</strong> 每年固定；下表是各年对应的<strong>阳历几月几号</strong>。</p>
        <div class="cal-table-wrap">
          <table class="cal-table">
            <thead>
              <tr>
                <th>年份</th>
                <th>农历生日</th>
                <th>该年阳历</th>
                <th>岁</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>`;
  }

  const tableRows = rows.map((r, i) => `
    <tr class="${r.isNext ? "is-next" : ""} ${r.past ? "is-past" : ""}" style="--row:${i}">
      <td>${r.year}${r.isNext ? '<span class="tag-next">下次</span>' : ""}</td>
      <td>${esc(r.solarLabel)}</td>
      <td>${esc(r.lunarLabel)}</td>
      <td>${r.age != null ? r.age + "岁" : "—"}</td>
    </tr>`).join("");
  return `
    <div class="nudge-card span-2 cal-chart-card">
      <div class="section-title"><h3><span class="title-ico sm">${iconSvg("calendar")}</span> 历年对照</h3></div>
      <p class="form-hint">阳历固定日；下表为对应农历。</p>
      <div class="cal-table-wrap">
        <table class="cal-table">
          <thead><tr><th>年份</th><th>阳历</th><th>对应农历</th><th>岁</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>`;
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
  maybePromptUpdate();
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
  syncChrome();
}

function openDetail(id) {
  if (!id) return;
  detailId = id;
  if (!(history.state && history.state.nudge === "detail" && history.state.id === id)) {
    history.pushState({ nudge: "detail", id }, "");
  }
  renderView("detail");
}

async function renderToday(el) {
  el.innerHTML = skeletonBlocks(3);
  const [dash, cfg, pushSt] = await Promise.all([api("/dashboard"), api("/config"), api("/push/status")]);
  if (dash.error) { el.innerHTML = `<div class="empty-state"><p>${esc(dash.error)}</p></div>`; return; }
  const failN = pushSt?.summary?.failed || 0;
  const pending = dash.pending || dash.today || [];
  const done = dash.done || [];
  const upcoming = dash.upcoming || [];
  const grouped = groupPending(pending);
  const total = pending.length + done.length;
  const pct = total ? Math.round((done.length / total) * 100) : 0;
  const feishuOn = !!cfg.feishu?.enabled;
  const botOn = !!cfg.feishu?.bot_configured;
  const hideHint = localStorage.getItem(HINT_KEY) === "1";
  const allClear = !pending.length && done.length > 0;
  const blankDay = !pending.length && !done.length;
  const subtitle = pending.length
    ? `还有 ${pending.length} 件 · 飞书卡片点「已收到」确认`
    : (allClear ? "今天都搞定了" : (upcoming.length ? `今天空闲 · ${upcoming.length} 件即将到来` : "今天没有待办，留白也好"));

  let hint = "";
  if (!hideHint) {
    if (!feishuOn) {
      hint = `<div class="hint-banner" id="feishu-hint">要收到推送，请到「设置」打开飞书 Webhook。<button type="button" class="hint-dismiss" data-dismiss-hint aria-label="关闭提示">关闭</button></div>`;
    } else {
      hint = `<div class="hint-banner soft" id="feishu-hint">在飞书点卡片「已收到」按钮即可确认（不跳转网页）；也可回「收到」。误点可在下方撤销。<button type="button" class="hint-dismiss" data-dismiss-hint aria-label="关闭提示">知道了</button></div>`;
    }
  }

  const emptyBlock = blankDay ? `
    <div class="empty-done today-empty">
      <div class="empty-ico" aria-hidden="true">◇</div>
      <p>${upcoming.length ? "今天没有待办" : "今天很安静"}</p>
      <p class="form-hint">${upcoming.length ? "下面是即将到来的事项；也可以先加一条习惯" : "加一条习惯、纪念日或经期记录，今日就会亮起来"}</p>
      <div class="empty-actions">
        <button type="button" class="btn-action is-primary" id="today-add">添加事项</button>
        <button type="button" class="btn-action" id="today-list">去清单</button>
      </div>
    </div>` : (allClear ? `
    <div class="empty-done is-clear">
      <div class="empty-ico" aria-hidden="true">✓</div>
      <p>今天都搞定了</p>
      <p class="form-hint">${upcoming.length ? "可以看看即将到来" : "好好休息，或去清单加一条"}</p>
      <div class="empty-actions">
        <button type="button" class="btn-action" id="today-list">去清单</button>
      </div>
    </div>` : "");

  const upcomingBlock = upcoming.length ? `
    <div class="section-title soft"><h3>${blankDay || allClear ? "即将到来" : "即将到来"}</h3>
      <span class="form-hint">${upcoming.length} 件 · 7 天内</span>
    </div>
    <div class="upcoming-list">${upcoming.map((r) => upcomingRow(r)).join("")}</div>` : "";

  el.innerHTML = `
    <div class="hero today-hero">
      <div>
        <div class="eyebrow">${esc(formatDateCN(dash.date))}</div>
        <h2>今日</h2>
        <p class="sub">${esc(subtitle)}</p>
      </div>
      ${!feishuOn ? `<span class="badge fail">飞书未启用</span>` : botOn ? `<span class="badge ok">飞书机器人</span>` : `<span class="badge ok">飞书推送</span>`}
    </div>
    <div class="comfort-strip">
      <button type="button" class="btn-comfort" id="today-comfort" aria-label="哄哄她">哄哄她</button>
      <p class="comfort-line" id="comfort-line" hidden></p>
      <button type="button" class="btn-secondary btn-small hidden" id="comfort-again">换一句</button>
    </div>
    ${total ? `
      <div class="progress-wrap" aria-label="今日进度">
        <div class="progress-meta"><span>已确认 ${done.length}/${total}</span><span>${pct}%</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>` : ""}
    ${hint}
    ${failN ? `<div class="hint-banner" id="push-fail-hint">今日有 ${failN} 条推送失败。可打开事项详情点「重试」，或飞书说「推送状态」。<button type="button" class="hint-dismiss" data-dismiss-push-hint aria-label="关闭">知道了</button></div>` : ""}
    <div class="today-list">
      ${grouped.length ? grouped.map((r, i) => pendingCard(r, i)).join("") : emptyBlock}
    </div>
    ${done.length ? `
      <details class="done-fold"${pending.length ? "" : " open"}>
        <summary>已确认 · ${done.length}</summary>
        <div class="done-list">${done.map((r) => doneCard(r)).join("")}</div>
      </details>` : ""}
    ${upcomingBlock}
  `;
  el.querySelectorAll("[data-dismiss-hint]").forEach((b) => {
    b.onclick = () => {
      localStorage.setItem(HINT_KEY, "1");
      document.getElementById("feishu-hint")?.remove();
    };
  });
  const addBtn = document.getElementById("today-add");
  if (addBtn) addBtn.onclick = () => showEventForm(null);
  const listBtn = document.getElementById("today-list");
  if (listBtn) listBtn.onclick = () => renderView("events");
  let comfortOffset = 0;
  const loadComfort = async (bump) => {
    if (bump) comfortOffset += 1;
    const r = await api("/comfort?n=" + comfortOffset);
    const line = document.getElementById("comfort-line");
    const again = document.getElementById("comfort-again");
    if (r.error || !line) {
      toast(r.error || "暂时抽不出句子");
      return;
    }
    const text = String(r.text || "").replace(/^哄哄她[^\n]*\n💬\s*/, "").trim() || r.text;
    line.hidden = false;
    line.textContent = text;
    if (again) again.classList.remove("hidden");
  };
  const comfortBtn = document.getElementById("today-comfort");
  if (comfortBtn) comfortBtn.onclick = () => loadComfort(false);
  const againBtn = document.getElementById("comfort-again");
  if (againBtn) againBtn.onclick = () => loadComfort(true);
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
  const care = r.care;
  const careBadge = care ? `<span class="badge care">关怀</span>` : "";
  const streak = r.streak;
  const streakBadge = streak?.days >= 2
    ? `<span class="badge streak" title="历史最长 ${streak.best || streak.days} 天">连续 ${streak.days}</span>`
    : (streak?.days === 1 && streak.active_today ? `<span class="badge streak soft">已打卡</span>` : "");
  const msg = cleanText(r.message || "");
  const careLine = care?.sweet
    ? `<p class="action-care">${esc(care.sweet)}</p>`
    : (msg ? `<p class="action-body">${esc(msg)}</p>` : "");
  const dayBit = care?.day != null
    ? ` · Day ${care.day}`
    : (r.cycleDay != null ? ` · 第 ${r.cycleDay} 天` : "");
  const streakHint = streak?.days >= 2 && !streak.active_today
    ? `<p class="action-streak">保持连续 ${streak.days} 天 · 飞书点「已收到」继续</p>`
    : "";
  return `<article class="action-card ${esc(space)} ${esc(r.type || "")}${care ? " has-care" : ""}${r.urgent ? " is-urgent" : ""}${streak?.days >= 2 ? " has-streak" : ""}" data-open="${r.eventId || ""}" style="animation-delay:${Math.min(idx, 8) * 40}ms">
    <div class="action-rail" aria-hidden="true"></div>
    <div class="action-main">
      <div class="action-top">
        <h3>${esc(r.name || "")}${count}${careBadge}${streakBadge}</h3>
        ${spaceBadge(space)}
      </div>
      <p class="action-meta">${r.time ? esc(r.time) + " · " : ""}${esc(typeLabel(r.type))}${dayBit}</p>
      ${careLine}
      ${streakHint}
      <p class="action-go">${care ? "查看今日关怀" : "查看详情"}</p>
    </div>
  </article>`;
}
function doneCard(r) {
  const streakBit = r.streak?.days >= 2
    ? `<span class="badge streak">连续 ${r.streak.days}</span>`
    : "";
  return `<div class="done-row" data-open="${r.eventId || ""}">
    <span class="done-check" aria-hidden="true">✓</span>
    <div class="done-main">
      <div class="done-name">${esc(r.name || "")}${r.archived ? `<span class="badge">已归档</span>` : ""}${streakBit}</div>
      <div class="form-hint">${esc(cleanText(r.message || ""))}</div>
    </div>
    <button type="button" class="btn-secondary btn-small" data-unack="${r.eventId || ""}" aria-label="撤销确认">撤销</button>
  </div>`;
}
function upcomingRow(r) {
  const dayLabel = r.days === 0 ? "今天" : (r.days === 1 ? "明天" : `${r.days} 天后`);
  const typeBit = r.type === "birthday" ? "生日 · " : (r.type === "period" ? "经期 · " : "");
  return `<button type="button" class="upcoming-row ${esc(r.type || "")}" data-open="${r.eventId || ""}">
    <span class="upcoming-name"><span class="upcoming-type">${esc(typeBit)}</span>${esc(r.name || "")}</span>
    <span class="upcoming-when">${esc(dayLabel)}${r.time ? " · " + esc(r.time) : ""}</span>
  </button>`;
}

async function renderEvents(el) {
  el.innerHTML = skeletonBlocks(4);
  const events = await api("/events");
  if (!Array.isArray(events)) { el.innerHTML = `<div class="empty-state"><p>${esc(events.error)}</p></div>`; return; }
  const enabled = events.filter((e) => e.enabled);
  const counts = { habit: 0, moment: 0, task: 0 };
  enabled.forEach((e) => { counts[spaceOf(e)] = (counts[spaceOf(e)] || 0) + 1; });
  // Collect all unique tags from enabled events
  const allTags = [...new Set(enabled.flatMap((e) => (e.tags || []).filter(Boolean)))].sort();
  const filtered = enabled.filter((e) => spaceOf(e) === spaceFilter && !e.archived
    && (!tagFilter || (e.tags || []).some((t) => String(t).toLowerCase() === tagFilter.toLowerCase())));
  const disabled = events.filter((e) => !e.enabled && !e.archived && spaceOf(e) === spaceFilter);
  const archived = events.filter((e) => e.archived && spaceOf(e) === spaceFilter);

  el.innerHTML = `
    <div class="hero">
      <div>
        <div class="eyebrow">清单</div>
        <h2>${SPACE_META[spaceFilter].label}</h2>
        <p class="sub">${esc(SPACE_META[spaceFilter].hint)} · 共 ${filtered.length} 项${tagFilter ? ` · 标签「${esc(tagFilter)}」` : ''}</p>
      </div>
      <button class="btn-secondary btn-small" id="toggle-batch" type="button">批量</button>
    </div>
    <div class="segment" role="tablist" aria-label="清单空间">
      ${["habit", "moment", "task"].map((k) => `
        <button type="button" class="seg ${spaceFilter === k ? "active" : ""}" data-space="${k}" role="tab" aria-selected="${spaceFilter === k}">
          ${SPACE_META[k].label}<span class="seg-count">${counts[k] || 0}</span>
        </button>`).join("")}
    </div>
    ${allTags.length ? `
    <div class="tag-filter-bar" id="tag-filter-bar">
      <span class="form-hint">标签筛选：</span>
      <button type="button" class="seg small ${!tagFilter ? 'active' : ''}" data-tag="">全部</button>
      ${allTags.map((t) => `
        <button type="button" class="seg small ${tagFilter === t ? 'active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}
    </div>` : ""}
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
      tagFilter = ""; // reset tag filter on space change
      renderEvents(el);
    };
  });
  el.querySelectorAll("[data-tag]").forEach((b) => {
    b.onclick = () => {
      tagFilter = b.dataset.tag || "";
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
  let ageLabel = "";
  if ((ev.type === "birthday" || ev.subtype === "birthday") && ev.birth_year) {
    const s = ev.schedule || {};
    const now = new Date();
    const curY = now.getFullYear();
    let next;
    if (ev.calendar === "lunar" && s.month && s.day) {
      const leap = !!s.leap_month;
      next = lunarToSolar(s.month, s.day, curY, leap);
      if (!next) next = new Date(curY, (s.month || 1) - 1, s.day || 1);
      if (next < now) {
        const t2 = lunarToSolar(s.month, s.day, curY + 1, leap);
        next = t2 || new Date(curY + 1, (s.month || 1) - 1, s.day || 1);
      }
    } else if (s.month && s.day) {
      next = new Date(curY, s.month - 1, s.day);
      if (next < now) next = new Date(curY + 1, s.month - 1, s.day);
    } else {
      next = new Date(curY, 0, 1);
    }
    ageLabel = " · " + (next.getFullYear() - ev.birth_year) + "岁";
  }
  const calBadge = ev.calendar === "lunar"
    ? `<span class="badge with-icon">${iconSvg("moon")}农历</span>`
    : (ev.schedule?.mode === "yearly" ? `<span class="badge with-icon">${iconSvg("sun")}阳历</span>` : "");
  const typeBadge = (ev.type === "birthday" || ev.subtype === "birthday")
    ? `<span class="badge with-icon">${iconSvg("cake")}生日</span>`
    : "";
  const tagBadges = (ev.tags && Array.isArray(ev.tags) && ev.tags.length)
    ? ev.tags.map((t) => `<span class="badge tag-badge">${esc(t)}</span>`).join("")
    : "";
  return `<article class="nudge-card clickable space-${space} ${esc(ev.type)}" data-open="${ev.id}">
    <div class="rail"></div>
    <div class="card-top">
      <div class="title">${esc(ev.name)}${ageLabel}</div>
      <div class="badge-row">${spaceBadge(space)}${typeBadge}${calBadge}${tagBadges}${ev.archived ? `<span class="badge">已归档</span>` : ev.enabled ? "" : `<span class="badge">停用</span>`}</div>
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

function cycleTimelineHTML(timeline) {
  if (!timeline?.phases?.length) return "";
  const segs = timeline.phases.map((p) => `
    <div class="cycle-seg ${p.id === timeline.active ? "is-active" : ""}" style="flex:${Math.max(p.width, 6)}" title="${esc(p.label)} ${p.start}-${p.end}天">
      <span>${esc(p.label)}</span>
    </div>`).join("");
  const pct = Math.round((timeline.position || 0) * 100);
  return `
    <div class="nudge-card span-2 cycle-timeline-card">
      <div class="section-title">
        <h3>周期时间轴</h3>
        <span class="form-hint">第 ${esc(String(timeline.day_in_cycle))} / ${esc(String(timeline.cycle_length))} 天</span>
      </div>
      <div class="cycle-track" role="img" aria-label="周期阶段">
        ${segs}
        <i class="cycle-pin" style="left:${pct}%" aria-hidden="true"></i>
      </div>
      <p class="form-hint cycle-legend">月经 · 卵泡 · 排卵 · 黄体 · 仅供参考</p>
    </div>`;
}

function periodCareHTML(care) {
  if (!care) return "";
  const list = (arr, cls) => (arr || []).map((x) => `<li class="${cls}">${esc(x)}</li>`).join("");
  return `
    <div class="nudge-card span-2 period-care-card">
      <div class="section-title">
        <h3>今日关怀</h3>
        ${care.day ? `<span class="badge">Day ${esc(String(care.day))}</span>` : `<span class="badge">${esc(care.phase || "")}</span>`}
      </div>
      <p class="care-sweet">${esc(care.sweet || "")}</p>
      <p class="care-title">${esc(care.title || "")}</p>
      <div class="care-grid">
        <div class="care-col">
          <h4>注意事项</h4>
          <ul>${list(care.notes, "")}</ul>
        </div>
        <div class="care-col">
          <h4>少碰</h4>
          <ul>${list(care.avoid, "is-avoid")}</ul>
        </div>
        <div class="care-col">
          <h4>可以做</h4>
          <ul>${list(care.do, "is-do")}</ul>
        </div>
      </div>
      <p class="form-hint care-disclaimer">${esc(care.disclaimer || "")}</p>
    </div>`;
}

function periodForecastHTML(period) {
  if (!period) return "";
  const f = period.forecast;
  const hist = period.history || [];
  const careBlock = periodCareHTML(period.care);
  const timelineBlock = cycleTimelineHTML(period.timeline);
  if (!f) {
    return `
      ${timelineBlock}
      ${careBlock}
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
    ${timelineBlock}
    ${careBlock}
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

function streakCardHTML(streak) {
  if (!streak) return "";
  const days = streak.days || 0;
  const best = streak.best || days;
  const status = streak.active_today
    ? "今天已确认，连续在延续"
    : (days > 0 ? "今天还没确认，飞书点「已收到」可续上" : "确认一次后开始累计连续天数");
  return `
    <div class="nudge-card streak-card">
      <div class="section-title"><h3>连续打卡</h3></div>
      <div class="streak-num">${days}</div>
      <p class="streak-meta">天 · 历史最长 ${best} 天</p>
      <p class="form-hint" style="margin-top:.55rem">${esc(status)}</p>
    </div>`;
}

function capsuleCardHTML(capsule) {
  if (!capsule?.eligible) return "";
  const prev = capsule.previous;
  const cur = capsule.this_year;
  const hist = (capsule.list || []).slice(0, 5).map((c) => `
    <div class="capsule-hist-row">
      <span class="capsule-year">${esc(String(c.year))}</span>
      <span>${esc(c.note)}</span>
    </div>`).join("") || `<p class="form-hint">还没有往年留言</p>`;
  return `
    <div class="nudge-card span-2 capsule-card">
      <div class="section-title"><h3>时间胶囊</h3></div>
      ${prev ? `<p class="capsule-prev"><span class="capsule-label">${esc(String(prev.year))} 年的话</span>${esc(prev.note)}</p>`
        : `<p class="form-hint">去年没有留言。今天写一句，明年会再遇见。</p>`}
      <label class="form-hint" for="capsule-note">${cur ? "更新今年的话" : "写给明年的自己 / 她"}</label>
      <textarea id="capsule-note" class="capsule-input" rows="3" maxlength="500" placeholder="一句想被记住的话…">${cur ? esc(cur.note) : ""}</textarea>
      <button type="button" class="btn-action is-primary" id="capsule-save">封存今年</button>
      <div class="capsule-hist">${hist}</div>
    </div>`;
}

async function renderDetail(el, id) {
  el.innerHTML = `<div class="empty-state"><p>加载中…</p></div>`;
  const res = await api("/events/" + id + "/detail");
  if (res.error || !res.item) { el.innerHTML = `<div class="empty-state"><p>${esc(res.error || "未找到")}</p></div>`; return; }
  const ev = res.item;
  const hist = res.push_history || [];
  const space = spaceOf(ev);
  const forecastDays = res.period?.forecast?.days_to_next;
  const forecast = res.period?.forecast;
  const inPeriod = ev.type === "period" && forecast?.in_period;
  const metaBits = [
    SPACE_META[space].label,
    ({ daily: "每天", weekly: "每周", monthly: "每月", yearly: "每年", cycle: "周期" })[ev.schedule?.mode] || "",
    ev.schedule?.time || ""
  ].filter(Boolean);
  const isBday = ev.type === "birthday" || ev.subtype === "birthday";
  const titleIcon = isBday ? "cake" : ev.type === "period" ? "heart" : space === "task" ? "calendar" : "clock";
  el.innerHTML = `
    <div class="detail-page">
      <article class="detail-hero ${esc(ev.type)} space-${space}${inPeriod ? " is-in-period" : ""}">
        <div class="detail-hero-top">
          <div class="detail-identity">
            <div class="eyebrow">${SPACE_META[space].label}${ev.subtype ? " · " + esc(({ birthday: "生日", period: "经期", anniversary: "纪念日" })[ev.subtype] || ev.subtype) : ""}</div>
            <h2 class="detail-title"><span class="title-ico" aria-hidden="true">${iconSvg(titleIcon)}</span>${esc(ev.name)}</h2>
            <p class="detail-meta">${esc(metaBits.join(" · "))}</p>
          </div>
          <div class="detail-hero-focus">
            ${countdownHeroHTML(ev, res.check, forecastDays, forecast)}
          </div>
        </div>
        <div class="detail-actions" role="toolbar" aria-label="事项操作">
          ${ev.type === "period" ? `<button class="btn-action is-primary" id="period-log" type="button">${inPeriod ? "再记一次开始" : "今天开始了"}</button>` : ""}
          <button class="btn-action" id="edit-item" type="button">编辑</button>
          <button class="btn-action btn-more-toggle" id="more-actions" type="button" aria-expanded="false">更多</button>
          <div class="detail-actions-more hidden" id="detail-more">
            ${ev.archived
              ? `<button class="btn-action" id="restore-item" type="button">取消归档</button>`
              : `<button class="btn-action" id="toggle-item" type="button">${ev.enabled ? "停用" : "启用"}</button>`}
            <button class="btn-action" id="unack-item" type="button">撤销确认</button>
            <button class="btn-action is-danger" id="delete-item" type="button">删除</button>
          </div>
        </div>
        <p class="detail-hint">${ev.type === "period" ? "确认请在飞书点「已收到」。经期中每天会推送关怀内容；保存不会立刻推送。" : "确认请在飞书点「已收到」。待办确认后会归档；保存不会立刻推送。"}</p>
      </article>
      <div class="card-grid detail-below">
        ${funFactsHTML(ev, forecastDays)}
        ${streakCardHTML(res.streak)}
        ${capsuleCardHTML(res.capsule)}
        ${ev.type === "period" ? periodForecastHTML(res.period) : ""}
        ${yearCalendarChartHTML(ev)}
        <div class="nudge-card span-2 detail-history">
          <div class="section-title"><h3>推送记录</h3></div>
          ${hist.length ? hist.map((h) => timelineRow(h, ev.id)).join("") : `<div class="empty-state soft"><p>${ev.type === "period" ? "还没有推送记录。经期开始后，关怀推送会出现在这里。" : "还没有推送记录"}</p></div>`}
        </div>
      </div>
    </div>
  `;
  syncChrome();
  document.getElementById("edit-item").onclick = () => showEventForm(ev.id);
  document.querySelectorAll(".push-retry").forEach((btn) => {
    btn.onclick = async () => {
      const rid = btn.getAttribute("data-id");
      btn.disabled = true;
      const r = await api("/events/" + rid + "/push-retry", { method: "POST", body: "{}" });
      btn.disabled = false;
      if (r.error) { toast(r.error); return; }
      toast(r.ok ? "已重试推送" : "重试未成功");
      renderDetail(el, rid);
    };
  });
  const moreBtn = document.getElementById("more-actions");
  const morePanel = document.getElementById("detail-more");
  if (moreBtn && morePanel) {
    moreBtn.onclick = () => {
      morePanel.classList.toggle("hidden");
      const open = !morePanel.classList.contains("hidden");
      moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
    };
  }
  const migrateBtn = document.getElementById("migrate-lunar");
  if (migrateBtn) {
    migrateBtn.onclick = async () => {
      const ymd = birthdayBirthDateValue(ev)
        || (ev.birth_year && ev.schedule?.month && ev.schedule?.day
          ? `${ev.birth_year}-${pad2(ev.schedule.month)}-${pad2(ev.schedule.day)}`
          : "");
      const parsed = birthdayFromSolarYmd(ymd);
      if (!parsed) {
        toast("无法换算，请编辑后填写出生日期");
        return;
      }
      const body = {
        ...ev,
        calendar: "lunar",
        birth_year: parsed.birth_year,
        birth_solar: parsed.birth_solar,
        schedule: {
          ...(ev.schedule || {}),
          mode: "yearly",
          month: parsed.lunar_month,
          day: parsed.lunar_day,
          leap_month: !!parsed.lunar_leap
        }
      };
      const r = await api("/events/" + ev.id, { method: "PUT", body: JSON.stringify(body) });
      if (r.error) {
        toast(r.error);
        return;
      }
      toast(`已改为农历 ${parsed.lunar_label}`);
      openDetail(ev.id);
    };
  }
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
    detailId = null;
    if (history.state?.nudge === "detail") {
      navSilent = true;
      history.back();
    }
    renderView("events");
    syncChrome();
  };
  const pl = document.getElementById("period-log");
  if (pl) pl.onclick = async () => {
    const r = await api("/events/" + ev.id + "/period-log", { method: "POST", body: "{}" });
    toast(r.error || "已记录");
    openDetail(ev.id);
  };
  const capsuleSave = document.getElementById("capsule-save");
  if (capsuleSave) {
    capsuleSave.onclick = async () => {
      const note = document.getElementById("capsule-note")?.value || "";
      const r = await api("/events/" + ev.id + "/capsule", {
        method: "POST",
        body: JSON.stringify({ note })
      });
      if (r.error) {
        toast(r.error);
        return;
      }
      toast("已封存今年的话");
      openDetail(ev.id);
    };
  }
}

function timelineRow(h, eventId) {
  const retry = h.status === "failed" && eventId
    ? ` <button type="button" class="btn-secondary btn-small push-retry" data-id="${eventId}">重试</button>`
    : "";
  return `<div class="timeline-item">
    <div class="dot ${h.status === "success" ? "ok" : "fail"}"></div>
    <div>
      <div style="font-weight:650;font-size:.9rem">${esc(h.card_preview || h.channel)}${retry}</div>
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
  const ghTime = d.github?.push_time || "";
  const newsTime = d.news?.push_time || "";
  const learnTime = d.learning?.push_time || "";
  const newsFeeds = (Array.isArray(d.news?.feeds) && d.news.feeds.length
    ? d.news.feeds
    : ["https://hnrss.org/frontpage"]).join("\n");
  const learnTopics = (Array.isArray(d.learning?.topics) && d.learning.topics.length
    ? d.learning.topics
    : ["前端", "算法", "Git", "HTTP"]).join("、");
  el.innerHTML = `
    <div class="hero">
      <div>
        <div class="eyebrow">Digest</div>
        <h2>订阅</h2>
        <p class="sub">可配置主题与 RSS · 飞书可问「今天学什么」</p>
      </div>
    </div>
    <div class="nudge-card digest-card" style="margin-bottom:1rem">
      <div class="toggle-row"><span><strong>启用订阅推送</strong></span><div class="toggle ${d.enabled !== false ? "on" : ""}" id="tog-dig"></div></div>
      <div class="toggle-row"><span>AI 导读（DeepSeek）</span><div class="toggle ${d.ai_summary !== false ? "on" : ""}" id="tog-ai"></div></div>
      <div class="form-group"><label>默认推送时刻（各源未单独设置时使用）</label><input id="dig-time" type="time" value="${esc(d.push_time || "20:00")}"></div>
      <p class="form-hint">到点推短卡，全文写入飞书文档（按钮「阅读全文」）。也可说「今天学什么 / GitHub / 科技快讯 / 帮助」。</p>
    </div>
    <div class="section-title"><h3>来源（分模块）</h3></div>
    <div class="source-grid">
      <div class="nudge-card source-card digest-card">
        <div class="toggle-row">
          <div><div class="title">GitHub 热门</div><div class="desc">飞书详版：仓库 / 一句话 / 为什么看 / 链接</div></div>
          <div class="toggle ${d.github?.enabled !== false ? "on" : ""}" id="tog-gh"></div>
        </div>
        <div class="toggle-row"><span class="form-hint">AI 导读+为什么</span><div class="toggle ${d.github?.ai !== false ? "on" : ""}" id="tog-gh-ai"></div></div>
        <div class="form-group"><label>本源时刻（可空=用默认）</label><input id="gh-time" type="time" value="${esc(ghTime)}"></div>
      </div>
      <div class="nudge-card source-card digest-card">
        <div class="toggle-row">
          <div><div class="title">科技快讯</div><div class="desc">飞书详版：标题 / 导读 / 为什么刷 / 原文</div></div>
          <div class="toggle ${d.news?.enabled !== false ? "on" : ""}" id="tog-news"></div>
        </div>
        <div class="toggle-row"><span class="form-hint">AI 导读+为什么</span><div class="toggle ${d.news?.ai !== false ? "on" : ""}" id="tog-news-ai"></div></div>
        <div class="form-group"><label>本源时刻（可空=用默认）</label><input id="news-time" type="time" value="${esc(newsTime)}"></div>
        <div class="form-group"><label>RSS 源（每行一个 URL）</label><textarea id="news-feeds" rows="3" placeholder="https://hnrss.org/frontpage">${esc(newsFeeds)}</textarea></div>
      </div>
      <div class="nudge-card source-card digest-card">
        <div class="toggle-row">
          <div><div class="title">每日编程</div><div class="desc">飞书详版：课题 / 讲解 / 例子 / 练习</div></div>
          <div class="toggle ${d.learning?.enabled !== false ? "on" : ""}" id="tog-learn"></div>
        </div>
        <div class="toggle-row"><span class="form-hint">AI 扩写讲解</span><div class="toggle ${d.learning?.ai !== false ? "on" : ""}" id="tog-learn-ai"></div></div>
        <div class="form-group"><label>本源时刻（可空=用默认）</label><input id="learn-time" type="time" value="${esc(learnTime)}"></div>
        <div class="form-group"><label>编程主题偏好（用顿号或逗号分隔）</label><input id="learn-topics" value="${esc(learnTopics)}" placeholder="前端、算法、Git、HTTP"></div>
        <p class="form-hint">可选：前端 / 后端 / 算法 / Git / JavaScript / TypeScript 等，用于轮换课题池。</p>
      </div>
    </div>
    <button class="btn-primary btn-small" id="save-sub" type="button" style="margin:1rem 0">保存订阅</button>
    <div class="section-title"><h3>今日预览</h3></div>
    <div class="card-grid">
      ${sections.length ? sections.map((sec) => `
        <div class="nudge-card span-2 digest-card">
          <div class="section-title">
            <h3>${esc(sec.title)}</h3>
            <span class="form-hint">${esc(sec.push_time || "")}${sec.ai ? " · AI" : ""}</span>
          </div>
          ${(sec.items || []).slice(0, 4).map((it) => `
            <div class="preview-row">
              <div class="preview-title">${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title)}</div>
              <div class="form-hint">${esc(it.blurb || it.desc || it.meta || "")}</div>
            </div>`).join("") || `<div class="empty-state"><p>${esc(sec.error || "暂无")}</p></div>`}
        </div>`).join("") : `<div class="empty-panel">保存并启用源后可预览</div>`}
    </div>
  `;
  ["tog-dig", "tog-ai", "tog-gh", "tog-gh-ai", "tog-news", "tog-news-ai", "tog-learn", "tog-learn-ai"].forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.onclick = function () { this.classList.toggle("on"); };
  });
  document.getElementById("save-sub").onclick = async () => {
    const parseTopics = (raw) => String(raw || "")
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);
    const parseFeeds = (raw) => String(raw || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//i.test(s))
      .slice(0, 8);
    const topics = parseTopics(document.getElementById("learn-topics").value);
    const feeds = parseFeeds(document.getElementById("news-feeds").value);
    const c = await api("/config");
    c.digests = {
      ...(c.digests || {}),
      enabled: document.getElementById("tog-dig").classList.contains("on"),
      ai_summary: document.getElementById("tog-ai").classList.contains("on"),
      push_time: document.getElementById("dig-time").value || "20:00",
      github: {
        ...(c.digests?.github || {}),
        enabled: document.getElementById("tog-gh").classList.contains("on"),
        ai: document.getElementById("tog-gh-ai").classList.contains("on"),
        push_time: document.getElementById("gh-time").value || ""
      },
      news: {
        ...(c.digests?.news || {}),
        enabled: document.getElementById("tog-news").classList.contains("on"),
        ai: document.getElementById("tog-news-ai").classList.contains("on"),
        push_time: document.getElementById("news-time").value || "",
        feeds: feeds.length ? feeds : ["https://hnrss.org/frontpage"]
      },
      learning: {
        ...(c.digests?.learning || {}),
        enabled: document.getElementById("tog-learn").classList.contains("on"),
        ai: document.getElementById("tog-learn-ai").classList.contains("on"),
        push_time: document.getElementById("learn-time").value || "",
        topics: topics.length ? topics : ["前端", "算法", "Git", "HTTP"]
      }
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
    <div class="nudge-card" style="margin-bottom:1rem">
      <h3 style="margin-bottom:.5rem">客户端更新</h3>
      <p class="form-hint">日常推送部署无需重装 App。点下方可清缓存并拉取最新页面。</p>
      <div class="action-btns">
        <button class="btn-primary btn-small" id="btn-check-update" type="button">检查并更新</button>
        <button class="btn-secondary btn-small" id="btn-force-refresh" type="button">强制刷新</button>
      </div>
    </div>
    <div class="card-grid">
      <div class="nudge-card">
        <div class="toggle-row"><span><strong>DeepSeek</strong></span><span class="badge ${config.deepseek?.configured ? "ok" : "fail"}">${config.deepseek?.configured ? "已配置" : "未配置"}</span></div>
        <p class="form-hint">飞书可说「帮助 / 今天学什么 / GitHub / 科技快讯 / 今天事项」。Key 仅读 DEEPSEEK_API_KEY。</p>
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
  document.getElementById("btn-check-update").onclick = () => checkAndApplyUpdate();
  document.getElementById("btn-force-refresh").onclick = async () => {
    const h = await api("/health");
    toast("正在刷新…");
    await forceAppUpdate(h.version || localStorage.getItem(VERSION_KEY) || "");
  };
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
    if (!confirm("手动推送？事项一张卡；每个订阅源各一张卡（含 AI 导读）。")) return;
    const r = await api("/push/run", { method: "POST", body: JSON.stringify({
      feishu_enabled: document.getElementById("tog-fs").classList.contains("on"),
      serverchan_enabled: document.getElementById("tog-sc").classList.contains("on"),
      webhook_url: document.getElementById("fs-url").value.trim(),
      chat_id: document.getElementById("fs-chat").value.trim(),
      sendkey: document.getElementById("sc-key").value.trim(),
      include_digest: true
    }) });
    const digOk = (r.digest_pushes || []).some((x) => x.feishu?.ok || x.ok);
    const ok = r.items_push?.feishu?.ok || digOk || r.digest_push?.feishu?.ok || r.feishu?.ok;
    const digN = (r.digest_pushes || []).length;
    toast(r.message || (ok ? `已推送${digN ? ` · 订阅 ${digN} 张卡` : ""}` : `推送失败 · ${r.feishu?.error || ""}`));
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
    const modal = openModal(eventFormHTML(ev, spaceHint || createSpaceHint), false);
    setupEventForm(modal, ev, spaceHint || createSpaceHint);
  })();
}

function eventFormHTML(ev, spaceHint) {
  const space = ev ? spaceOf(ev) : (spaceHint || "habit");
  const subtype = ev?.subtype || (ev?.type === "period" ? "period" : ev?.type === "birthday" ? "birthday" : "anniversary");
  const s = ev?.schedule || {};
  const m = ev?.messages || {};
  const defaultMode = space === "task" ? "once" : (space === "habit" ? "daily" : "yearly");
  const mode = s.mode || defaultMode;
  const anniYmd = (s.month && s.day)
    ? `${new Date().getFullYear()}-${pad2(s.month)}-${pad2(s.day)}`
    : "";
  const dow = s.day_of_week != null ? Number(s.day_of_week) : 1;
  return `
    <div class="modal-header"><h2>${ev ? "编辑" : "新增" + SPACE_META[space].label}</h2><button class="modal-close" type="button" aria-label="关闭">✕</button></div>
    <form id="event-form">
      <input type="hidden" name="space" id="field-space" value="${space}">
      ${!ev ? `
      <div class="segment compact" id="space-seg">
        ${["habit", "moment", "task"].map((k) => `<button type="button" class="seg ${space === k ? "active" : ""}" data-set-space="${k}">${SPACE_META[k].label}</button>`).join("")}
      </div>` : `<p class="form-hint space-lock">${SPACE_META[space].label}</p>`}
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
      <div class="form-group"><label>名称</label><input name="name" required value="${esc(ev?.name || "")}" placeholder="怎么称呼这件事"></div>
      <div class="form-group"><label>标签（逗号或空格分隔）</label><input name="tags" value="${esc((ev?.tags || []).join(', '))}" placeholder="如：健康 前端 系统组件"></div>
      <div id="fields-birthday" class="${space === "moment" && subtype === "birthday" ? "" : "hidden"}">
        <div class="form-group">
          <label>出生日期（阳历）</label>
          <input name="birth_date" type="date" value="${birthdayBirthDateValue(ev)}" max="2100-12-31">
        </div>
        <div id="bday-preview" class="bday-preview" aria-live="polite"></div>
        <p class="form-hint cal-hint">填阳历出生日期，系统换算农历并按农历过生日。</p>
        <div class="form-row">
          <div class="form-group"><label>提前（天）</label><input name="remind_ahead" type="number" min="0" value="${ev?.remind_ahead ?? 3}"></div>
          <div class="form-group"><label>推送时刻</label><input name="time" type="time" value="${s.time || "09:00"}"></div>
        </div>
      </div>
      <div id="fields-period" class="${space === "moment" && subtype === "period" ? "" : "hidden"}">
        <div class="form-group"><label>上次开始</label><input name="last_start" type="date" value="${s.last_start || ""}"></div>
        <div class="form-row">
          <div class="form-group"><label>周期（天）</label><input name="cycle_length" type="number" value="${s.cycle_length || 28}"></div>
          <div class="form-group"><label>持续（天）</label><input name="period_length" type="number" value="${s.period_length || 5}"></div>
        </div>
        <div class="form-group"><label>推送时刻</label><input name="time_period" type="time" value="${s.time || "09:00"}"></div>
      </div>
      <div id="fields-anni" class="${space === "moment" && subtype === "anniversary" ? "" : "hidden"}">
        <div class="form-group"><label>纪念日日期</label>
          <input name="anni_date" type="date" value="${anniYmd}">
        </div>
        <div class="form-group"><label>历法</label>
          <div class="cal-seg" role="radiogroup" aria-label="历法">
            <button type="button" class="cal-opt ${(ev?.calendar || "solar") !== "lunar" ? "active" : ""}" data-cal="solar">阳历 · 每年同日</button>
            <button type="button" class="cal-opt ${ev?.calendar === "lunar" ? "active" : ""}" data-cal="lunar">农历 · 阳历会变</button>
          </div>
          <input type="hidden" name="calendar_a" id="field-cal-a" value="${(ev?.calendar || "solar") === "lunar" ? "lunar" : "solar"}">
        </div>
        <div class="form-group"><label>推送时刻</label><input name="time_anni" type="time" value="${s.time || "09:00"}"></div>
        <div class="form-group"><label>提醒文案</label><input name="msg_anni" value="${esc(m.default || "")}" placeholder="可选"></div>
      </div>
      <div id="fields-habit" class="${space === "habit" || space === "task" ? "" : "hidden"}">
        <div class="form-row">
          <div class="form-group"><label>频率</label>
            <select name="mode" id="field-mode">${(space === "task" ? ["once", "daily", "weekly"] : ["daily", "weekly", "monthly", "yearly"]).map((mo) => `<option value="${mo}" ${mode === mo ? "selected" : ""}>${({ once: "仅一次", daily: "每天", weekly: "每周", monthly: "每月", yearly: "每年" })[mo]}</option>`).join("")}</select>
          </div>
          <div class="form-group"><label>推送时刻</label><input name="time_custom" type="time" value="${s.time || "08:00"}"></div>
        </div>
        <div class="form-group hidden" id="weekly-dow">
          <label>星期几</label>
          <select name="day_of_week">${[0,1,2,3,4,5,6].map((d) => `<option value="${d}" ${dow === d ? "selected" : ""}>${["周日","周一","周二","周三","周四","周五","周六"][d]}</option>`).join("")}</select>
        </div>
        <div class="form-row hidden" id="custom-md">
          <div class="form-group"><label>月</label><input name="month_c" type="number" min="1" max="12" value="${s.month || ""}"></div>
          <div class="form-group"><label>日</label><input name="day_c" type="number" min="1" max="31" value="${s.day || ""}"></div>
        </div>
        <div class="form-group"><label>提醒文案</label><input name="msg_default" value="${esc(m.default || m.today || "")}" placeholder="可选"></div>
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
  modal.querySelector(".modal-close").onclick = () => closeModal();
  modal.querySelector("#cancel-form").onclick = () => closeModal();

  const syncSpaceUI = (space, subtype) => {
    spaceInput.value = space;
    modal.querySelectorAll("[data-set-space]").forEach((c) => c.classList.toggle("active", c.dataset.setSpace === space));
    modal.querySelector("#moment-sub").classList.toggle("hidden", space !== "moment");
    modal.querySelector("#tpl-wrap").classList.toggle("hidden", space !== "habit");
    const st = subtype || modal.querySelector("#field-subtype")?.value || "birthday";
    if (modal.querySelector("#field-subtype")) modal.querySelector("#field-subtype").value = st;
    modal.querySelectorAll("[data-subtype]").forEach((c) => c.classList.toggle("active", c.dataset.subtype === st));
    const showBirthday = space === "moment" && st === "birthday";
    const showPeriod = space === "moment" && st === "period";
    const showAnni = space === "moment" && st === "anniversary";
    const showHabit = space === "habit" || space === "task";
    modal.querySelector("#fields-birthday").classList.toggle("hidden", !showBirthday);
    modal.querySelector("#fields-period").classList.toggle("hidden", !showPeriod);
    modal.querySelector("#fields-anni").classList.toggle("hidden", !showAnni);
    modal.querySelector("#fields-habit").classList.toggle("hidden", !showHabit);
    if (form.birth_date) form.birth_date.required = showBirthday;
    if (form.last_start) form.last_start.required = showPeriod;
    if (form.anni_date) form.anni_date.required = showAnni;
    // 切换习惯/待办时刷新频率选项
    const modeSel = form.mode;
    if (modeSel && showHabit) {
      const opts = space === "task"
        ? [["once", "仅一次"], ["daily", "每天"], ["weekly", "每周"]]
        : [["daily", "每天"], ["weekly", "每周"], ["monthly", "每月"], ["yearly", "每年"]];
      const cur = modeSel.value;
      modeSel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
      modeSel.value = opts.some(([v]) => v === cur) ? cur : opts[0][0];
    }
    syncModeExtras();
  };

  const syncModeExtras = () => {
    const mode = form.mode?.value;
    const md = modal.querySelector("#custom-md");
    const dow = modal.querySelector("#weekly-dow");
    if (md) md.classList.toggle("hidden", !(mode === "monthly" || mode === "yearly"));
    if (dow) dow.classList.toggle("hidden", mode !== "weekly");
  };

  modal.querySelectorAll("[data-set-space]").forEach((c) => {
    c.addEventListener("click", () => syncSpaceUI(c.dataset.setSpace, c.dataset.setSpace === "moment" ? "birthday" : null));
  });
  modal.querySelectorAll("[data-subtype]").forEach((c) => {
    c.addEventListener("click", () => syncSpaceUI("moment", c.dataset.subtype));
  });
  modal.querySelectorAll("[data-cal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      modal.querySelectorAll("[data-cal]").forEach((b) => b.classList.toggle("active", b === btn));
      const field = modal.querySelector("#field-cal-a");
      if (field) field.value = btn.dataset.cal;
    });
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
      syncModeExtras();
    };
  });
  form.mode?.addEventListener("change", syncModeExtras);
  syncSpaceUI(spaceInput.value, modal.querySelector("#field-subtype")?.value);

  const syncBdayFormHints = () => {
    const preview = modal.querySelector("#bday-preview");
    if (!preview) return;
    const ymd = form.birth_date?.value || "";
    const parsed = birthdayFromSolarYmd(ymd);
    if (!parsed) {
      preview.innerHTML = `<span class="form-hint">选择出生日期后，显示农历与下次阳历</span>`;
      return;
    }
    const curY = new Date().getFullYear();
    let nextSolar = lunarToSolar(parsed.lunar_month, parsed.lunar_day, curY, parsed.lunar_leap);
    if (nextSolar) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (nextSolar < today) nextSolar = lunarToSolar(parsed.lunar_month, parsed.lunar_day, curY + 1, parsed.lunar_leap);
    }
    const nextBit = nextSolar
      ? `下次 <strong class="mono">${esc(formatDateDisplay(nextSolar))}</strong>`
      : "";
    preview.innerHTML = `出生 <strong class="mono">${esc(parsed.birth_solar)}</strong> → 农历 <strong>${esc(parsed.lunar_label)}</strong>${nextBit ? "<br>" + nextBit : ""}`;
  };
  form.birth_date?.addEventListener("input", syncBdayFormHints);
  form.birth_date?.addEventListener("change", syncBdayFormHints);
  syncBdayFormHints();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const space = fd.get("space") || spaceHint || "habit";
    const subtype = space === "moment" ? (fd.get("subtype") || "birthday") : null;
    let body;
    if (space === "moment" && subtype === "birthday") {
      const parsed = birthdayFromSolarYmd(fd.get("birth_date"));
      if (!parsed) {
        toast("请填写正确的出生日期");
        return;
      }
      body = {
        space, subtype, name: fd.get("name"),
        calendar: "lunar",
        birth_year: parsed.birth_year,
        birth_solar: parsed.birth_solar,
        remind_ahead: +fd.get("remind_ahead") || 0,
        schedule: {
          mode: "yearly",
          month: parsed.lunar_month,
          day: parsed.lunar_day,
          leap_month: !!parsed.lunar_leap,
          time: fd.get("time") || "09:00"
        },
        messages: {}
      };
    } else if (space === "moment" && subtype === "period") {
      if (!fd.get("last_start")) {
        toast("请填写上次开始日期");
        return;
      }
      body = {
        space, subtype, name: fd.get("name"),
        schedule: {
          mode: "cycle",
          last_start: fd.get("last_start"),
          cycle_length: +fd.get("cycle_length") || 28,
          period_length: +fd.get("period_length") || 5,
          time: fd.get("time_period") || "09:00",
          cycle_history: ev?.schedule?.cycle_history
        },
        messages: {}
      };
    } else if (space === "moment") {
      const anni = parseYmdToDate(fd.get("anni_date"));
      if (!anni) {
        toast("请填写纪念日日期");
        return;
      }
      body = {
        space, subtype: "anniversary", name: fd.get("name"),
        calendar: fd.get("calendar_a") === "lunar" ? "lunar" : "solar",
        schedule: {
          mode: "yearly",
          month: anni.getMonth() + 1,
          day: anni.getDate(),
          time: fd.get("time_anni") || "09:00"
        },
        messages: { default: fd.get("msg_anni") || undefined }
      };
    } else {
      const mode = fd.get("mode") || (space === "task" ? "once" : "daily");
      if (mode === "weekly" && (fd.get("day_of_week") === "" || fd.get("day_of_week") == null)) {
        toast("请选择星期几");
        return;
      }
      body = {
        space, name: fd.get("name"),
        schedule: {
          mode,
          time: fd.get("time_custom") || "08:00",
          month: fd.get("month_c") ? +fd.get("month_c") : undefined,
          day: fd.get("day_c") ? +fd.get("day_c") : undefined,
          day_of_week: mode === "weekly" ? +fd.get("day_of_week") : undefined
        },
        messages: { default: fd.get("msg_default") || undefined }
      };
    }
    Object.keys(body.schedule).forEach((k) => body.schedule[k] == null && delete body.schedule[k]);
    // Tags: parse comma/space separated input
    const tagsRaw = String(fd.get("tags") || "").trim();
    if (tagsRaw) {
      body.tags = [...new Set(tagsRaw.split(/[,;，；\s]+/).filter(Boolean))];
    } else {
      body.tags = [];
    }
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
  if (btn) {
    if (document.querySelector(".modal-overlay")) closeModal({ fromPop: true });
    if (currentView === "detail" && history.state?.nudge === "detail") {
      navSilent = true;
      history.replaceState({}, "");
    }
    renderView(btn.dataset.view);
  }
});
setupNavigation();
boot();
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
