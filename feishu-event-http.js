/**
 * 飞书事件业务处理（确认收到 / DeepSeek 对话）
 */
const feishuBot = require('./feishu-bot');
const store = require('./store');
const engine = require('./engine');

const { loadData, saveData, loadConfig, saveConfig } = store;
const { migrateEvents, checkEvent, isAcked, ackEvent } = engine;

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
  const pending = [];
  for (const raw of migrateEvents(data.events)) {
    if (!raw.enabled || isAcked(raw, todayStr)) continue;
    const r = checkEvent(raw, n);
    if (!r || !r.active) continue;
    if (r.days === 0 || r.cycleDay !== undefined) {
      pending.push({ id: raw.id, name: raw.name, message: r.message });
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
async function rememberChatIdFromEvent(body) {
  try {
    const meta = feishuBot.extractMessageMeta(body || {});
    const chatId = String(meta.chatId || '').trim();
    if (!chatId) return;
    const config = await loadConfig();
    if (config.feishu?.chat_id === chatId) return;
    config.feishu = {
      ...(config.feishu || {}),
      chat_id: chatId
    };
    await saveConfig(config);
    console.log('[feishu] remembered chat_id', `${chatId.slice(0, 10)}…`);
  } catch (e) {
    console.warn('[feishu] remember chat_id failed', e.message);
  }
}

async function handleFeishuHttp(body) {
  await rememberChatIdFromEvent(body);
  return feishuBot.handleEvent(body || {}, {
    ackToday: ackTodayFromBot,
    listPending: listPendingToday
  });
}

module.exports = { handleFeishuHttp, ackTodayFromBot, listPendingToday };
