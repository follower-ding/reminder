/**
 * Nudge engine — space 模型 + 调度 + 卡片
 */
const crypto = require('crypto');
const { lunarToSolar, solarToLunar } = require('./lib/lunar');

const TYPE_META = {
  birthday: { label: '生日', icon: '🎂', modes: ['yearly'], headerColor: 'orange' },
  period: { label: '经期', icon: '🩸', modes: ['cycle'], headerColor: 'carmine' },
  custom: { label: '自定义', icon: '📌', modes: ['daily', 'weekly', 'monthly', 'yearly'], headerColor: 'turquoise' }
};

const SPACE_META = {
  habit: { label: '习惯', hint: '每天 / 每周重复' },
  moment: { label: '日子', hint: '生日、经期、纪念日' },
  task: { label: '待办', hint: '临时一次' }
};

const LEGACY_TYPE_MAP = {
  anniversary: { type: 'custom', mode: 'yearly' },
  festival: { type: 'custom', mode: 'yearly' },
  checkup: { type: 'custom', mode: 'yearly' },
  medicine: { type: 'custom', mode: 'daily' },
  health: { type: 'custom', mode: 'daily' },
  bill: { type: 'custom', mode: 'monthly' }
};

function syncTypeFromSpace(out) {
  if (out.space === 'moment') {
    if (out.subtype === 'period') out.type = 'period';
    else if (out.subtype === 'birthday') out.type = 'birthday';
    else {
      out.type = 'custom';
      out.subtype = out.subtype || 'anniversary';
      if (!out.schedule.mode) out.schedule.mode = 'yearly';
    }
  } else {
    out.type = 'custom';
    if (out.space === 'habit' && !out.schedule.mode) out.schedule.mode = 'daily';
    if (out.space === 'task' && !out.schedule.mode) out.schedule.mode = 'daily';
  }
  return out;
}

function migrateEvent(ev) {
  if (!ev || typeof ev !== 'object') return ev;
  const out = {
    ...ev,
    schedule: { ...(ev.schedule || {}) },
    messages: { ...(ev.messages || {}) },
    acks: ev.acks && typeof ev.acks === 'object' ? { ...ev.acks } : {}
  };
  const legacy = LEGACY_TYPE_MAP[out.type];
  if (legacy) {
    out.type = legacy.type;
    if (!out.schedule.mode) out.schedule.mode = legacy.mode;
    out._migratedFrom = ev.type;
  }
  if (!TYPE_META[out.type]) out.type = 'custom';
  if (out.type === 'birthday' && !out.schedule.mode) out.schedule.mode = 'yearly';
  if (out.type === 'period' && !out.schedule.mode) out.schedule.mode = 'cycle';

  if (!out.space) {
    if (out.type === 'birthday' || out.type === 'period') out.space = 'moment';
    else if (out._migratedFrom === 'anniversary' || out._migratedFrom === 'festival') {
      out.space = 'moment';
      out.subtype = 'anniversary';
    } else if (out.category === 'temporary') out.space = 'task';
    else out.space = 'habit';
  }
  if (!['habit', 'moment', 'task'].includes(out.space)) out.space = 'habit';
  if (out.space === 'moment' && !out.subtype) {
    out.subtype = out.type === 'period' ? 'period' : out.type === 'birthday' ? 'birthday' : 'anniversary';
  }
  return syncTypeFromSpace(out);
}

function migrateEvents(events) {
  return (events || []).map(migrateEvent);
}

function isAcked(ev, dateYmd) {
  const e = migrateEvent(ev);
  return !!(e.acks && e.acks[dateYmd]);
}

function isArchived(ev) {
  return !!(ev && (ev.archived === true || ev.archived === 1));
}

/** HMAC 深链签名：eventId + date */
function createAckSig(eventId, dateYmd, secret) {
  const key = secret || process.env.TOKEN_SECRET || 'reminder-hmac-v1-change-me';
  const payload = `${parseInt(eventId, 10)}.${String(dateYmd).slice(0, 10)}`;
  return crypto.createHmac('sha256', key).update(payload).digest('base64url');
}

function verifyAckSig(eventId, dateYmd, sig, secret) {
  if (!sig || typeof sig !== 'string') return false;
  const expected = createAckSig(eventId, dateYmd, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function buildAckUrl(appUrl, eventId, dateYmd, via, secret) {
  const base = String(appUrl || process.env.APP_URL || 'https://reminder-three-gamma.vercel.app').replace(/\/$/, '');
  const date = String(dateYmd).slice(0, 10);
  const sig = createAckSig(eventId, date, secret);
  const v = encodeURIComponent(via || 'feishu');
  // 路径型深链（无 ?a=&b=）：飞书 Markdown/部分客户端会截断 & 导致丢 sig、只打开首页
  return `${base}/api/ack/${parseInt(eventId, 10)}/${date}/${encodeURIComponent(sig)}/${v}`;
}

/** 飞书卡片按钮回调 value（不跳转网页） */
function buildAckValue(eventId, dateYmd, secret) {
  const date = String(dateYmd).slice(0, 10);
  const id = String(parseInt(eventId, 10));
  return {
    action: 'ack',
    id,
    date,
    sig: createAckSig(id, date, secret)
  };
}

function buildAckedCard(dateLabel, names, brandName, appUrl) {
  const brand = brandName || 'Nudge';
  const url = appUrl || process.env.APP_URL || 'https://reminder-three-gamma.vercel.app';
  const list = Array.isArray(names) ? names.filter(Boolean) : [names].filter(Boolean);
  const label = list.length ? list.join('、') : '事项';
  return {
    header: {
      title: { tag: 'plain_text', content: `${brand} · 已确认` },
      template: 'green'
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `✅ **已在飞书确认** · ${dateLabel}\n\n${label}\n\n无需打开网页。误点可在清单里撤销今日确认。`
        }
      },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '打开清单' },
            type: 'default',
            multi_url: { url, android_url: url, ios_url: url, pc_url: url }
          }
        ]
      }
    ]
  };
}

/**
 * 确认收到。待办（task）确认后归档停用，习惯/日子仅写 acks。
 */
function ackEvent(ev, dateYmd, via) {
  const e = migrateEvent(ev);
  const day = String(dateYmd).slice(0, 10);
  const acks = { ...(e.acks || {}) };
  acks[day] = { at: new Date().toISOString(), via: via || 'app' };
  let out = { ...e, acks };
  if (e.space === 'task') {
    out = {
      ...out,
      enabled: false,
      archived: true,
      archived_at: new Date().toISOString()
    };
  }
  return out;
}

/** 撤销某日确认；若因确认而归档的待办则恢复启用 */
function unackEvent(ev, dateYmd) {
  const e = migrateEvent(ev);
  const day = String(dateYmd).slice(0, 10);
  const acks = { ...(e.acks || {}) };
  delete acks[day];
  let out = { ...e, acks };
  if (e.space === 'task' && isArchived(e)) {
    out = {
      ...out,
      enabled: true,
      archived: false,
      archived_at: null
    };
  }
  return out;
}

function parseHHMM(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function eventPushTime(ev, defaultTime) {
  return parseHHMM(ev?.schedule?.time) || parseHHMM(defaultTime) || { hour: 9, minute: 0 };
}

/** 到点后可推：catchUp=true 时「已过计划时刻且当日未推」即命中（靠 ledger 防重）。 */
function matchesPushWindow(ev, n, defaultTime, options = {}) {
  if (options.ignoreTime) return true;
  const t = eventPushTime(ev, defaultTime);
  const planned = t.hour * 60 + t.minute;
  const nowM = (n.hour || 0) * 60 + (n.minute || 0);
  if (options.catchUp) return nowM >= planned;
  const window = options.windowMinutes != null ? options.windowMinutes : 5;
  if (window <= 0) return planned === nowM;
  return nowM >= planned && nowM < planned + window;
}

function plannedTimeLabel(ev, defaultTime) {
  const t = eventPushTime(ev, defaultTime);
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

function parseYMD(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { year: +m[1], month: +m[2], day: +m[3] };
}

function ymdToDate(p) {
  return new Date(p.year, p.month - 1, p.day);
}

function dateToYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetweenParts(a, b) {
  return Math.floor((ymdToDate(a) - ymdToDate(b)) / 86400000);
}

/** 经期预测：用历史间隔均值；不足则用 cycle_length。 */
function predictPeriod(sched, n) {
  const history = Array.isArray(sched.cycle_history)
    ? sched.cycle_history.map(String).filter(Boolean).sort()
    : [];
  let lastStartStr = history.length ? history[history.length - 1] : sched.last_start;
  if (!lastStartStr) return null;
  const last = parseYMD(lastStartStr);
  if (!last) return null;

  let cycleLen = sched.cycle_length || 28;
  let variance = 3;
  let confidence = 'low';
  if (history.length >= 2) {
    const intervals = [];
    for (let i = 1; i < history.length; i++) {
      const a = parseYMD(history[i - 1]);
      const b = parseYMD(history[i]);
      if (a && b) intervals.push(daysBetweenParts(b, a));
    }
    if (intervals.length) {
      cycleLen = Math.round(intervals.reduce((s, x) => s + x, 0) / intervals.length);
      const maxDev = Math.max(...intervals.map((x) => Math.abs(x - cycleLen)));
      variance = Math.max(2, Math.min(5, maxDev || 3));
      confidence = history.length >= 4 ? 'high' : 'medium';
    }
  }

  const periodLen = sched.period_length || 5;
  const nowDate = ymdToDate(n);
  const lastDate = ymdToDate(last);
  const daysSince = Math.floor((nowDate - lastDate) / 86400000);
  const dayInCycle = ((daysSince % cycleLen) + cycleLen) % cycleLen;
  const daysToNext = dayInCycle === 0 && daysSince > 0 ? 0 : cycleLen - dayInCycle;
  const nextStart = new Date(lastDate);
  nextStart.setDate(nextStart.getDate() + (daysSince <= 0 ? 0 : Math.ceil(daysSince / cycleLen) * cycleLen));
  if (daysSince > 0 && dayInCycle !== 0) {
    nextStart.setTime(lastDate.getTime());
    nextStart.setDate(lastDate.getDate() + daysSince + daysToNext);
  }
  const overdue = daysSince > cycleLen + variance;

  return {
    last_start: lastStartStr,
    cycle_length: cycleLen,
    period_length: periodLen,
    variance,
    confidence,
    day_in_cycle: dayInCycle + 1,
    days_to_next: daysToNext === cycleLen ? 0 : daysToNext,
    next_start: dateToYMD(nextStart),
    in_period: dayInCycle < periodLen,
    in_ovulation: dayInCycle >= cycleLen - 14 - 3 && dayInCycle <= cycleLen - 14 + 3,
    overdue,
    history_count: history.length
  };
}

function logPeriodStart(ev, startDate) {
  const sched = { ...(ev.schedule || {}) };
  const history = Array.isArray(sched.cycle_history) ? [...sched.cycle_history] : [];
  const ymd = String(startDate).slice(0, 10);
  if (!history.includes(ymd)) history.push(ymd);
  history.sort();
  sched.cycle_history = history.slice(-12);
  sched.last_start = ymd;
  if (history.length >= 2) {
    const intervals = [];
    for (let i = 1; i < history.length; i++) {
      const a = parseYMD(history[i - 1]);
      const b = parseYMD(history[i]);
      if (a && b) intervals.push(daysBetweenParts(b, a));
    }
    if (intervals.length) {
      sched.cycle_length = Math.round(intervals.reduce((s, x) => s + x, 0) / intervals.length);
    }
  }
  return { ...ev, schedule: sched, type: 'period' };
}

function checkEvent(ev, n) {
  const e = migrateEvent(ev);
  if (!e.enabled) return null;
  const sched = e.schedule || {};
  const mode = sched.mode || (e.type === 'period' ? 'cycle' : e.type === 'birthday' ? 'yearly' : 'daily');
  const ahead = e.remind_ahead || 0;
  const msg = e.messages || {};
  const meta = TYPE_META[e.type] || TYPE_META.custom;

  if (mode === 'daily') {
    return {
      active: true,
      message: msg.default || `⏰ ${e.name}`,
      urgent: true,
      days: 0,
      name: e.name,
      type: e.type,
      time: sched.time || null
    };
  }

  if (mode === 'weekly') {
    const dayOfWeek = sched.day_of_week;
    const dow = new Date(n.year, n.month - 1, n.day).getDay();
    if (dayOfWeek !== undefined && dow === dayOfWeek) {
      return {
        active: true,
        message: msg.default || `📅 ${e.name}`,
        urgent: true,
        days: 0,
        name: e.name,
        type: e.type,
        time: sched.time || null
      };
    }
    return null;
  }

  if (mode === 'monthly' || mode === 'yearly') {
    const month = mode === 'monthly' ? n.month : sched.month || 1;
    const mday = sched.day || 1;
    let targetDay;
    if (e.calendar === 'lunar' && mode === 'yearly' && month >= 1 && month <= 12) {
      const ld = lunarToSolar(month, mday, n.year);
      targetDay = ld || new Date(n.year, month - 1, mday);
    } else {
      targetDay = new Date(n.year, month - 1, mday);
    }
    let diff = Math.floor((targetDay - new Date(n.year, n.month - 1, n.day)) / 86400000);
    if (mode === 'yearly' && diff < 0) {
      if (e.calendar === 'lunar') {
        const nextLunar = lunarToSolar(month, mday, n.year + 1);
        targetDay = nextLunar || new Date(n.year + 1, month - 1, mday);
      } else {
        targetDay.setFullYear(n.year + 1);
      }
      diff = Math.floor((targetDay - new Date(n.year, n.month - 1, n.day)) / 86400000);
    }
    if (mode === 'monthly' && diff < 0) {
      targetDay.setMonth(n.month);
      diff = Math.floor((targetDay - new Date(n.year, n.month - 1, n.day)) / 86400000);
    }
    const daysStr = String(diff);
    if (diff === 0) {
      const m = msg.today
        ? msg.today.replace(/\{days\}/g, daysStr).replace(/\{name\}/g, e.name)
        : `${meta.icon} ${e.name} — 就是今天！`;
      return { active: true, message: m, urgent: true, days: 0, name: e.name, type: e.type, time: sched.time || null };
    }
    if (diff > 0 && diff <= ahead) {
      const m = msg.reminder
        ? msg.reminder.replace(/\{days\}/g, daysStr).replace(/\{name\}/g, e.name)
        : `${meta.icon} ${e.name} — 还有 ${diff} 天`;
      return { active: true, message: m, urgent: false, days: diff, name: e.name, type: e.type, time: sched.time || null };
    }
    return null;
  }

  if (mode === 'cycle') {
    const pred = predictPeriod(sched, n);
    if (!pred) return null;
    if (pred.in_period) {
      const key = `day_${pred.day_in_cycle}`;
      return {
        active: true,
        message: msg[key] || `🩸 经期第 ${pred.day_in_cycle} 天`,
        urgent: true,
        days: 0,
        cycleDay: pred.day_in_cycle,
        name: e.name,
        type: 'period',
        prediction: pred,
        time: sched.time || null
      };
    }
    if (pred.in_ovulation) {
      return {
        active: true,
        message: msg.ovulation || '🥚 排卵期，注意休息与观察',
        urgent: false,
        days: 0,
        cycleDay: pred.day_in_cycle,
        name: e.name,
        type: 'period',
        prediction: pred,
        time: sched.time || null
      };
    }
    if (pred.overdue) {
      return {
        active: true,
        message: msg.late || `🩸 可能已推迟（预测周期约 ${pred.cycle_length} 天），记得打卡记录`,
        urgent: true,
        days: 0,
        cycleDay: pred.day_in_cycle,
        name: e.name,
        type: 'period',
        prediction: pred,
        time: sched.time || null
      };
    }
    const preDays = sched.remind_ahead_cycle || 3;
    if (pred.days_to_next > 0 && pred.days_to_next <= preDays) {
      return {
        active: true,
        message: msg.pre || `🩸 经期预计还有 ${pred.days_to_next} 天（约 ${pred.next_start}）`,
        urgent: false,
        days: pred.days_to_next,
        cycleDay: pred.day_in_cycle,
        name: e.name,
        type: 'period',
        prediction: pred,
        time: sched.time || null
      };
    }
    return null;
  }

  return null;
}

function buildRecommendations(events, n) {
  const recs = [];
  for (const raw of migrateEvents(events)) {
    if (!raw.enabled) continue;
    const sched = raw.schedule || {};
    if (raw.type === 'period') {
      const pred = predictPeriod(sched, n);
      if (!pred) {
        recs.push({ type: 'period', name: raw.name, message: '补充「上次开始日期」或打卡，即可开启周期预测', priority: 1 });
        continue;
      }
      const confLabel = { low: '参考', medium: '较准', high: '稳定' }[pred.confidence] || '参考';
      if (pred.overdue) {
        recs.push({ type: 'period', name: raw.name, message: `周期可能推迟（置信 ${confLabel}）。点「今天开始了」更新预测`, priority: 1, prediction: pred });
      } else if (pred.in_period) {
        recs.push({ type: 'period', name: raw.name, message: `经期第 ${pred.day_in_cycle} 天 · 预计周期 ${pred.cycle_length}±${pred.variance} 天`, priority: 1, prediction: pred });
      } else if (pred.days_to_next <= 5) {
        recs.push({ type: 'period', name: raw.name, message: `预计 ${pred.next_start} 开始（还有 ${pred.days_to_next} 天 · ${confLabel}）`, priority: 1, prediction: pred });
      } else {
        recs.push({ type: 'period', name: raw.name, message: `下次预计 ${pred.next_start} · 周期约 ${pred.cycle_length} 天（${confLabel}）`, priority: 2, prediction: pred });
      }
    }
    if (raw.type === 'birthday' && sched.mode === 'yearly') {
      const target = new Date(n.year, (sched.month || 1) - 1, sched.day || 1);
      const nowDate = new Date(n.year, n.month - 1, n.day);
      let diff = Math.floor((target - nowDate) / 86400000);
      if (diff < 0) {
        target.setFullYear(n.year + 1);
        diff = Math.floor((target - nowDate) / 86400000);
      }
      if (diff <= 14 && diff >= 0) {
        recs.push({ type: 'birthday', name: raw.name, message: diff === 0 ? '今天生日，别忘了祝福' : `还有 ${diff} 天生日，可以准备礼物啦`, priority: 2 });
      }
    }
    if (raw.type === 'custom' && sched.mode === 'daily' && sched.time) {
      recs.push({ type: 'custom', name: raw.name, message: `每日 ${sched.time} 提醒已设定`, priority: 3 });
    }
  }
  return recs.sort((a, b) => a.priority - b.priority);
}

function collectDueItems(events, n, options = {}) {
  const defaultTime = options.defaultTime || '09:00';
  const ignoreTime = !!options.ignoreTime;
  const windowMinutes = options.windowMinutes != null ? options.windowMinutes : 5;
  const catchUp = !!options.catchUp;
  const dateYmd = options.dateYmd;
  const skipAcked = !!options.skipAcked;
  const migrated = migrateEvents(events).filter((ev) => ev.enabled !== false && !isArchived(ev));
  const checked = migrated.map((ev) => {
    if (skipAcked && dateYmd && isAcked(ev, dateYmd)) return null;
    const r = checkEvent(ev, n);
    if (!r || !r.active) return null;
    if (!matchesPushWindow(ev, n, defaultTime, { ignoreTime, windowMinutes, catchUp })) return null;
    return {
      ...r,
      eventId: ev.id,
      name: ev.name,
      space: ev.space || 'habit',
      planned_time: plannedTimeLabel(ev, defaultTime),
      category: ev.space === 'task' ? 'temporary' : 'long_term'
    };
  }).filter(Boolean);

  const today = checked.filter((r) => r.days === 0 || r.cycleDay !== undefined);
  const upcoming = checked.filter((r) => r.days !== undefined && r.days > 0 && r.days <= 7 && r.cycleDay === undefined);
  return { today, upcoming, all: [...today, ...upcoming] };
}

function isRichDigestFormat(fmt) {
  return fmt === 'lesson' || fmt === 'article';
}

function formatItemLine(x) {
  const msg = x.message || x.name || '事项';
  if (isRichDigestFormat(x.format)) return msg;
  // 确认走卡片按钮回调，正文不再放跳转链接
  if (x.eventId || x.ackValue || x.ackUrl) return `• ${msg}`;
  return `• ${msg}`;
}

function digestLeadLine(dateLabel, brand, title, groups) {
  const t = String(title || '');
  if (groups.digest.every((i) => i.format === 'lesson') || t.includes('编程')) {
    return `✨ **${dateLabel}** · ${brand}\n今日编程精读（可直接在飞书读完）`;
  }
  if (t.includes('GitHub') || groups.digest.some((i) => i.source === 'github')) {
    return `✨ **${dateLabel}** · ${brand}\n今日开源精选（可直接在飞书读完）`;
  }
  if (t.includes('快讯') || t.includes('科技') || groups.digest.some((i) => i.source === 'news')) {
    return `✨ **${dateLabel}** · ${brand}\n今日科技精读（可直接在飞书读完）`;
  }
  if (groups.digest.every((i) => isRichDigestFormat(i.format))) {
    return `✨ **${dateLabel}** · ${brand}\n今日精读（可直接在飞书读完）`;
  }
  return `✨ **${dateLabel}** · ${brand}\n今日热点精选`;
}

function buildFeishuCard(dateLabel, items, title, appUrl, brandName, options = {}) {
  const url = appUrl || process.env.APP_URL || 'https://reminder-three-gamma.vercel.app';
  const brand = brandName || 'Nudge';
  const docUrl = options.docUrl || null;
  const openUrl = docUrl || url;
  const openLabel = options.openLabel
    || (docUrl ? '阅读全文' : null);
  const groups = { period: [], birthday: [], custom: [], digest: [], other: [] };
  for (const i of items || []) {
    if (i.kind === 'digest' || i.type === 'digest') groups.digest.push(i);
    else if (groups[i.type]) groups[i.type].push(i);
    else groups.other.push(i);
  }

  const sections = [];
  const pushSection = (key, heading) => {
    const list = groups[key];
    if (!list.length) return;
    if (key === 'digest' && list.every((i) => isRichDigestFormat(i.format))) {
      sections.push(list.map((i) => i.message || '').join('\n\n'));
      return;
    }
    sections.push(`**${heading}**\n${list.map(formatItemLine).join('\n')}`);
  };
  pushSection('period', '经期与周期');
  pushSection('birthday', '生日');
  pushSection('custom', '今日事项');
  pushSection('digest', '每日热点');
  pushSection('other', '其他');

  const body = sections.length ? sections.join('\n\n') : '• 暂无提醒';
  const isTest = String(title || '').includes('连通性测试');
  const isRichDigest = groups.digest.length > 0
    && groups.digest.every((i) => isRichDigestFormat(i.format));
  const isDigest = String(title || '').includes('热点')
    || String(title || '').includes('编程')
    || String(title || '').includes('学习')
    || String(title || '').includes('GitHub')
    || String(title || '').includes('快讯')
    || isRichDigest
    || (groups.digest.length && !groups.custom.length && !groups.period.length && !groups.birthday.length);
  const headerColor = isTest ? 'grey' : isDigest ? 'orange' : groups.period.length ? 'carmine' : 'turquoise';
  const digestLead = docUrl
    ? `✨ **${dateLabel}** · ${brand}\n精选摘要 · 全文见飞书文档`
    : digestLeadLine(dateLabel, brand, title, groups);
  const footerHint = isTest
    ? ''
    : isDigest
      ? (docUrl
        ? '\n\n——\n点 **阅读全文** 打开飞书文档；有问题可私聊 Nudge'
        : '\n\n——\n有问题可私聊 Nudge 机器人')
      : '\n\n——\n点下方 **已收到** 按钮即可确认（不离开飞书）；也可私聊回「收到」';

  const ackItems = (items || []).filter((i) => i.eventId && (i.ackValue || i.ackUrl));
  const actionRows = [];
  if (!isTest && !isDigest && ackItems.length) {
    // 飞书单行最多约 3 个按钮；用 callback，不跳转网页
    for (let i = 0; i < Math.min(ackItems.length, 6); i += 2) {
      const slice = ackItems.slice(i, i + 2);
      actionRows.push({
        tag: 'action',
        actions: slice.map((it) => {
          const value = it.ackValue || {
            action: 'ack',
            id: String(it.eventId),
            date: String(dateLabel).slice(0, 10),
            url: it.ackUrl || ''
          };
          return {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: `已收到 · ${(it.name || '事项').slice(0, 8)}`
            },
            type: 'primary',
            value,
            behaviors: [{ type: 'callback', value }]
          };
        })
      });
    }
  }
  const btnText = isTest
    ? '知道了'
    : (docUrl ? (openLabel || '阅读全文') : '打开清单');
  actionRows.push({
    tag: 'action',
    actions: [
      {
        tag: 'button',
        text: { tag: 'plain_text', content: btnText },
        type: docUrl ? 'primary' : 'default',
        multi_url: {
          url: openUrl,
          android_url: openUrl,
          ios_url: openUrl,
          pc_url: openUrl
        }
      }
    ]
  });

  return {
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: title || `${brand} · ${dateLabel}` },
        template: headerColor
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: isTest
              ? `⚠️ **这是连通性测试，不是事项提醒**\n仅验证 Webhook 是否可用。`
              : isDigest
                ? digestLead
                : `📅 **${dateLabel}** · ${brand}\n轻推一下，刚好想起`
          }
        },
        { tag: 'hr' },
        { tag: 'div', text: { tag: 'lark_md', content: body + footerHint } },
        { tag: 'hr' },
        ...actionRows
      ]
    }
  };
}

function buildServerchanBody(dateLabel, items) {
  const lines = [`### ${dateLabel} 日常提醒`, ''];
  for (const i of items || []) {
    lines.push(`- ${i.message}`);
  }
  lines.push('', '---', '来自「日常提醒」');
  return lines.join('\n');
}

function normalizeEventInput(body) {
  const raw = { ...body };
  let space = raw.space;
  if (!space) {
    if (raw.type === 'birthday' || raw.type === 'period') space = 'moment';
    else if (raw.category === 'temporary') space = 'task';
    else space = 'habit';
  }
  if (!['habit', 'moment', 'task'].includes(space)) space = 'habit';

  let subtype = raw.subtype || null;
  if (space === 'moment') {
    subtype = ['birthday', 'period', 'anniversary'].includes(raw.subtype)
      ? raw.subtype
      : (raw.type === 'period' ? 'period' : raw.type === 'birthday' ? 'birthday' : 'anniversary');
  } else {
    subtype = null;
  }

  const schedule = { ...(raw.schedule || {}) };
  if (space === 'moment' && subtype === 'birthday') schedule.mode = 'yearly';
  if (space === 'moment' && subtype === 'period') schedule.mode = 'cycle';
  if (space === 'moment' && subtype === 'anniversary') schedule.mode = schedule.mode || 'yearly';
  if (space === 'habit' && !schedule.mode) schedule.mode = 'daily';
  if (space === 'task' && !schedule.mode) schedule.mode = 'daily';
  if (schedule.time) {
    const t = parseHHMM(String(schedule.time));
    schedule.time = t ? `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}` : undefined;
  }

  // Birthday: accept birth_date / birth_solar (阳历) → store lunar month/day + birth_year
  let calendar = raw.calendar === 'lunar' || raw.calendar === 'solar' ? raw.calendar : undefined;
  let birthYear = null;
  let birthSolar = null;
  if (raw.birth_year != null && raw.birth_year !== '') {
    const by = parseInt(raw.birth_year, 10);
    if (Number.isFinite(by) && by >= 1900 && by <= 2100) birthYear = by;
  }
  const birthDateRaw = raw.birth_date || raw.birth_solar;
  if (space === 'moment' && subtype === 'birthday' && birthDateRaw) {
    const m = String(birthDateRaw).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = +m[1];
      const mo = +m[2];
      const d = +m[3];
      const lun = solarToLunar(new Date(y, mo - 1, d, 12));
      if (lun) {
        calendar = 'lunar';
        birthYear = y;
        birthSolar = m[0];
        schedule.month = lun.month;
        schedule.day = lun.day;
        schedule.mode = 'yearly';
      }
    }
  } else if (raw.birth_solar && /^\d{4}-\d{2}-\d{2}$/.test(String(raw.birth_solar))) {
    birthSolar = String(raw.birth_solar);
  }

  const draft = {
    space,
    subtype,
    name: raw.name,
    category: space === 'task' ? 'temporary' : 'long_term',
    enabled: raw.enabled !== false,
    remind_ahead: raw.remind_ahead != null ? parseInt(raw.remind_ahead, 10) || 0 : 0,
    schedule,
    messages: raw.messages || {},
    acks: raw.acks && typeof raw.acks === 'object' ? raw.acks : {},
    type: 'custom'
  };
  if (calendar === 'lunar' || calendar === 'solar') draft.calendar = calendar;
  if (birthYear != null) draft.birth_year = birthYear;
  if (birthSolar) draft.birth_solar = birthSolar;
  return syncTypeFromSpace(draft);
}

module.exports = {
  TYPE_META,
  SPACE_META,
  LEGACY_TYPE_MAP,
  migrateEvent,
  migrateEvents,
  parseHHMM,
  eventPushTime,
  matchesPushWindow,
  predictPeriod,
  logPeriodStart,
  checkEvent,
  buildRecommendations,
  collectDueItems,
  buildFeishuCard,
  buildServerchanBody,
  normalizeEventInput,
  plannedTimeLabel,
  isAcked,
  isArchived,
  ackEvent,
  unackEvent,
  createAckSig,
  verifyAckSig,
  buildAckUrl,
  buildAckValue,
  buildAckedCard
};
