/**
 * Nudge — 农历 / 公历转换
 *
 * 基于 Intl.DateTimeFormat("zh-CN-u-ca-chinese")，
 * Node.js 和现代浏览器内置支持，无需安装依赖。
 *
 * 反向转换（农历→公历）通过遍历匹配实现。
 * 支持闰月（如 1993-05-16 = 闰三月廿五）。
 */

let _fmt = null;
function fmt() {
  if (!_fmt) _fmt = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
    year: "numeric", month: "numeric", day: "numeric"
  });
  return _fmt;
}

const CN_NUM = {
  "正": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6,
  "七": 7, "八": 8, "九": 9, "十": 10, "十一": 11, "十二": 12, "腊": 12, "冬": 11
};

/** Parse Intl month label → { month, leap } */
function parseLunarMonthLabel(raw) {
  const s = String(raw || "").replace(/月$/, "");
  const leap = s.startsWith("闰");
  const key = leap ? s.slice(1) : s;
  const month = CN_NUM[key] || 0;
  return { month, leap };
}

function cnMonthToNum(s) {
  return parseLunarMonthLabel(s).month;
}

function lunarMonthName(m, leap = false) {
  const base = ["", "正月", "二月", "三月", "四月", "五月", "六月",
    "七月", "八月", "九月", "十月", "冬月", "腊月"][m] || (m + "月");
  return leap ? ("闰" + base) : base;
}

function lunarDayName(day) {
  const n = Number(day) || 0;
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  if (n <= 0) return String(day || "");
  if (n <= 10) return "初" + digits[n];
  if (n < 20) return "十" + digits[n - 10];
  if (n === 20) return "二十";
  if (n < 30) return "廿" + digits[n - 20];
  if (n === 30) return "三十";
  return String(n);
}

function formatLunar(mon, day, leap = false) {
  return lunarMonthName(mon, leap) + lunarDayName(day);
}

/**
 * 农历月/日 → 公历 Date
 * @param {number} mon
 * @param {number} day
 * @param {number} year 公历年（春节可能跨年，搜索到次年1月）
 * @param {boolean} [leap=false] 是否闰月；该年无此闰月时回退普通月
 */
function lunarToSolar(mon, day, year, leap = false) {
  const wantLeap = !!leap;
  const start = new Date(year, 0, 1, 12, 0, 0, 0);
  const end = new Date(year + 1, 0, 20, 12, 0, 0, 0);
  const f = fmt();
  const d = new Date(start);
  let fallback = null;
  while (d <= end) {
    const parts = f.formatToParts(d);
    let monthLabel = "";
    let ld = null;
    for (const p of parts) {
      if (p.type === "month") monthLabel = p.value;
      if (p.type === "day") ld = parseInt(p.value, 10);
    }
    const parsed = parseLunarMonthLabel(monthLabel);
    if (parsed.month === mon && ld === day) {
      const hit = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
      if (parsed.leap === wantLeap) return hit;
      if (!parsed.leap && !fallback) fallback = hit;
    }
    d.setDate(d.getDate() + 1);
  }
  // 闰月生日：无闰之年用同名普通月
  return wantLeap ? fallback : null;
}

/** 公历 Date → 农历月日（含闰月） */
function solarToLunar(date) {
  const raw = date instanceof Date ? date : new Date(date);
  const d = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate(), 12, 0, 0, 0);
  const parts = fmt().formatToParts(d);
  let monthLabel = "";
  let day = 0;
  for (const p of parts) {
    if (p.type === "month") monthLabel = p.value;
    if (p.type === "day") day = parseInt(p.value, 10) || 0;
  }
  const parsed = parseLunarMonthLabel(monthLabel);
  if (!parsed.month || !day) return null;
  return {
    month: parsed.month,
    day,
    leap: parsed.leap,
    label: formatLunar(parsed.month, day, parsed.leap)
  };
}

module.exports = {
  lunarToSolar,
  lunarMonthName,
  lunarDayName,
  formatLunar,
  cnMonthToNum,
  parseLunarMonthLabel,
  solarToLunar
};

if (require.main === module) {
  const r = lunarToSolar(8, 15, 2026);
  console.log("2026 mid-autumn:", r ? r.toISOString().slice(0, 10) : "NOT FOUND");
  const leap = solarToLunar(new Date(1993, 4, 16, 12));
  console.log("1993-05-16:", leap);
}
