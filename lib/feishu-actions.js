/**
 * Safe Feishu write actions: find by name, snooze, toggle, create habit (with confirm).
 */
const store = require('../store');
const engine = require('../engine');

const { migrateEvents, migrateEvent, ackEvent, checkEvent } = engine;

function dateStr(tz = 'Asia/Shanghai') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
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

function scoreName(evName, hint) {
  const a = String(evName || '').toLowerCase();
  const b = String(hint || '').toLowerCase().trim();
  if (!b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 80;
  return 0;
}

async function findEventsByHint(nameHint) {
  const data = await store.loadData();
  const hint = String(nameHint || '').trim();
  if (!hint) return [];
  const scored = migrateEvents(data.events)
    .filter((e) => !e.archived)
    .map((e) => ({ ev: e, score: scoreName(e.name, hint) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((x) => x.ev);
}

async function resolveOneEvent(nameHint) {
  const list = await findEventsByHint(nameHint);
  if (!list.length) return { ok: false, error: `没找到叫「${nameHint}」的事项。` };
  if (list.length > 1 && scoreName(list[0].name, nameHint) < 100) {
    const names = list.slice(0, 5).map((e) => e.name).join('、');
    return { ok: false, error: `找到多个相似事项：${names}。请说得更具体一点。`, candidates: list };
  }
  return { ok: true, event: list[0] };
}

async function snoozeEvent(eventId, days = 1) {
  const data = await store.loadData();
  const idx = data.events.findIndex((e) => e.id === eventId);
  if (idx < 0) return { ok: false, error: '事项不存在' };
  const until = addDaysYmd(dateStr(), Math.max(1, days | 0));
  data.events[idx] = { ...migrateEvent(data.events[idx]), snooze_until: until };
  await store.saveData(data);
  return { ok: true, name: data.events[idx].name, snooze_until: until };
}

async function setEnabled(eventId, enabled) {
  const data = await store.loadData();
  const idx = data.events.findIndex((e) => e.id === eventId);
  if (idx < 0) return { ok: false, error: '事项不存在' };
  data.events[idx] = { ...data.events[idx], enabled: !!enabled };
  await store.saveData(data);
  return { ok: true, name: data.events[idx].name, enabled: !!enabled };
}

async function createDailyHabit(name, time = '09:00') {
  const data = await store.loadData();
  const nextId = data.events.length
    ? Math.max(...data.events.map((e) => Number(e.id) || 0)) + 1
    : 1;
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) return { ok: false, error: '名称不能为空' };
  const ev = engine.normalizeEventInput
    ? engine.normalizeEventInput({
      id: nextId,
      name: clean,
      space: 'habit',
      type: 'custom',
      enabled: true,
      schedule: { mode: 'daily', time: time || '09:00' },
      messages: { default: `⏰ ${clean}` }
    })
    : {
      id: nextId,
      name: clean,
      space: 'habit',
      type: 'custom',
      enabled: true,
      schedule: { mode: 'daily', time: time || '09:00' },
      messages: { default: `⏰ ${clean}` }
    };
  data.events.push(ev);
  await store.saveData(data);
  return { ok: true, event: ev };
}

/**
 * Execute a confirmed pending action.
 * @param {{ type: string, eventId?: number, name?: string, days?: number, time?: string }} action
 */
async function executePending(action) {
  if (!action || !action.type) return { ok: false, text: '没有待确认的操作。' };
  if (action.type === 'snooze') {
    const r = await snoozeEvent(action.eventId, action.days || 1);
    if (!r.ok) return { ok: false, text: r.error };
    return { ok: true, text: `已把「${r.name}」推迟到 ${r.snooze_until}（当天前不再提醒）。` };
  }
  if (action.type === 'disable') {
    const r = await setEnabled(action.eventId, false);
    if (!r.ok) return { ok: false, text: r.error };
    return { ok: true, text: `已停用「${r.name}」。可以说「启用 ${r.name}」再打开。` };
  }
  if (action.type === 'enable') {
    const r = await setEnabled(action.eventId, true);
    if (!r.ok) return { ok: false, text: r.error };
    return { ok: true, text: `已启用「${r.name}」。` };
  }
  if (action.type === 'create_habit') {
    const r = await createDailyHabit(action.name, action.time);
    if (!r.ok) return { ok: false, text: r.error };
    return { ok: true, text: `已添加习惯「${r.event.name}」（每天 ${r.event.schedule?.time || '09:00'}）。` };
  }
  return { ok: false, text: `未知操作：${action.type}` };
}

function matchConfirmIntent(text) {
  const t = String(text || '').trim();
  if (/^(确认|确定|好的|执行|可以|嗯|是的|yes|ok)$/i.test(t)) return { intent: 'confirm_yes' };
  if (/^(取消|算了|不要|否|no|cancel)$/i.test(t)) return { intent: 'confirm_no' };
  return null;
}

/** Extract name hint from phrases like 推迟跑步 / 帮我确认喝水 */
function extractNameAfter(verbs, text) {
  const t = String(text || '').trim();
  for (const v of verbs) {
    const m = t.match(new RegExp(`${v}\\s*[：:]?\\s*(.+)$`));
    if (m && m[1]) return m[1].replace(/[的了吧呀呢]+$/, '').trim();
  }
  return null;
}

module.exports = {
  dateStr,
  addDaysYmd,
  nowParts,
  findEventsByHint,
  resolveOneEvent,
  snoozeEvent,
  setEnabled,
  createDailyHabit,
  executePending,
  matchConfirmIntent,
  extractNameAfter
};
