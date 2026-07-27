/**
 * Period day-care packs — soft companion tips (not medical advice).
 * Used by engine push + detail UI.
 */

const DISCLAIMER = "通用关怀提示，非医疗建议；严重不适请就医。";

const DAY_PACKS = {
  1: {
    title: "第一天 · 温柔启动",
    sweet: "今天有我在，你只管休息，别硬撑。",
    notes: ["腹部保暖，少剧烈运动", "睡眠优先，能早睡就早睡", "痛感上来就及时休息"],
    avoid: ["生冷冰饮", "酒精", "过辣刺激"],
    do: ["热水袋或温敷", "温热清淡饮食", "换舒适宽松衣物"]
  },
  2: {
    title: "第二天 · 好好被照顾",
    sweet: "痛就跟我说，我去准备热水和你爱吃的。",
    notes: ["今天常是不适高峰，降低期待值", "久站久蹲尽量少", "情绪起伏很正常"],
    avoid: ["冰饮冷食", "长时间站立", "硬扛不休息"],
    do: ["温热汤面/红糖姜茶（若她能接受）", "短散步放松", "陪她看轻松内容"]
  },
  3: {
    title: "第三天 · 情绪也要哄",
    sweet: "你不用假装没事，今天我陪着就好。",
    notes: ["情绪可能更敏感，多一点耐心", "避免熬夜和过量咖啡因", "给彼此留一点安静空间"],
    avoid: ["熬夜刷手机", "过量咖啡", "争执抬杠"],
    do: ["适量甜食安慰", "听歌/散步", "一句具体关心比大道理管用"]
  },
  4: {
    title: "第四天 · 慢慢回血",
    sweet: "快熬出来了，今天想吃什么我弄。",
    notes: ["身体渐缓，仍别逞强高强度运动", "可适当补铁类食物", "保持规律作息"],
    avoid: ["高强度健身", "暴饮暴食", "忽视补水"],
    do: ["晒一点太阳", "补铁食物（红肉/深绿蔬菜等）", "一起安排轻松小事"]
  },
  5: {
    title: "第五天 · 收尾也温柔",
    sweet: "这几天辛苦了，周末我们慢慢过。",
    notes: ["注意卫生替换与清洁", "仍可轻度活动，量力而行", "记录感受，下次预测会更准"],
    avoid: ["脏衣物堆积", "受凉吹风", "硬撑社交应酬"],
    do: ["温水清洗、换舒适衣物", "轻拉伸放松", "一句感谢收尾"]
  }
};

const FALLBACK_PACK = {
  title: "经期中 · 继续温柔以待",
  sweet: "还在周期里，今天也慢慢来，有我在。",
  notes: ["量力活动，不硬扛", "注意保暖与休息", "不适加重及时休息或就医"],
  avoid: ["生冷酒精", "过度劳累"],
  do: ["温热饮食", "充足睡眠", "一句关心"]
};

const PRE_PACK = {
  title: "经期将近 · 提前关照",
  sweet: "快到了，我先把热水袋和零食准备好。",
  notes: ["这两天少安排高强度行程", "准备好卫生用品与保暖", "观察情绪与身体信号"],
  avoid: ["临时硬撑通宵", "冰饮过量"],
  do: ["备好热水袋", "提前问她想吃什么", "把日程留一点余量"]
};

function clampDay(day) {
  const n = Number(day);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function getPeriodCare(dayInCycle, opts = {}) {
  const periodLen = Math.max(1, Number(opts.periodLength) || 5);
  const phase = opts.phase || "period";
  if (phase === "pre") {
    return { ...PRE_PACK, day: null, phase: "pre", disclaimer: DISCLAIMER };
  }
  if (phase === "ovulation") {
    return {
      title: "易孕期附近 · 轻轻提醒",
      sweet: "今天状态怎样？累了就早点休息。",
      notes: ["注意休息与身体观察", "保持轻松作息"],
      avoid: ["过度焦虑"],
      do: ["温和运动", "好好吃饭睡觉"],
      day: clampDay(dayInCycle),
      phase: "ovulation",
      disclaimer: DISCLAIMER
    };
  }
  const day = clampDay(dayInCycle);
  const pack = day <= 5 ? DAY_PACKS[day] : {
    ...FALLBACK_PACK,
    title: `第 ${day} 天 · 继续温柔以待`
  };
  return {
    ...pack,
    day,
    period_length: periodLen,
    phase: "period",
    disclaimer: DISCLAIMER,
    progress: Math.min(1, day / periodLen)
  };
}

function formatCarePushMessage(care, name) {
  if (!care) return `经期提醒 · ${name || ""}`.trim();
  const who = name ? `「${name}」` : "";
  if (care.phase === "pre") {
    return `🩸 ${who}经期将近 · ${care.sweet}`.replace(/\s+/g, " ").trim();
  }
  if (care.phase === "ovulation") {
    return `🥚 ${who}${care.title} · ${care.sweet}`.replace(/\s+/g, " ").trim();
  }
  return `🩸 ${who}经期第 ${care.day} 天 · ${care.sweet}`.replace(/\s+/g, " ").trim();
}

function formatCareFeishuBlock(care) {
  if (!care) return "";
  const lines = [
    `**${care.title}**`,
    care.sweet ? `💬 ${care.sweet}` : null,
    care.notes?.length ? `注意：${care.notes.slice(0, 3).map((x) => `· ${x}`).join(" ")}` : null,
    care.avoid?.length ? `少碰：${care.avoid.slice(0, 3).join("、")}` : null,
    care.do?.length ? `可以：${care.do.slice(0, 3).join("、")}` : null,
    `_${care.disclaimer}_`
  ].filter(Boolean);
  return lines.join("\n");
}

/** Build cycle phase timeline for detail UI. */
function buildCycleTimeline(forecast) {
  if (!forecast) return null;
  const cycle = Math.max(21, Number(forecast.cycle_length) || 28);
  const periodLen = Math.max(1, Number(forecast.period_length) || 5);
  const day = Math.max(1, Math.min(cycle, Number(forecast.day_in_cycle) || 1));
  const ovuCenter = Math.max(periodLen + 2, cycle - 14);
  const ovuStart = Math.max(periodLen + 1, ovuCenter - 2);
  const ovuEnd = Math.min(cycle - 1, ovuCenter + 2);

  const phases = [
    { id: "menses", label: "月经", start: 1, end: periodLen },
    { id: "follicular", label: "卵泡", start: periodLen + 1, end: ovuStart - 1 },
    { id: "ovulation", label: "排卵", start: ovuStart, end: ovuEnd },
    { id: "luteal", label: "黄体", start: ovuEnd + 1, end: cycle }
  ].filter((p) => p.end >= p.start);

  let active = phases[0]?.id || "menses";
  for (const p of phases) {
    if (day >= p.start && day <= p.end) active = p.id;
  }
  if (forecast.in_period) active = "menses";
  else if (forecast.in_ovulation) active = "ovulation";

  return {
    cycle_length: cycle,
    period_length: periodLen,
    day_in_cycle: day,
    position: Math.min(0.98, Math.max(0.02, (day - 0.5) / cycle)),
    active,
    phases: phases.map((p) => ({
      ...p,
      width: ((p.end - p.start + 1) / cycle) * 100
    }))
  };
}

module.exports = {
  DISCLAIMER,
  DAY_PACKS,
  getPeriodCare,
  formatCarePushMessage,
  formatCareFeishuBlock,
  buildCycleTimeline
};
