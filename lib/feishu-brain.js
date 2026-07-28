/**
 * Feishu bot “brain” helpers — query catalog, upcoming, digests control.
 */
const engine = require('../engine');
const store = require('../store');
const digest = require('../digest');

const { migrateEvents, checkEvent, predictPeriod, isAcked, buildFeishuCard } = engine;

function dateStr(tz = 'Asia/Shanghai') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function nowParts(tz = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    year: +get('year'), month: +get('month'), day: +get('day'),
    hour: +get('hour'), minute: +get('minute')
  };
}

function spaceOf(ev) {
  if (ev?.space === 'habit' || ev?.space === 'moment' || ev?.space === 'task') return ev.space;
  if (ev?.type === 'birthday' || ev?.type === 'period') return 'moment';
  if (ev?.category === 'temporary') return 'task';
  return 'habit';
}

function subtypeLabel(ev) {
  if (ev.subtype === 'birthday' || ev.type === 'birthday') return '生日';
  if (ev.subtype === 'period' || ev.type === 'period') return '经期';
  if (ev.subtype === 'anniversary') return '纪念日';
  return '';
}

/** Upcoming moments / habits within N days (for chat). */
async function listUpcoming(withinDays = 14) {
  const data = await store.loadData();
  const n = nowParts();
  const rows = [];
  for (const raw of migrateEvents(data.events)) {
    if (!raw.enabled || raw.archived) continue;
    const r = checkEvent(raw, n);
    if (!r || !r.active) continue;
    const days = r.days != null ? r.days : (r.cycleDay !== undefined ? 0 : null);
    if (days == null) continue;
    if (days > withinDays) continue;
    rows.push({
      id: raw.id,
      name: raw.name,
      space: spaceOf(raw),
      subtype: subtypeLabel(raw),
      days,
      time: r.time || raw.schedule?.time || '',
      message: r.message || ''
    });
  }
  rows.sort((a, b) => a.days - b.days || String(a.name).localeCompare(String(b.name)));
  return rows;
}

async function listBirthdays(withinDays = 60) {
  const data = await store.loadData();
  const n = nowParts();
  const rows = [];
  for (const raw of migrateEvents(data.events)) {
    if (!raw.enabled || raw.archived) continue;
    const isBday = raw.type === 'birthday' || raw.subtype === 'birthday';
    if (!isBday) continue;
    const r = checkEvent(raw, n);
    if (!r || !r.active || r.days == null) continue;
    if (r.days > withinDays) continue;
    rows.push({
      name: raw.name,
      days: r.days,
      calendar: raw.calendar === 'lunar' ? '农历' : '阳历',
      time: raw.schedule?.time || '09:00'
    });
  }
  rows.sort((a, b) => a.days - b.days);
  return rows;
}

async function listInventory() {
  const data = await store.loadData();
  const groups = { habit: [], moment: [], task: [] };
  for (const raw of migrateEvents(data.events)) {
    if (raw.archived) continue;
    const sp = spaceOf(raw);
    const bit = {
      name: raw.name,
      enabled: !!raw.enabled,
      subtype: subtypeLabel(raw),
      mode: raw.schedule?.mode || '',
      time: raw.schedule?.time || ''
    };
    (groups[sp] || groups.habit).push(bit);
  }
  return groups;
}

async function buildSummaryText(brand = 'Nudge') {
  const pending = [];
  const data = await store.loadData();
  const n = nowParts();
  const today = dateStr();
  for (const raw of migrateEvents(data.events)) {
    if (!raw.enabled || isAcked(raw, today)) continue;
    const r = checkEvent(raw, n);
    if (r && r.active && (r.days === 0 || r.cycleDay !== undefined)) {
      pending.push(raw.name);
    }
  }
  const bdays = await listBirthdays(30);
  const upcoming = await listUpcoming(7);
  const inv = await listInventory();
  const lines = [
    `${brand} 概况 · ${today}`,
    `待确认 ${pending.length}：${pending.length ? pending.join('、') : '无'}`,
    `近 30 天生日 ${bdays.length}：${bdays.length ? bdays.map((b) => `${b.name}（${b.days === 0 ? '今天' : b.days + '天后'}）`).join('、') : '无'}`,
    `7 日内提醒 ${upcoming.length} 条`,
    `清单：习惯 ${inv.habit.length} · 日子 ${inv.moment.length} · 待办 ${inv.task.filter((t) => t.enabled).length}`
  ];
  return lines.join('\n');
}

function formatBirthdayText(rows) {
  if (!rows.length) return '近两个月没有登记的生日。可在网页「清单 → 日子」添加。';
  const lines = rows.map((b) => {
    const when = b.days === 0 ? '就是今天' : b.days === 1 ? '明天' : `${b.days} 天后`;
    return `• ${b.name} — ${when}（${b.calendar} · ${b.time}）`;
  });
  return `近期生日：\n${lines.join('\n')}`;
}

function formatUpcomingText(rows) {
  if (!rows.length) return '未来两周内没有到期事项。';
  const lines = rows.map((r) => {
    const when = r.days === 0 ? '今天' : r.days === 1 ? '明天' : `${r.days} 天后`;
    const tag = r.subtype || ({ habit: '习惯', moment: '日子', task: '待办' })[r.space] || '';
    return `• [${tag}] ${r.name} — ${when}${r.time ? ` ${r.time}` : ''}`;
  });
  return `即将到来：\n${lines.join('\n')}`;
}

function formatInventoryText(groups) {
  const block = (title, list) => {
    if (!list.length) return `${title}：无`;
    return `${title}（${list.length}）：\n` + list.map((i) => {
      const off = i.enabled ? '' : '（停用）';
      const sub = i.subtype ? ` · ${i.subtype}` : '';
      const t = i.time ? ` · ${i.time}` : '';
      return `• ${i.name}${sub}${t}${off}`;
    }).join('\n');
  };
  return [
    block('习惯', groups.habit),
    block('日子', groups.moment),
    block('待办', groups.task)
  ].join('\n\n');
}

/** Rotate learning topics (put first topic to end) and clear digest cache. */
async function rotateLearningTopics() {
  const config = await store.loadConfig();
  const topics = Array.isArray(config.digests?.learning?.topics) && config.digests.learning.topics.length
    ? [...config.digests.learning.topics]
    : ['前端', '算法', 'Git', 'HTTP'];
  if (topics.length > 1) {
    const first = topics.shift();
    topics.push(first);
  }
  config.digests = {
    ...(config.digests || {}),
    learning: {
      ...(config.digests?.learning || {}),
      topics,
      enabled: config.digests?.learning?.enabled !== false
    }
  };
  await store.saveConfig(config);
  digest.clearDigestCache();
  return { topics, next: topics[0] };
}

/**
 * Force-refresh and build one digest source card payload.
 * @param {'learning'|'github'|'news'} source
 * @param {{ refresh?: boolean }} opts
 */
async function buildDigestPush(source, opts = {}) {
  const labels = { learning: '每日编程', github: 'GitHub 热门', news: '科技快讯' };
  if (!labels[source]) return { ok: false, error: '未知订阅源' };
  if (opts.refresh) digest.clearDigestCache();
  const config = await store.loadConfig();
  if (config.digests?.enabled === false || config.digests?.[source]?.enabled === false) {
    return { ok: false, error: `「${labels[source]}」未开启，请到网页订阅页打开。` };
  }
  const today = dateStr();
  const brand = config.brand?.name || 'Nudge';
  const appUrl = process.env.APP_URL || '';
  const bundle = await digest.getDigestBundle(config, today, {
    withAI: config.digests?.ai_summary !== false
  });
  const sec = (bundle.sections || []).find((s) => s.id === source);
  if (!sec?.pushItems?.length) {
    return { ok: false, error: `「${labels[source]}」暂无内容。` };
  }
  const title = `${brand} · ${sec.title}`;
  const { createMarkdownDocument, shortenDigestMarkdown } = require('../feishu-doc');
  const feishuBot = require('../feishu-bot');
  const fullMd = (sec.pushItems || [])
    .map((i) => i.fullMarkdown || i.message || '')
    .filter(Boolean)
    .join('\n\n---\n\n');
  let docUrl = null;
  if (fullMd && feishuBot.botConfigured()) {
    const chatId = config.feishu?.chat_id;
    const doc = await createMarkdownDocument({
      title: `${title} · ${today}`,
      markdown: fullMd,
      folderToken: process.env.FEISHU_DOC_FOLDER_TOKEN || '',
      chatId
    });
    if (doc.ok) docUrl = doc.url;
  }
  const shortItems = (sec.pushItems || []).map((i) => ({
    ...i,
    message: i.shortMessage
      || shortenDigestMarkdown(i.fullMarkdown || i.message, i.blurb || i.desc)
  }));
  const cardBody = buildFeishuCard(today, shortItems, title, appUrl, brand, {
    docUrl: docUrl || undefined,
    openLabel: docUrl ? '阅读全文' : undefined
  });
  const preview = String(shortItems[0]?.message || '').slice(0, 400)
    + (docUrl ? `\n\n文档：${docUrl}` : '');
  return { ok: true, text: preview, card: cardBody, label: labels[source] };
}

async function buildRichChatContext() {
  const parts = [];
  const brand = (await store.loadConfig()).brand?.name || 'Nudge';
  parts.push(await buildSummaryText(brand));

  const data = await store.loadData();
  const n = nowParts();
  const today = dateStr();
  const pendingNote = [];
  for (const raw of migrateEvents(data.events)) {
    if (!raw.enabled || isAcked(raw, today)) continue;
    const r = checkEvent(raw, n);
    if (r && r.active && (r.days === 0 || r.cycleDay !== undefined)) {
      pendingNote.push(raw.name);
    }
  }
  if (pendingNote.length) {
    parts.push(`用户可回复「收到」确认：${pendingNote.join('、')}`);
  }

  for (const raw of migrateEvents(data.events)) {
    if (!raw.enabled || raw.type !== 'period') continue;
    const pred = predictPeriod(raw.schedule || {}, n);
    if (!pred) continue;
    parts.push(
      `经期「${raw.name}」：第 ${pred.day_in_cycle} 天`
      + (pred.in_period ? '（经期内）' : `，距下次约 ${pred.days_to_next ?? '—'} 天`)
    );
  }

  try {
    const config = await store.loadConfig();
    if (config.digests?.enabled !== false) {
      const bundle = await digest.getDigestBundle(config, today, { withAI: false });
      for (const sec of (bundle.sections || []).slice(0, 3)) {
        const titles = (sec.items || []).slice(0, 2).map((it) => it.title).filter(Boolean);
        if (titles.length) parts.push(`${sec.title}摘要：${titles.join('；')}`);
      }
    }
  } catch {
    /* ignore */
  }

  parts.push(
    '结构化指令（优先建议用户说这些，勿编造数据）：',
    '帮助、今天事项、生日、日程、清单、概况、',
    '今天学什么 / GitHub / 科技快讯、重新推送热点、换学习资料、哄哄她。',
    '若用户要改主题或重推，引导说「换学习资料」「换热点」「重新推送 GitHub」。',
    '没有把握的具体日期/人名，请承认并建议查「清单」或网页。'
  );
  return parts.join('\n');
}

module.exports = {
  listUpcoming,
  listBirthdays,
  listInventory,
  buildSummaryText,
  formatBirthdayText,
  formatUpcomingText,
  formatInventoryText,
  rotateLearningTopics,
  buildDigestPush,
  buildRichChatContext,
  dateStr,
  nowParts
};
