/**
 * 飞书事件业务处理（确认收到 / 结构化问答 / DeepSeek 对话）
 */
const feishuBot = require('./feishu-bot');
const store = require('./store');
const engine = require('./engine');
const { getDigestBundle } = require('./digest');

const { loadData, saveData, loadConfig, saveConfig } = store;
const {
  migrateEvents,
  checkEvent,
  isAcked,
  ackEvent,
  buildFeishuCard,
  buildAckedCard,
  predictPeriod,
  verifyAckSig
} = engine;

function tokenSecret() {
  return process.env.TOKEN_SECRET || 'reminder-hmac-v1-change-me';
}

function dateStr(tz = 'Asia/Shanghai') {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return fmt.format(d);
}

function nowParts(tz = 'Asia/Shanghai') {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    year: +get('year'),
    month: +get('month'),
    day: +get('day'),
    hour: +get('hour'),
    minute: +get('minute')
  };
}

async function listPendingToday() {
  const data = await loadData();
  const n = nowParts();
  const todayStr = dateStr();
  const { computeStreak, isStreakEligible } = require('./lib/streak');
  const pending = [];
  for (const raw of migrateEvents(data.events)) {
    if (!raw.enabled || isAcked(raw, todayStr)) continue;
    const r = checkEvent(raw, n);
    if (!r || !r.active) continue;
    if (r.days === 0 || r.cycleDay !== undefined) {
      pending.push({
        id: raw.id,
        name: raw.name,
        message: r.message,
        streak: isStreakEligible(raw) ? computeStreak(raw.acks, todayStr) : null
      });
    }
  }
  return pending;
}

async function ackTodayFromBot(nameHint) {
  const data = await loadData();
  const n = nowParts();
  const todayStr = dateStr();
  const pending = [];
  for (const raw of migrateEvents(data.events)) {
    if (!raw.enabled || isAcked(raw, todayStr)) continue;
    const r = checkEvent(raw, n);
    if (!r || !r.active) continue;
    if (r.days === 0 || r.cycleDay !== undefined) pending.push(raw);
  }
  if (!pending.length) return { text: '今天没有待确认的事项，都搞定了。', count: 0 };

  let targets = pending;
  if (nameHint) {
    const hit = pending.filter((e) => e.name.includes(nameHint) || nameHint.includes(e.name));
    if (!hit.length) {
      return {
        text: `没找到叫「${nameHint}」的待确认事项。今日还有：${pending.map((e) => e.name).join('、')}。可直接回「收到」确认全部。`,
        count: 0
      };
    }
    targets = hit;
  }

  const ids = new Set(targets.map((e) => e.id));
  data.events = data.events.map((e) => (ids.has(e.id) ? ackEvent(e, todayStr, 'feishu') : e));
  await saveData(data);
  const names = targets.map((e) => e.name).join('、');
  return {
    text: targets.length === pending.length && !nameHint
      ? `好的，今日 ${targets.length} 件已确认：${names}`
      : `已确认：${names}`,
    count: targets.length,
    names: targets.map((e) => e.name)
  };
}

/** 群里 @ 机器人后自动记下 chat_id，供主动推送（无需 Webhook） */
async function rememberChatId(chatId) {
  const id = String(chatId || '').trim();
  if (!id) return { ok: false, chat_id: null };
  const config = await loadConfig();
  if (config.feishu?.chat_id === id) return { ok: true, chat_id: id, unchanged: true };
  config.feishu = {
    ...(config.feishu || {}),
    chat_id: id
  };
  await saveConfig(config);
  console.log('[feishu] remembered chat_id', `${id.slice(0, 10)}…`);
  return { ok: true, chat_id: id };
}

async function rememberChatIdFromEvent(body) {
  try {
    const chatId = feishuBot.extractChatId(body || {});
    if (!chatId) {
      const meta = feishuBot.extractMessageMeta(body || {});
      if (meta.text) {
        console.warn('[feishu] got text but no chat_id', JSON.stringify({
          keys: Object.keys(body || {}),
          eventKeys: Object.keys(body?.event || {})
        }));
      }
      return { ok: false, chat_id: null };
    }
    return await rememberChatId(chatId);
  } catch (e) {
    console.warn('[feishu] remember chat_id failed', e.message);
    return { ok: false, chat_id: null, error: e.message };
  }
}

function helpText(brand) {
  return [
    `我是 ${brand}，飞书里可以这样说：`,
    '• 收到 — 确认今日事项',
    '• 今天事项 — 列出待确认',
    '• 今天学什么 — 推送今日编程精读卡',
    '• GitHub / 科技快讯 — 推送对应精选卡',
    '• 经期要注意什么 — 结合周期问答',
    '• 哄哄她 — 抽一句暖话（经期/生日会更贴境）',
    '• 绑定 — 记下推送群 chat_id',
    '• 帮助 — 再看一遍菜单',
    '',
    '也可以直接问别的，我会结合今日事项与订阅摘要回答。'
  ].join('\n');
}

async function periodContextNote() {
  const data = await loadData();
  const n = nowParts();
  const lines = [];
  for (const raw of migrateEvents(data.events)) {
    if (!raw.enabled || raw.type !== 'period') continue;
    const pred = predictPeriod(raw.schedule || {}, n);
    if (!pred) continue;
    lines.push(
      `经期「${raw.name}」：周期约 ${pred.cycle_length || '—'} 天，当前第 ${pred.day_in_cycle} 天`
      + (pred.in_period ? '（经期内）' : `，距下次约 ${pred.days_to_next ?? '—'} 天`)
      + `，置信度 ${pred.confidence || '—'}`
    );
  }
  return lines.join('；');
}

/** Context-aware 「哄哄她」 line for Feishu / API. */
async function buildComfortText(offset = 0) {
  const { pickComfort, formatComfortReply } = require('./lib/comfort');
  const data = await loadData();
  const n = nowParts();
  const today = dateStr();
  let picked = null;
  let name = '';

  for (const raw of migrateEvents(data.events)) {
    if (!raw.enabled) continue;
    const r = checkEvent(raw, n);
    if (!r || !r.active) continue;
    if (raw.type === 'period' && r.care) {
      picked = pickComfort({
        date: today,
        offset,
        context: 'period',
        periodSweet: r.care.sweet
      });
      name = raw.name;
      break;
    }
    if (raw.type === 'birthday' && r.days === 0) {
      picked = pickComfort({ date: today, offset, context: 'birthday' });
      name = raw.name;
      break;
    }
  }

  if (!picked) {
    // birthday within 3 days counts as birthday tone
    for (const raw of migrateEvents(data.events)) {
      if (!raw.enabled || raw.type !== 'birthday') continue;
      const r = checkEvent({ ...raw, enabled: true }, n);
      if (r && r.active && r.days != null && r.days <= 3) {
        picked = pickComfort({ date: today, offset, context: 'birthday' });
        name = raw.name;
        break;
      }
    }
  }

  if (!picked) picked = pickComfort({ date: today, offset, context: 'general' });
  return formatComfortReply(picked, name);
}

async function buildChatContext() {
  const parts = [];
  const pending = await listPendingToday();
  if (pending.length) {
    parts.push(`今日尚未确认：${pending.map((p) => p.name).join('、')}。可回复「收到」确认。`);
  }
  const period = await periodContextNote();
  if (period) parts.push(period);
  try {
    const config = await loadConfig();
    if (config.digests?.enabled !== false) {
      const bundle = await getDigestBundle(config, dateStr(), { withAI: false });
      for (const sec of (bundle.sections || []).slice(0, 3)) {
        const titles = (sec.items || []).slice(0, 2).map((it) => it.title).filter(Boolean);
        if (titles.length) parts.push(`${sec.title}摘要：${titles.join('；')}`);
      }
    }
  } catch {
    /* ignore digest errors in chat context */
  }
  parts.push('若用户问订阅内容，可建议说「今天学什么」「GitHub」「科技快讯」。');
  return parts.join('\n');
}

async function answerQa(intent, userText) {
  const config = await loadConfig();
  const brand = config.brand?.name || 'Nudge';
  const today = dateStr();
  const appUrl = process.env.APP_URL || '';

  if (intent === 'help') return { text: helpText(brand) };

  if (intent === 'today') {
    const pending = await listPendingToday();
    if (!pending.length) return { text: '今天没有待确认的事项，都搞定了。' };
    const lines = pending.map((p) => {
      const st = p.streak?.days >= 2 ? `（连续 ${p.streak.days} 天）` : '';
      return `• ${p.name}${st}${p.message ? `：${p.message}` : ''}`;
    });
    return { text: `今日待确认（${pending.length}）：\n${lines.join('\n')}\n\n回「收到」可一键确认。` };
  }

  if (intent === 'comfort') {
    return { text: await buildComfortText() };
  }

  if (intent === 'period') {
    const note = await periodContextNote();
    const context = [
      note || '用户可能关心经期，但当前没有启用的经期事项。',
      '回答要温和、非医疗诊断；可给休息/补水/记录建议。',
      '今日待确认事项也可顺带提醒。'
    ].join('\n');
    const chat = await feishuBot.chatWithDeepSeek(userText || '经期要注意什么', context);
    return { text: chat.text };
  }

  if (intent === 'learning' || intent === 'github' || intent === 'news') {
    const labels = { learning: '每日编程', github: 'GitHub 热门', news: '科技快讯' };
    if (config.digests?.enabled === false || config.digests?.[intent]?.enabled === false) {
      return { text: `「${labels[intent]}」未开启。请到网页「订阅」打开该源后，再说一次。` };
    }
    try {
      const bundle = await getDigestBundle(config, today, { withAI: config.digests?.ai_summary !== false });
      const sec = (bundle.sections || []).find((s) => s.id === intent);
      if (!sec?.pushItems?.length) {
        return { text: `「${labels[intent]}」暂无内容（抓取失败或为空）。可稍后再试，或在订阅页看预览。` };
      }
      const title = `${brand} · ${sec.title}`;
      const { createMarkdownDocument, shortenDigestMarkdown } = require('./feishu-doc');
      const fullMd = (sec.pushItems || [])
        .map((i) => i.fullMarkdown || i.message || '')
        .filter(Boolean)
        .join('\n\n---\n\n');
      let docUrl = null;
      if (fullMd && feishuBot.botConfigured()) {
        const chatId = (await loadConfig()).feishu?.chat_id;
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
      return { text: preview, card: cardBody };
    } catch (e) {
      return { text: `拉取「${labels[intent]}」失败：${e.message}` };
    }
  }

  return { text: '我没太理解。回「帮助」看可用指令。' };
}

function parseActionValue(raw) {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = {}; }
  }
  return value && typeof value === 'object' ? value : {};
}

/**
 * 飞书卡片按钮回调（card.action.trigger）
 * 必须在 3s 内返回 toast / card，供长连接或 HTTP 回传。
 */
async function handleCardAction(data) {
  const action = data?.action || data?.event?.action || {};
  const value = parseActionValue(action.value);
  const brand = (await loadConfig()).brand?.name || 'Nudge';
  const appUrl = process.env.APP_URL || '';

  if (value.action !== 'ack') {
    return {
      toast: { type: 'info', content: '未识别的操作', i18n: { zh_cn: '未识别的操作' } }
    };
  }

  const eventId = parseInt(value.id, 10);
  const date = String(value.date || dateStr()).slice(0, 10);
  const sig = String(value.sig || '');
  if (!Number.isFinite(eventId) || !verifyAckSig(eventId, date, sig, tokenSecret())) {
    return {
      toast: { type: 'error', content: '确认失败：签名无效', i18n: { zh_cn: '确认失败：签名无效' } }
    };
  }

  const dataStore = await loadData();
  const ev = (dataStore.events || []).find((e) => e.id === eventId);
  if (!ev) {
    return {
      toast: { type: 'error', content: '事项不存在或已删除', i18n: { zh_cn: '事项不存在或已删除' } }
    };
  }

  if (isAcked(ev, date)) {
    return {
      toast: { type: 'info', content: `「${ev.name}」今日已确认过`, i18n: { zh_cn: `「${ev.name}」今日已确认过` } },
      card: {
        type: 'raw',
        data: buildAckedCard(date, [ev.name], brand, appUrl)
      }
    };
  }

  dataStore.events = dataStore.events.map((e) => (e.id === eventId ? ackEvent(e, date, 'feishu-card') : e));
  await saveData(dataStore);

  return {
    toast: {
      type: 'success',
      content: `已确认：${ev.name}`,
      i18n: { zh_cn: `已确认：${ev.name}` }
    },
    card: {
      type: 'raw',
      data: buildAckedCard(date, [ev.name], brand, appUrl)
    }
  };
}

async function handleFeishuHttp(body) {
  const eventType = body?.header?.event_type || body?.type;
  if (eventType === 'card.action.trigger') {
    const result = await handleCardAction(body);
    return { http: 200, json: result };
  }

  await rememberChatIdFromEvent(body);
  return feishuBot.handleEvent(body || {}, {
    ackToday: ackTodayFromBot,
    listPending: listPendingToday,
    bindChat: async (chatId) => rememberChatId(chatId || feishuBot.extractChatId(body || {})),
    answerQa,
    buildChatContext
  });
}

module.exports = {
  handleFeishuHttp,
  handleCardAction,
  ackTodayFromBot,
  listPendingToday,
  rememberChatId,
  answerQa,
  buildChatContext,
  buildComfortText,
  helpText
};
