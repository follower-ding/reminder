/**
 * Soft companion lines — 「哄哄她」
 * Deterministic pick by date seed (same day = same line unless offset).
 */

const GENERAL = [
  "今天也辛苦了，回家有我在。",
  "你不用什么都扛着，累了就靠一会儿。",
  "想到你，就想给你倒杯热水。",
  "世界可以吵，我对你始终温柔。",
  "有我在呢，慢慢来就好。",
  "今天想吃什么？我去弄。",
  "你笑起来的样子，是我一天最好的消息。",
  "别跟自己较劲，先好好睡一觉。",
  "再难的一天，也有我陪你过完。",
  "你值得被好好对待，今天也是。"
];

const BIRTHDAY = [
  "生日快乐。愿你被世界温柔以待，也被我一直记得。",
  "又长大一岁，我还是想天天哄你开心。",
  "今天是你的日子，想要什么尽管说。",
  "谢谢你出现在我的生活里。生日快乐。"
];

const PERIOD_EXTRA = [
  "痛就跟我说，热水和零食我来准备。",
  "这几天你只管休息，杂事交给我。",
  "不舒服就躺着，我在旁边就好。",
  "你已经很勇敢了，今天也慢慢来。"
];

function hashSeed(str) {
  let h = 2166136261;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickFrom(list, seed) {
  if (!list?.length) return "";
  const idx = hashSeed(seed) % list.length;
  return list[idx];
}

/**
 * @param {{ date?: string, offset?: number, context?: 'general'|'birthday'|'period', periodSweet?: string }} opts
 */
function pickComfort(opts = {}) {
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const offset = Math.max(0, Number(opts.offset) || 0);
  const seed = `${date}|${opts.context || "general"}|${offset}`;

  if (opts.context === "period") {
    if (opts.periodSweet) {
      // alternate between care pack sweet and period extras
      const pool = [opts.periodSweet, ...PERIOD_EXTRA];
      return {
        text: pickFrom(pool, seed),
        context: "period",
        title: "哄哄她 · 经期"
      };
    }
    return {
      text: pickFrom(PERIOD_EXTRA, seed),
      context: "period",
      title: "哄哄她 · 经期"
    };
  }

  if (opts.context === "birthday") {
    return {
      text: pickFrom(BIRTHDAY, seed),
      context: "birthday",
      title: "哄哄她 · 生日"
    };
  }

  return {
    text: pickFrom(GENERAL, seed),
    context: "general",
    title: "哄哄她"
  };
}

function formatComfortReply(picked, name) {
  if (!picked?.text) return "今天也想好好对你。";
  const who = name ? `给「${name}」：` : "";
  return `${picked.title || "哄哄她"}\n💬 ${who}${picked.text}`;
}

module.exports = {
  GENERAL,
  BIRTHDAY,
  PERIOD_EXTRA,
  pickComfort,
  formatComfortReply,
  hashSeed
};
