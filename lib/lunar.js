/**
 * Nudge — 农历 / 公历转换
 *
 * 基于 Intl.DateTimeFormat("zh-CN-u-ca-chinese")，
 * Node.js 和现代浏览器内置支持，无需安装依赖。
 *
 * 反向转换（农历→公历）通过遍历匹配实现。
 */

let _fmt = null;
function fmt() {
  if (!_fmt) _fmt = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
    year: "numeric", month: "numeric", day: "numeric"
  });
  return _fmt;
}

const CN_NUM = {
  "正":1,"二":2,"三":3,"四":4,"五":5,"六":6,
  "七":7,"八":8,"九":9,"十":10,"十一":11,"十二":12,"腊":12
};

function cnMonthToNum(s) {
  return CN_NUM[s.replace(/月$/, "")] || 0;
}

/**
 * 农历月/日 → 公历 Date
 * @param {number} mon  - 农历月 1-12
 * @param {number} day  - 农历日 1-30
 * @param {number} year - 公历年份
 * @returns {Date|null}
 */
function lunarToSolar(mon, day, year) {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 20); // 涵盖春节在1月
  const f = fmt();
  const d = new Date(start);
  while (d <= end) {
    const parts = f.formatToParts(d);
    let lm = null, ld = null;
    for (const p of parts) {
      if (p.type === "month") lm = cnMonthToNum(p.value);
      if (p.type === "day") ld = parseInt(p.value, 10);
    }
    if (lm === mon && ld === day) return new Date(d);
    d.setDate(d.getDate() + 1);
  }
  return null;
}

function lunarMonthName(m) {
  return ["","正月","二月","三月","四月","五月","六月",
    "七月","八月","九月","十月","十一月","十二月","腊月"][m] || m + "月";
}

function formatLunar(mon, day) {
  return lunarMonthName(mon) + day + "日";
}

/** 公历 Date → 农历月日 */
function solarToLunar(date) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = fmt().formatToParts(d);
  let mon = 0, day = 0;
  for (const p of parts) {
    if (p.type === "month") mon = cnMonthToNum(p.value);
    if (p.type === "day") day = parseInt(p.value, 10) || 0;
  }
  if (!mon || !day) return null;
  return { month: mon, day, label: formatLunar(mon, day) };
}

module.exports = { lunarToSolar, lunarMonthName, formatLunar, cnMonthToNum, solarToLunar };

// Self-test
if (require.main === module) {
  const r = lunarToSolar(8, 15, 2026);
  console.log("2026 mid-autumn:", r ? r.toISOString().slice(0,10) : "NOT FOUND");
  const r2 = lunarToSolar(1, 1, 2026);
  console.log("2026 CNY:", r2 ? r2.toISOString().slice(0,10) : "NOT FOUND");
}
