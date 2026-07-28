/**
 * 飞书事件业务处理（确认收到 / 结构化问答 / DeepSeek 对话）
 */
const feishuBot = require('./feishu-bot');
const store = require('./store');
const engine = require('./engine');
const { loadData, saveData, loadConfig, saveConfig } = store;
const {
  migrateEvents,
  checkEvent,
  isAcked,
  ackEvent,
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
    `我是 ${brand}，飞书里可以直接说话，不必背口令。`,
    '例如：「最近谁过生日」「这周有什么安排」「把热点再推一次」「换点学习资料」。',
    '',
    '【常用动作】',
    '• 收到 — 确认今日事项',
    '• 今天事项 / 生日 / 日程 / 清单 / 概况 — 查询',
    '• 今天学什么 / GitHub / 科技快讯 — 推送精选卡',
    '• 换学习资料 · 换热点 · 重新推送热点 — 订阅控制',
    '• 经期要注意什么 · 哄哄她 — 关怀',
    '• 绑定 — 记下推送群',
    '• 帮助 — 再看一遍',
    '',
    '其它话我会结合今日事项与订阅摘要回答；能执行的动作会自动帮你做。'
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
  const brain = require('./lib/feishu-brain');
  try {
    return await brain.buildRichChatContext();
  } catch (e) {
    const parts = [];
    const pending = await listPendingToday();
    if (pending.length) {
      parts.push(`今日尚未确认：${pending.map((p) => p.name).join('、')}。可回复「收到」确认。`);
    }
    const period = await periodContextNote();
    if (period) parts.push(period);
    parts.push(`上下文组装失败：${e.message}`);
    return parts.join('\n');
  }
}

async function pushDigestSource(source, { refresh = false } = {}) {
  const brain = require('./lib/feishu-brain');
  const r = await brain.buildDigestPush(source, { refresh });
  if (!r.ok) return { text: r.error || '推送失败' };
  return { text: r.text, card: r.card };
}

async function answerQa(intent, userText, qaMeta = {}) {
  const config = await loadConfig();
  const brand = config.brand?.name || 'Nudge';
  const brain = require('./lib/feishu-brain');

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

  if (intent === 'birthdays') {
    return { text: brain.formatBirthdayText(await brain.listBirthdays(60)) };
  }
  if (intent === 'upcoming') {
    return { text: brain.formatUpcomingText(await brain.listUpcoming(14)) };
  }
  if (intent === 'inventory') {
    return { text: brain.formatInventoryText(await brain.listInventory()) };
  }
  if (intent === 'summary') {
    return { text: await brain.buildSummaryText(brand) };
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

  if (intent === 'rotate_learning') {
    try {
      const rot = await brain.rotateLearningTopics();
      const pushed = await pushDigestSource('learning', { refresh: true });
      const tip = `已轮换课题，下一项侧重「${rot.next}」。课题顺序：${rot.topics.join(' → ')}`;
      if (pushed.card) return { text: `${tip}\n\n${pushed.text || ''}`, card: pushed.card };
      return { text: `${tip}\n${pushed.text || ''}` };
    } catch (e) {
      return { text: `换学习资料失败：${e.message}` };
    }
  }

  if (intent === 'refresh_news') return pushDigestSource('news', { refresh: true });
  if (intent === 'refresh_github') return pushDigestSource('github', { refresh: true });

  if (intent === 'repost_digest') {
    const source = qaMeta.source || 'news';
    const labels = { learning: '每日编程', github: 'GitHub 热门', news: '科技快讯' };
    const pushed = await pushDigestSource(source, { refresh: true });
    if (pushed.card) {
      return {
        text: `已重新推送「${labels[source] || source}」\n\n${pushed.text || ''}`,
        card: pushed.card
      };
    }
    return { text: pushed.text };
  }

  if (intent === 'learning' || intent === 'github' || intent === 'news') {
    return pushDigestSource(intent, { refresh: false });
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
