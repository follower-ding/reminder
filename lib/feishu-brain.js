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

/** Dedicated anniversaries list (anniversary subtype or custom yearly in moment space). */
async function listAnniversaries(withinDays = 60) {
  const data = await store.loadData();
  const n = nowParts();
  const rows = [];
  for (const raw of migrateEvents(data.events)) {
    if (!raw.enabled || raw.archived) continue;
    const isAnniv = raw.subtype === 'anniversary'
      || (raw.space === 'moment' && raw.type === 'custom' && raw.schedule?.mode === 'yearly' && raw.subtype !== 'birthday' && raw.subtype !== 'period');
    if (!isAnniv) continue;
    const r = checkEvent(raw, n);
    if (!r || !r.active || r.days == null) continue;
    if (r.days > withinDays) continue;
    rows.push({
      id: raw.id,
      name: raw.name,
      days: r.days,
      calendar: raw.calendar === 'lunar' ? '农历' : '阳历',
      time: raw.schedule?.time || '09:00',
      message: r.message || ''
    });
  }
  rows.sort((a, b) => a.days - b.days);
  return rows;
}

/** Search events by person name hint. Returns matching birthdays, anniversaries, and other related events. */
async function queryPerson(nameHint, withinDays = 365) {
  const data = await store.loadData();
  const n = nowParts();
  const hint = String(nameHint || '').trim().toLowerCase();
  if (!hint) return { hint: '', birthdays: [], anniversaries: [], other: [] };

  const result = { hint: nameHint.trim(), birthdays: [], anniversaries: [], other: [] };
  for (const raw of migrateEvents(data.events)) {
    if (!raw.enabled || raw.archived) continue;
    const ename = String(raw.name || '').toLowerCase();
    // Match: name contains hint or hint contains name
    if (!ename.includes(hint) && !hint.includes(ename)) continue;

    const isBday = raw.type === 'birthday' || raw.subtype === 'birthday';
    const isAnniv = raw.subtype === 'anniversary'
      || (raw.space === 'moment' && raw.type === 'custom' && raw.schedule?.mode === 'yearly' && !isBday && raw.subtype !== 'period');

    const r = checkEvent(raw, n);
    const days = (r && r.active && r.days != null) ? r.days : null;

    const entry = {
      id: raw.id,
      name: raw.name,
      days,
      calendar: raw.calendar === 'lunar' ? '农历' : '阳历',
      time: raw.schedule?.time || '09:00',
      month: raw.schedule?.month,
      day: raw.schedule?.day,
      birth_year: raw.birth_year || null,
      birth_solar: raw.birth_solar || null,
      enabled: !!raw.enabled
    };

    if (isBday) result.birthdays.push(entry);
    else if (isAnniv) result.anniversaries.push(entry);
    else result.other.push(entry);
  }
  result.birthdays.sort((a, b) => (a.days ?? 999) - (b.days ?? 999));
  result.anniversaries.sort((a, b) => (a.days ?? 999) - (b.days ?? 999));
  return result;
}

/** Search events by tag(s). Supports multiple tags (OR match). */
async function searchByTag(tagHint) {
  const data = await store.loadData();
  const n = nowParts();
  const hint = String(tagHint || '').trim().toLowerCase();
  if (!hint) return [];

  const results = [];
  for (const raw of migrateEvents(data.events)) {
    if (raw.archived) continue;
    const tags = (raw.tags || []).map((t) => String(t).toLowerCase());
    if (!tags.length) continue;
    // Fuzzy match: any tag contains hint or hint contains any tag
    const matched = tags.some((t) => t.includes(hint) || hint.includes(t));
    if (!matched) continue;

    const r = checkEvent(raw, n);
    const days = (r && r.active && r.days != null) ? r.days : null;
    results.push({
      id: raw.id,
      name: raw.name,
      space: raw.space || 'habit',
      subtype: raw.subtype || '',
      tags: raw.tags || [],
      enabled: !!raw.enabled,
      days,
      time: raw.schedule?.time || '09:00',
      mode: raw.schedule?.mode || ''
    });
  }
  // Sort: enabled first, then by days (upcoming first)
  results.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return (a.days ?? 999) - (b.days ?? 999);
  });
  return results;
}

/** List all unique tags across events. */
async function listAllTags() {
  const data = await store.loadData();
  const tagSet = new Set();
  for (const raw of migrateEvents(data.events)) {
    for (const t of (raw.tags || [])) {
      if (t) tagSet.add(String(t).trim());
    }
  }
  return [...tagSet].sort();
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

function formatAnniversaryText(rows) {
  if (!rows.length) return '近两个月没有登记的纪念日。可在网页「清单 → 日子」添加。';
  const lines = rows.map((a) => {
    const when = a.days === 0 ? '就是今天' : a.days === 1 ? '明天' : `${a.days} 天后`;
    return `• ${a.name} — ${when}（${a.calendar} · ${a.time}）`;
  });
  return `近期纪念日：\n${lines.join('\n')}`;
}

function formatPersonText(result) {
  const { hint, birthdays, anniversaries, other } = result;
  const total = birthdays.length + anniversaries.length + other.length;
  if (!total) return `没找到与「${hint}」相关的事项。试试在清单里搜索完整名称。`;

  const lines = [`「${hint}」相关事项（${total}）：`];
  for (const b of birthdays) {
    const when = b.days === 0 ? '🎂 今天！' : b.days === 1 ? '明天' : b.days != null ? `${b.days} 天后` : '未安排';
    const extra = [];
    if (b.birth_year) extra.push(`${b.birth_year}年生`);
    if (b.calendar) extra.push(b.calendar);
    if (b.month && b.day) extra.push(`${b.month}月${b.day}日`);
    const detail = extra.length ? `（${extra.join(' · ')}）` : '';
    lines.push(`• 🎂 ${b.name} — ${when}${detail}`);
  }
  for (const a of anniversaries) {
    const when = a.days === 0 ? '💝 今天！' : a.days === 1 ? '明天' : a.days != null ? `${a.days} 天后` : '未安排';
    const detail = a.month && a.day ? `（${a.month}月${a.day}日）` : '';
    lines.push(`• 💝 ${a.name} — ${when}${detail}`);
  }
  for (const o of other) {
    const when = o.days === 0 ? '今天' : o.days === 1 ? '明天' : o.days != null ? `${o.days} 天后` : '';
    lines.push(`• 📌 ${o.name}${when ? ` — ${when}` : ''}${o.enabled ? '' : '（已停用）'}`);
  }
  return lines.join('\n');
}

function formatTagSearchText(rows, tagHint) {
  if (!rows.length) return `没有找到标签含「${tagHint}」的事项。回复「标签」查看所有可用标签。`;
  const lines = [`标签「${tagHint}」相关事项（${rows.length}）：`];
  for (const r of rows) {
    const tags = r.tags.length ? ` [${r.tags.join(', ')}]` : '';
    const when = r.days === 0 ? ' · 今天' : r.days === 1 ? ' · 明天' : r.days != null ? ` · ${r.days}天后` : '';
    const off = r.enabled ? '' : '（停用）';
    const mode = r.mode && r.mode !== 'daily' ? ` · ${r.mode}` : '';
    lines.push(`• ${r.name}${tags}${when}${mode}${off}`);
  }
  return lines.join('\n');
}

function formatTagsText(tags) {
  if (!tags.length) return '当前没有任何标签。在网页清单里给事项添加标签（如"健康""前端""系统组件"），就可以在飞书里按标签查询了。';
  return `当前所有标签（${tags.length}）：\n${tags.map((t) => `• ${t}`).join('\n')}\n\n回复「查标签 XX」查看该标签下的事项。`;
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
  const data = await store.loadData();
  const n = nowParts();
  const today = dateStr();

  // 1. Summary header
  parts.push(await buildSummaryText(brand));

  // 2. Pending items for today
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

  // 3. ALL birthday persons with details (for person-specific queries)
  const allBirthdays = [];
  for (const raw of migrateEvents(data.events)) {
    if (!raw.enabled || raw.archived) continue;
    if (raw.type !== 'birthday' && raw.subtype !== 'birthday') continue;
    const r = checkEvent(raw, n);
    const entry = {
      name: raw.name,
      days: (r && r.active && r.days != null) ? r.days : null,
      calendar: raw.calendar === 'lunar' ? '农历' : '阳历',
      month: raw.schedule?.month,
      day: raw.schedule?.day,
      birth_year: raw.birth_year || null
    };
    allBirthdays.push(entry);
  }
  if (allBirthdays.length) {
    const bdayLines = allBirthdays.map((b) => {
      const when = b.days === 0 ? '今天' : b.days === 1 ? '明天' : b.days != null ? `${b.days}天后` : '未知';
      const extra = [];
      if (b.birth_year) extra.push(`${b.birth_year}年生`);
      if (b.month && b.day) extra.push(`${b.month}月${b.day}日(${b.calendar})`);
      return `  ${b.name}: ${when}${extra.length ? ' ' + extra.join(' ') : ''}`;
    }).join('\n');
    parts.push(`【所有生日人物】\n${bdayLines}`);
  }

  // 4. ALL anniversaries with details
  const allAnnivs = [];
  for (const raw of migrateEvents(data.events)) {
    if (!raw.enabled || raw.archived) continue;
    const isAnniv = raw.subtype === 'anniversary'
      || (raw.space === 'moment' && raw.type === 'custom' && raw.schedule?.mode === 'yearly'
        && raw.subtype !== 'birthday' && raw.subtype !== 'period');
    if (!isAnniv) continue;
    const r = checkEvent(raw, n);
    allAnnivs.push({
      name: raw.name,
      days: (r && r.active && r.days != null) ? r.days : null,
      month: raw.schedule?.month,
      day: raw.schedule?.day
    });
  }
  if (allAnnivs.length) {
    const annLines = allAnnivs.map((a) => {
      const when = a.days === 0 ? '今天' : a.days === 1 ? '明天' : a.days != null ? `${a.days}天后` : '未知';
      const date = a.month && a.day ? `${a.month}月${a.day}日` : '';
      return `  ${a.name}: ${when}${date ? ' ' + date : ''}`;
    }).join('\n');
    parts.push(`【所有纪念日】\n${annLines}`);
  }

  // 5. Tag inventory (for tag-based queries)
  const tagMap = new Map();
  for (const raw of migrateEvents(data.events)) {
    if (raw.archived) continue;
    for (const t of (raw.tags || [])) {
      if (!t) continue;
      const tag = String(t).trim();
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag).push(raw.name);
    }
  }
  if (tagMap.size) {
    const tagLines = [...tagMap.entries()].map(([tag, names]) => `  ${tag}: ${names.join('、')}`).join('\n');
    parts.push(`【标签索引】\n${tagLines}`);
  }

  // 6. Period context
  for (const raw of migrateEvents(data.events)) {
    if (!raw.enabled || raw.type !== 'period') continue;
    const pred = predictPeriod(raw.schedule || {}, n);
    if (!pred) continue;
    parts.push(
      `经期「${raw.name}」：第 ${pred.day_in_cycle} 天`
      + (pred.in_period ? '（经期内）' : `，距下次约 ${pred.days_to_next ?? '—'} 天`)
    );
  }

  // 7. Entity memory (learned facts about people/things)
  try {
    const brainDb = require('./feishu-brain-db');
    const entityCtx = await brainDb.buildEntityContext();
    if (entityCtx) parts.push(entityCtx);
  } catch { /* ignore */ }

  // 8. Digest titles
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
    '【回答指引】',
    '以上是系统实时数据。用户问某个人的生日/纪念日时，直接从【所有生日人物】【所有纪念日】中查找并回答。',
    '用户问标签分类时，从【标签索引】查找。若数据中没有，诚实说"没找到"并建议在网页添加。',
    '不要编造不存在的人名、日期或标签。',
    '结构化指令（优先建议用户说这些）：',
    '帮助、今天事项、生日、纪念日、日程、清单、概况、标签、',
    'XX的生日、XX的纪念日、查标签XX、前端相关的事项、',
    '今天学什么 / GitHub / 科技快讯、重新推送热点、换学习资料、哄哄她。'
  );
  return parts.join('\n');
}

module.exports = {
  listUpcoming,
  listBirthdays,
  listAnniversaries,
  queryPerson,
  searchByTag,
  listAllTags,
  listInventory,
  buildSummaryText,
  formatBirthdayText,
  formatAnniversaryText,
  formatUpcomingText,
  formatInventoryText,
  formatPersonText,
  formatTagSearchText,
  formatTagsText,
  rotateLearningTopics,
  buildDigestPush,
  buildRichChatContext,
  dateStr,
  nowParts
};
