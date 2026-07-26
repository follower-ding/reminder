const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

/** 本地开发：读取项目根目录 .env（不覆盖已有 process.env） */
(function loadLocalEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const text = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const i = trimmed.indexOf('=');
      if (i <= 0) continue;
      const key = trimmed.slice(0, i).trim();
      let val = trimmed.slice(i + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* ignore */
  }
})();

const store = require('./store');
const engine = require('./engine');
const digest = require('./digest');
const ledger = require('./ledger');
const feishuBot = require('./feishu-bot');

const PORT = process.env.PORT || 3333;
const APP_URL = process.env.APP_URL || 'https://reminder-three-gamma.vercel.app';
const BRAND = { name: 'Nudge', tagline: '轻推一下，刚好想起' };

const {
  loadData,
  saveData,
  loadConfig,
  saveConfig,
  persistenceInfo,
  readPushTestData,
  readSeedData
} = store;

const {
  TYPE_META,
  migrateEvents,
  migrateEvent,
  checkEvent,
  buildRecommendations,
  collectDueItems,
  buildFeishuCard,
  buildServerchanBody,
  normalizeEventInput,
  logPeriodStart,
  predictPeriod,
  parseHHMM,
  plannedTimeLabel,
  isAcked,
  isArchived,
  ackEvent,
  unackEvent,
  buildAckUrl,
  verifyAckSig
} = engine;

let cachedTimezone = 'Asia/Shanghai';

function now(date) {
  const d = date ? new Date(date) : new Date();
  const tz = cachedTimezone || 'Asia/Shanghai';
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const p = fmt.formatToParts(d);
  const g = (t) => parseInt(p.find(x => x.type === t)?.value || '0', 10);
  return { year: g('year'), month: g('month'), day: g('day'), hour: g('hour'), minute: g('minute') };
}
function dateStr(date) {
  const d = now(date);
  return `${d.year}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`;
}
function daysBetween(a, b) {
  return Math.floor((new Date(a.year, a.month-1, a.day) - new Date(b.year, b.month-1, b.day)) / 86400000);
}
function nextId(arr) {
  return arr.length ? Math.max(...arr.map(x => x.id)) + 1 : 1;
}
// 无状态签名 Token（Vercel 多实例/冷启动不丢登录态）
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'reminder-hmac-v1-change-me';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}
function createToken(user) {
  const payload = b64url(JSON.stringify({
    u: user.username,
    l: user.label || user.username,
    exp: Date.now() + TOKEN_TTL_MS
  }));
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now() || !data.u) return null;
    return { username: data.u, label: data.l || data.u };
  } catch {
    return null;
  }
}

// ─── 推送 ────────────────────────────────────────────
function resolveFeishuChatId(config) {
  return String(
    config?.feishu?.chat_id || process.env.FEISHU_CHAT_ID || ''
  ).trim();
}

/** 合并飞书配置：空 chat_id 不覆盖已绑定值（防止设置页/测试冲掉） */
function mergeFeishuConfig(savedFeishu, patch = {}) {
  const next = { ...(savedFeishu || {}) };
  if (patch.enabled != null) next.enabled = !!patch.enabled;
  if (patch.webhook_url != null) next.webhook_url = String(patch.webhook_url).trim();
  if (patch.chat_id != null && String(patch.chat_id).trim()) {
    next.chat_id = String(patch.chat_id).trim();
  }
  return next;
}

function feishuPushReady(config) {
  if (!config?.feishu?.enabled) return false;
  if (String(config.feishu?.webhook_url || '').trim()) return true;
  return feishuBot.botConfigured() && !!resolveFeishuChatId(config);
}

async function sendFeishuCard(config, cardBody) {
  if (!config.feishu?.enabled) return { ok: false, error: '飞书未启用' };
  const webhook = String(config.feishu?.webhook_url || '').trim();
  const chatId = resolveFeishuChatId(config);

  // 优先应用机器人（无 Webhook）；有 webhook 时仍可用
  if (!webhook && feishuBot.botConfigured() && chatId) {
    return feishuBot.sendInteractiveCard(chatId, cardBody);
  }
  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cardBody),
      });
      const text = await res.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      if (parsed && parsed.code && parsed.code !== 0) {
        return { ok: false, error: parsed.msg || `飞书错误 code=${parsed.code}`, data: text };
      }
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, data: text };
      return { ok: true, data: text };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  if (feishuBot.botConfigured() && !chatId) {
    return {
      ok: false,
      error: '应用机器人已配置，但还没有 chat_id：请在目标群 @Nudge 发一句「绑定」，或在设置里填写 chat_id'
    };
  }
  return { ok: false, error: '飞书未配置：请用应用机器人（chat_id）或群 Webhook' };
}

async function sendServerchan(config, title, content) {
  if (!config.serverchan?.enabled || !config.serverchan?.sendkey) return { ok: false, error: 'Server酱未配置' };
  try {
    const res = await fetch(`https://sctapi.ftqq.com/${config.serverchan.sendkey}.send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, desp: content }),
    });
    const json = await res.json();
    return { ok: json.code === 0, data: json };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function attachAckUrls(items, day) {
  const d = day || dateStr();
  return (items || []).map((i) => {
    if (!i.eventId) return i;
    return {
      ...i,
      ackUrl: buildAckUrl(APP_URL, i.eventId, d, 'feishu', TOKEN_SECRET)
    };
  });
}

async function pushReminderBundle(config, items, title) {
  const out = { feishu: null, serverchan: null };
  if (!items.length) return out;
  const brand = config.brand?.name || BRAND.name;
  const enriched = attachAckUrls(items);
  if (feishuPushReady(config)) {
    out.feishu = await sendFeishuCard(config, buildFeishuCard(dateStr(), enriched, title, APP_URL, brand));
  } else {
    out.feishu = {
      ok: false,
      error: feishuBot.botConfigured()
        ? '飞书未就绪：启用开关打开后，在群里 @Nudge 绑定 chat_id（无需 Webhook）'
        : '飞书未配置'
    };
  }
  if (config.serverchan?.enabled && config.serverchan?.sendkey) {
    out.serverchan = await sendServerchan(config, title || `${brand} · ${dateStr()}`, buildServerchanBody(dateStr(), enriched));
  } else {
    out.serverchan = { ok: false, error: 'Server酱未配置' };
  }
  return out;
}

function publicConfig(config) {
  return {
    feishu: {
      ...(config.feishu || {}),
      bot_configured: feishuBot.botConfigured()
    },
    serverchan: config.serverchan,
    check_times: config.check_times,
    default_push_time: config.default_push_time,
    timezone: config.timezone,
    digests: config.digests,
    brand: { ...BRAND, ...(config.brand || {}) },
    deepseek: {
      configured: !!process.env.DEEPSEEK_API_KEY,
      enabled: config.deepseek?.enabled !== false,
      model: config.deepseek?.model || 'deepseek-chat'
    }
  };
}

// ─── Express 应用 ────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 认证中间件（HMAC 签名 Token，跨进程/冷启动有效）
function authMiddleware(req, res, next) {
  const bypassExact = new Set(['/api/login', '/api/health', '/api/check', '/api/cron/check', '/api/feishu/event']);
  if (bypassExact.has(req.path)) return next();
  // Vercel / 代理下 path 可能变形
  if (String(req.path || '').includes('feishu/event')) return next();
  if (req.path.startsWith('/api/ack/')) return next();
  if (!req.path.startsWith('/api/')) return next();
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const user = verifyToken(token);
  if (user) { req.user = user; return next(); }
  return res.status(401).json({ error: '未认证' });
}
app.use(authMiddleware);

// ─── 认证 ────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const config = await loadConfig();
    cachedTimezone = config.timezone || cachedTimezone;
    const user = config.users?.[username];
    if (!user || user.password !== password) return res.status(401).json({ error: '用户名或密码错误' });
    const token = createToken({ username, label: user.label });
    res.json({ token, user: { username, label: user.label } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 事件管理 ────────────────────────────────────────
app.get('/api/events', async (req, res) => {
  try {
    const data = await loadData();
    res.json(migrateEvents(data.events));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/events', async (req, res) => {
  try {
    const data = await loadData();
    const normalized = normalizeEventInput(req.body || {});
    if (!normalized.name) return res.status(400).json({ error: 'name 必填' });
    const ev = { id: nextId(data.events), ...normalized };
    data.events.push(ev);
    data.history.push({ id: nextId(data.history), eventId: ev.id, action: 'create', detail: `${ev.type}:${ev.name}`, date: dateStr(), ts: Date.now() });
    await saveData(data);
    res.json(ev);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/events/:id', async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.events.findIndex(e => e.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: '未找到' });
    const merged = { ...data.events[idx], ...req.body, id: data.events[idx].id };
    const normalized = normalizeEventInput(merged);
    const archived = merged.archived === true || merged.archived === 1;
    data.events[idx] = {
      ...merged,
      ...normalized,
      id: data.events[idx].id,
      enabled: archived ? false : merged.enabled !== false,
      archived,
      archived_at: archived ? (merged.archived_at || new Date().toISOString()) : null,
      acks: merged.acks && typeof merged.acks === 'object' ? merged.acks : {}
    };
    data.history.push({ id: nextId(data.history), eventId: data.events[idx].id, action: 'update', detail: `${data.events[idx].type}:${data.events[idx].name}`, date: dateStr(), ts: Date.now() });
    await saveData(data);
    res.json(data.events[idx]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/events/:id/period-log', async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.events.findIndex(e => e.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: '未找到' });
    const start = (req.body && req.body.start) || dateStr();
    data.events[idx] = logPeriodStart(migrateEvent(data.events[idx]), start);
    data.history.push({ id: nextId(data.history), eventId: data.events[idx].id, action: 'period-log', detail: `start:${start}`, date: dateStr(), ts: Date.now() });
    await saveData(data);
    res.json(data.events[idx]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/events/:id', async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.events.findIndex(e => e.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: '未找到' });
    const ev = data.events.splice(idx, 1)[0];
    data.history.push({ id: nextId(data.history), eventId: ev.id, action: 'delete', detail: `${ev.type}:${ev.name}`, date: dateStr(), ts: Date.now() });
    await saveData(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 检查与统计 ──────────────────────────────────────
app.get('/api/check', async (req, res) => {
  try {
    const data = await loadData();
    const n = now();
    const results = data.events.map(ev => checkEvent(ev, n)).filter(Boolean);
    res.json({ date: dateStr(), results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const data = await loadData();
    const n = now();
    const todayStr = dateStr();
    const events = migrateEvents(data.events);
    const pending = [];
    const done = [];
    const upcoming = [];
    for (const ev of events) {
      const ackedToday = isAcked(ev, todayStr);
      // 启用中，或今日刚确认后归档的待办（仍出现在「已确认」）
      if (!ev.enabled && !(isArchived(ev) && ackedToday)) continue;
      if (isArchived(ev) && !ackedToday) continue;
      const r = checkEvent({ ...ev, enabled: true }, n);
      if (!r || !r.active) continue;
      const row = {
        ...r,
        eventId: ev.id,
        space: ev.space,
        time: ev.schedule?.time || null,
        name: ev.name,
        archived: isArchived(ev)
      };
      if (r.days === 0 || r.cycleDay !== undefined) {
        if (ackedToday) done.push({ ...row, acked: true, ack: ev.acks[todayStr] });
        else if (!isArchived(ev) && ev.enabled) pending.push({ ...row, acked: false });
      } else if ((r.days || 0) > 0 && (r.days || 99) <= 7 && ev.enabled && !isArchived(ev)) {
        upcoming.push(row);
      }
    }
    upcoming.sort((a, b) => (a.days || 99) - (b.days || 99));
    res.json({
      date: todayStr,
      pending,
      done,
      today: pending,
      upcoming,
      brand: BRAND
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 鉴权 API：供详情「误操作恢复」等；网页今日不做「确认收到」主按钮 */
app.post('/api/events/:id/ack', async (req, res) => {
  try {
    const data = await loadData();
    const id = parseInt(req.params.id, 10);
    const idx = data.events.findIndex((e) => e.id === id);
    if (idx === -1) return res.status(404).json({ error: '未找到' });
    const day = (req.body && req.body.date) || dateStr();
    const via = (req.body && req.body.via) || 'app';
    data.events[idx] = ackEvent(data.events[idx], day, via);
    await saveData(data);
    res.json({ ok: true, item: migrateEvent(data.events[idx]), date: day });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/events/:id/unack', async (req, res) => {
  try {
    const data = await loadData();
    const id = parseInt(req.params.id, 10);
    const idx = data.events.findIndex((e) => e.id === id);
    if (idx === -1) return res.status(404).json({ error: '未找到' });
    const day = (req.body && req.body.date) || dateStr();
    data.events[idx] = unackEvent(data.events[idx], day);
    await saveData(data);
    res.json({ ok: true, item: migrateEvent(data.events[idx]), date: day });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function ackResultPage({ ok, title, detail }) {
  const color = ok ? '#0F766E' : '#B45309';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f7f6;color:#134e4a}
.card{background:#fff;border-radius:16px;padding:28px 24px;max-width:360px;box-shadow:0 8px 30px rgba(15,118,110,.12);text-align:center}
h1{font-size:1.35rem;margin:0 0 8px;color:${color}}
p{margin:0 0 18px;line-height:1.5;color:#334155}
a{display:inline-block;background:#0F766E;color:#fff;text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:600}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${detail}</p>
<a href="${APP_URL}/">打开 Nudge</a></div></body></html>`;
}

async function handleAckDeepLink(req, res, { id, day, sig, via }) {
  try {
    const eventId = parseInt(id, 10);
    const date = String(day || dateStr()).slice(0, 10);
    if (!Number.isFinite(eventId) || !verifyAckSig(eventId, date, sig, TOKEN_SECRET)) {
      return res.status(400).type('html').send(ackResultPage({
        ok: false,
        title: '确认失败',
        detail: '链接无效或已过期。请在飞书回复「收到」，或打开 Nudge 查看今日事项。'
      }));
    }
    const data = await loadData();
    const idx = data.events.findIndex((e) => e.id === eventId);
    if (idx === -1) {
      return res.status(404).type('html').send(ackResultPage({
        ok: false,
        title: '未找到事项',
        detail: '该事项可能已删除。打开 Nudge 查看最新清单。'
      }));
    }
    data.events[idx] = ackEvent(data.events[idx], date, via || 'feishu');
    await saveData(data);
    const archived = isArchived(data.events[idx]);
    return res.type('html').send(ackResultPage({
      ok: true,
      title: archived ? '已确认并归档' : '已确认收到',
      detail: archived
        ? '待办已归档。可在 Nudge 清单「已归档」中恢复。'
        : '今日事项已标记完成。'
    }));
  } catch (e) {
    return res.status(500).type('html').send(ackResultPage({
      ok: false,
      title: '确认出错',
      detail: e.message || '请稍后重试，或在飞书回复「收到」。'
    }));
  }
}

/** 飞书卡片深链确认（路径型，无 &）：/api/ack/:id/:date/:sig/:via? */
app.get('/api/ack/:id/:date/:sig/:via?', async (req, res) => {
  await handleAckDeepLink(req, res, {
    id: req.params.id,
    day: req.params.date,
    sig: decodeURIComponent(req.params.sig || ''),
    via: req.params.via ? decodeURIComponent(req.params.via) : 'feishu'
  });
});

/** 兼容旧 query 深链：/api/ack/:id?date=&sig=&via= */
app.get('/api/ack/:id', async (req, res) => {
  await handleAckDeepLink(req, res, {
    id: req.params.id,
    day: req.query.date,
    sig: req.query.sig,
    via: req.query.via || 'feishu'
  });
});

app.get('/api/stats', async (req, res) => {
  try {
    const data = await loadData();
    const events = migrateEvents(data.events);
    const total = events.length;
    const enabled = events.filter(e => e.enabled).length;
    const byType = {};
    for (const ev of events) {
      byType[ev.type] = (byType[ev.type] || 0) + 1;
    }
    const n = now();
    const upcoming30 = events.map(ev => checkEvent(ev, n)).filter(r => r && r.days !== undefined && r.days >= 0 && r.days <= 30).length;
    const todayCount = events.map(ev => checkEvent(ev, n)).filter(r => r && r.days === 0).length;
    res.json({ total, enabled, disabled: total - enabled, byType, upcoming30, todayCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/recommend', async (req, res) => {
  try {
    const data = await loadData();
    const config = await loadConfig();
    const n = now();
    const tips = buildRecommendations(data.events, n);
    const dig = await digest.getDigestBundle(config, dateStr());
    res.json({ tips, digests: dig });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/digests', async (req, res) => {
  try {
    const config = await loadConfig();
    const dig = await digest.getDigestBundle(config, dateStr());
    res.json(dig);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/meta/types', (req, res) => {
  res.json(TYPE_META);
});

app.get('/api/history', async (req, res) => {
  try {
    const data = await loadData();
    res.json(data.history.slice(-100).reverse());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/history', async (req, res) => {
  try {
    const data = await loadData();
    const { eventId, action, detail } = req.body || {};
    if (!action || !detail) return res.status(400).json({ error: 'action 和 detail 必填' });
    data.history.push({ id: nextId(data.history), eventId: eventId || 0, action, detail, date: dateStr(), ts: Date.now() });
    await saveData(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 配置 ────────────────────────────────────────────
app.get('/api/config', async (req, res) => {
  try {
    const config = await loadConfig();
    cachedTimezone = config.timezone || cachedTimezone;
    res.json(publicConfig(config));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/config', async (req, res) => {
  try {
    const config = await loadConfig();
    const body = { ...(req.body || {}) };
    delete body.users;
    delete body.deepseek;
    const updated = {
      ...config,
      ...body,
      users: config.users,
      feishu: mergeFeishuConfig(config.feishu, body.feishu || {}),
      serverchan: { ...config.serverchan, ...(body.serverchan || {}) },
      digests: { ...config.digests, ...(body.digests || {}) },
      brand: { ...BRAND, ...(config.brand || {}), ...(body.brand || {}) }
    };
    const saved = await saveConfig(updated);
    cachedTimezone = saved.timezone || cachedTimezone;
    res.json(publicConfig(saved));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 健康检查 ──────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const data = await loadData();
    const persist = persistenceInfo();
    res.json({
      status: 'ok',
      time: dateStr(),
      version: '4.1.14',
      brand: BRAND.name,
      app_url: APP_URL,
      deepseek: { configured: !!process.env.DEEPSEEK_API_KEY },
      feishu_bot: { configured: feishuBot.botConfigured() },
      events: data.events.length,
      vercel: !!process.env.VERCEL,
      persistence: persist
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function listPendingToday() {
  const data = await loadData();
  const n = now();
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
  const n = now();
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

/** 飞书事件订阅（本地 / 回退路径；生产优先走 api/feishu-event.js） */
app.post('/api/feishu/event', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.type === 'url_verification' || (body.challenge && !body.header && !body.event)) {
      return res.status(200).json({ challenge: body.challenge });
    }
    const { handleFeishuHttp } = require('./feishu-event-http');
    const result = await handleFeishuHttp(body);
    res.status(result.http || 200).json(result.json || { ok: true });
  } catch (e) {
    console.error('[feishu/event]', e.message);
    res.status(200).json({ ok: false, error: e.message });
  }
});

// ─── 演示 / 推送联调数据 ─────────────────────────────
app.post('/api/demo/load-push-test', async (req, res) => {
  try {
    const n = now();
    const demo = readPushTestData(n);
    const prev = await loadData();
    const saved = await saveData({
      events: demo.events,
      history: [
        ...(prev.history || []),
        { id: nextId(prev.history || []), eventId: 0, action: 'demo', detail: 'load-push-test', date: dateStr(), ts: Date.now() }
      ]
    });
    const today = saved.events.map(ev => checkEvent(ev, n)).filter(r => r && r.active && r.days === 0);
    res.json({ ok: true, events: saved.events.length, todayCount: today.length, today });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/demo/load-seed', async (req, res) => {
  try {
    const seed = readSeedData();
    const prev = await loadData();
    const saved = await saveData({
      events: seed.events,
      history: [
        ...(prev.history || []),
        { id: nextId(prev.history || []), eventId: 0, action: 'demo', detail: 'load-seed', date: dateStr(), ts: Date.now() }
      ]
    });
    res.json({ ok: true, events: saved.events.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/demo/clear', async (req, res) => {
  try {
    const prev = await loadData();
    await saveData({
      events: [],
      history: [
        ...(prev.history || []),
        { id: nextId(prev.history || []), eventId: 0, action: 'demo', detail: 'clear-all', date: dateStr(), ts: Date.now() }
      ]
    });
    res.json({ ok: true, events: 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 手动推送：事项卡与热点卡分开发（绝不合并） */
app.post('/api/push/run', async (req, res) => {
  try {
    const data = await loadData();
    const saved = await loadConfig();
    const body = req.body || {};
    const config = {
      ...saved,
      feishu: mergeFeishuConfig(saved.feishu, {
        enabled: body.feishu_enabled != null ? !!body.feishu_enabled : saved.feishu?.enabled,
        webhook_url: body.webhook_url,
        chat_id: body.chat_id
      }),
      serverchan: {
        ...(saved.serverchan || {}),
        enabled: body.serverchan_enabled != null ? !!body.serverchan_enabled : !!saved.serverchan?.enabled,
        sendkey: body.sendkey != null ? String(body.sendkey).trim() : (saved.serverchan?.sendkey || '')
      }
    };
    const n = now();
    const due = collectDueItems(data.events, n, {
      defaultTime: saved.default_push_time || '09:00',
      ignoreTime: true,
      skipAcked: true,
      dateYmd: dateStr()
    });
    const channel = body.channel; // items | digest | both(default)
    const wantItems = channel !== 'digest';
    const wantDigest = channel !== 'items' && body.include_digest !== false && saved.digests?.enabled !== false;

    let digestItems = [];
    if (wantDigest) {
      const dig = await digest.getDigestBundle(saved, dateStr());
      digestItems = dig.pushItems || [];
    }

    const out = {
      date: dateStr(),
      today: due.today.length,
      upcoming: due.upcoming.length,
      digests: digestItems.length,
      items_push: null,
      digest_push: null,
      feishu: null,
      serverchan: null
    };
    if ((!wantItems || !due.all.length) && !digestItems.length) {
      out.message = '当前没有可推送的提醒';
      return res.json(out);
    }

    let led = data.push_ledger || [];
    if (wantItems && due.all.length) {
      const title = body.title || `${BRAND.name} · 今日事项`;
      const pushed = await pushReminderBundle(config, due.all, title);
      out.items_push = pushed;
      out.feishu = pushed.feishu;
      out.serverchan = pushed.serverchan;
      for (const item of due.all) {
        const t = item.planned_time || 'manual';
        for (const ch of ['feishu', 'serverchan']) {
          const result = pushed[ch];
          if (!result) continue;
          const key = ledger.makeDedupeKey(item.eventId, dateStr(), `manual-${t}`, ch);
          led = ledger.appendLedger(led, {
            item_id: item.eventId,
            channel: ch,
            planned_at: `${dateStr()}T${t}:00`,
            status: result.ok ? 'success' : 'failed',
            dedupe_key: key,
            card_preview: item.message,
            error: result.ok ? null : (result.error || 'failed')
          });
        }
      }
    }
    if (digestItems.length) {
      const digTitle = `${BRAND.name} · 每日热点`;
      const digPushed = await pushReminderBundle(config, digestItems, digTitle);
      out.digest_push = digPushed;
      if (!out.feishu) out.feishu = digPushed.feishu;
      if (!out.serverchan) out.serverchan = digPushed.serverchan;
      const digTime = saved.digests?.push_time || '20:00';
      led = ledger.appendLedger(led, {
        item_id: 0,
        channel: 'feishu',
        planned_at: `${dateStr()}T${digTime}:00`,
        status: digPushed.feishu?.ok ? 'success' : 'failed',
        dedupe_key: ledger.makeDedupeKey(0, dateStr(), `manual-digest-${digTime}`, 'digest'),
        card_preview: 'digest',
        error: digPushed.feishu?.ok ? null : (digPushed.feishu?.error || null)
      });
    }
    await saveData({ ...data, push_ledger: led });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 调度推送：事项通道 A + 热点通道 B（绝不合并）──
async function runScheduledPush() {
  const data = await loadData();
  const config = await loadConfig();
  cachedTimezone = config.timezone || cachedTimezone;
  const n = now();
  const defaultTime = config.default_push_time || '09:00';
  const due = collectDueItems(data.events, n, {
    defaultTime,
    ignoreTime: false,
    catchUp: true,
    skipAcked: true,
    dateYmd: dateStr()
  });
  let led = data.push_ledger || [];
  const toPush = [];
  for (const item of due.all) {
    const t = item.planned_time || plannedTimeLabel({ schedule: { time: defaultTime } }, defaultTime);
    const keyFs = ledger.makeDedupeKey(item.eventId, dateStr(), t, 'feishu');
    const keySc = ledger.makeDedupeKey(item.eventId, dateStr(), t, 'serverchan');
    const needFs = config.feishu?.enabled && !ledger.hasSuccessfulPush(led, keyFs);
    const needSc = config.serverchan?.enabled && !ledger.hasSuccessfulPush(led, keySc);
    if (needFs || needSc) toPush.push({ ...item, _t: t, needFs, needSc, keyFs, keySc });
  }

  let digestItems = [];
  const digTime = parseHHMM(config.digests?.push_time || '20:00') || { hour: 20, minute: 0 };
  const digLabel = `${String(digTime.hour).padStart(2, '0')}:${String(digTime.minute).padStart(2, '0')}`;
  const digNow = n.hour * 60 + n.minute;
  const digPlanned = digTime.hour * 60 + digTime.minute;
  const digKey = ledger.makeDedupeKey(0, dateStr(), digLabel, 'digest');
  if (config.digests?.enabled !== false && digNow >= digPlanned && !ledger.hasSuccessfulPush(led, digKey)) {
    const dig = await digest.getDigestBundle(config, dateStr());
    digestItems = dig.pushItems || [];
  }

  const results = {
    date: dateStr(),
    hour: n.hour,
    minute: n.minute,
    candidates: due.all.length,
    toPush: toPush.length,
    digests: digestItems.length,
    pushed: false,
    items_pushed: false,
    digest_pushed: false,
    feishu_enabled: !!config.feishu?.enabled,
    serverchan_enabled: !!config.serverchan?.enabled
  };
  if (toPush.length === 0 && digestItems.length === 0) {
    return { ...results, message: 'no due reminders (or already sent / channels off)' };
  }

  if (toPush.length) {
    const title = `${BRAND.name} · 今日事项`;
    const pushed = await pushReminderBundle(config, toPush, title);
    results.feishu = pushed.feishu;
    results.serverchan = pushed.serverchan;
    results.items_pushed = !!(pushed.feishu?.ok || pushed.serverchan?.ok);
    results.pushed = results.pushed || results.items_pushed;
    for (const item of toPush) {
      if (item.needFs) {
        led = ledger.appendLedger(led, {
          item_id: item.eventId,
          channel: 'feishu',
          planned_at: `${dateStr()}T${item._t}:00`,
          status: pushed.feishu?.ok ? 'success' : 'failed',
          dedupe_key: item.keyFs,
          card_preview: item.message,
          error: pushed.feishu?.ok ? null : (pushed.feishu?.error || null)
        });
      }
      if (item.needSc) {
        led = ledger.appendLedger(led, {
          item_id: item.eventId,
          channel: 'serverchan',
          planned_at: `${dateStr()}T${item._t}:00`,
          status: pushed.serverchan?.ok ? 'success' : 'failed',
          dedupe_key: item.keySc,
          card_preview: item.message,
          error: pushed.serverchan?.ok ? null : (pushed.serverchan?.error || null)
        });
      }
    }
  }

  if (digestItems.length) {
    const digTitle = `${BRAND.name} · 每日热点`;
    const digPushed = await pushReminderBundle(config, digestItems, digTitle);
    results.digest_feishu = digPushed.feishu;
    results.digest_pushed = !!digPushed.feishu?.ok;
    results.pushed = results.pushed || results.digest_pushed;
    led = ledger.appendLedger(led, {
      item_id: 0,
      channel: 'feishu',
      planned_at: `${dateStr()}T${digLabel}:00`,
      status: digPushed.feishu?.ok ? 'success' : 'failed',
      dedupe_key: digKey,
      card_preview: 'digest',
      error: digPushed.feishu?.ok ? null : (digPushed.feishu?.error || null)
    });
  }

  await saveData({ ...data, push_ledger: led });
  return results;
}

app.get('/api/cron/check', async (req, res) => {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const got = req.headers['x-cron-secret'] || req.query.secret;
      if (got !== secret) return res.status(401).json({ error: 'unauthorized cron' });
    }
    res.json(await runScheduledPush());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/events/batch-delete', async (req, res) => {
  try {
    const ids = (req.body && req.body.ids) || [];
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids 必填' });
    const set = new Set(ids.map((x) => parseInt(x, 10)).filter(Number.isFinite));
    const data = await loadData();
    const before = data.events.length;
    const removed = data.events.filter((e) => set.has(e.id));
    data.events = data.events.filter((e) => !set.has(e.id));
    for (const ev of removed) {
      data.history.push({ id: nextId(data.history), eventId: ev.id, action: 'delete', detail: `batch:${ev.type}:${ev.name}`, date: dateStr(), ts: Date.now() });
    }
    await saveData(data);
    res.json({ ok: true, deleted: before - data.events.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/events/batch-category', async (req, res) => {
  try {
    const ids = (req.body && req.body.ids) || [];
    const category = req.body?.category === 'temporary' ? 'temporary' : 'long_term';
    const space = category === 'temporary' ? 'task' : 'habit';
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids 必填' });
    const set = new Set(ids.map((x) => parseInt(x, 10)).filter(Number.isFinite));
    const data = await loadData();
    let n = 0;
    data.events = data.events.map((e) => {
      if (!set.has(e.id)) return e;
      n += 1;
      const next = migrateEvent({ ...e, category, space: e.space === 'moment' ? 'moment' : space });
      return next;
    });
    await saveData(data);
    res.json({ ok: true, updated: n, category });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/ledger', async (req, res) => {
  try {
    const data = await loadData();
    const itemId = req.query.item_id != null ? parseInt(req.query.item_id, 10) : null;
    if (Number.isFinite(itemId)) return res.json(ledger.listByItem(data.push_ledger, itemId));
    res.json(ledger.listToday(data.push_ledger, dateStr()));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function periodHistoryRows(sched) {
  const starts = (Array.isArray(sched?.cycle_history) ? sched.cycle_history : [])
    .map(String)
    .filter(Boolean)
    .sort();
  const rows = [];
  for (let i = 0; i < starts.length; i++) {
    let gap_days = null;
    if (i > 0) {
      const a = new Date(`${starts[i - 1]}T00:00:00`);
      const b = new Date(`${starts[i]}T00:00:00`);
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
        gap_days = Math.round((b - a) / 86400000);
      }
    }
    rows.push({ start: starts[i], gap_days });
  }
  return rows.slice(-6).reverse();
}

app.get('/api/events/:id/detail', async (req, res) => {
  try {
    const data = await loadData();
    const id = parseInt(req.params.id, 10);
    const ev = migrateEvents(data.events).find((e) => e.id === id);
    if (!ev) return res.status(404).json({ error: '未找到' });
    const n = now();
    const check = checkEvent(ev, n);
    const history = ledger.listByItem(data.push_ledger, id);
    let period = null;
    if (ev.type === 'period') {
      period = {
        forecast: predictPeriod(ev.schedule || {}, n),
        history: periodHistoryRows(ev.schedule || {})
      };
    }
    res.json({ item: ev, check, push_history: history, period, brand: BRAND });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
 
// ─── 推送测试 ──────────────────────────────────────────
app.post('/api/feishu/test', async (req, res) => {
  try {
    const saved = await loadConfig();
    const body = req.body || {};
    const config = {
      ...saved,
      feishu: mergeFeishuConfig(saved.feishu, {
        enabled: body.enabled != null ? !!body.enabled : saved.feishu?.enabled,
        webhook_url: body.webhook_url,
        chat_id: body.chat_id
      })
    };
    if (body.persist) {
      saved.feishu = config.feishu;
      await saveConfig(saved);
    }
    const card = buildFeishuCard(
      dateStr(),
      [{ message: '推送通道可用。此消息不是任何事项提醒。', type: 'custom' }],
      '【连通性测试】非事项提醒',
      APP_URL,
      BRAND.name
    );
    const result = await sendFeishuCard(config, card);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/serverchan/test', async (req, res) => {
  try {
    const saved = await loadConfig();
    const body = req.body || {};
    const config = {
      ...saved,
      serverchan: {
        ...(saved.serverchan || {}),
        enabled: body.enabled != null ? !!body.enabled : !!saved.serverchan?.enabled,
        sendkey: body.sendkey != null ? String(body.sendkey).trim() : (saved.serverchan?.sendkey || '')
      }
    };
    if (body.persist) {
      saved.serverchan = config.serverchan;
      await saveConfig(saved);
    }
    const result = await sendServerchan(config, '🔔 提醒系统测试', '这是一条来自日常提醒系统的测试消息\n\n如果收到这条消息，说明配置正确 ✅');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/feishu/send-card', async (req, res) => {
  try {
    const config = await loadConfig();
    const { title, items } = req.body || {};
    const card = buildFeishuCard(dateStr(), items || [], title, APP_URL);
    const result = await sendFeishuCard(config, card);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── SPA 兜底 ─────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: '未知 API' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── 启动（直接 node server.js 时；Vercel / 测试 require 时不自动 listen）──
if (require.main === module && !process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', async () => {
    try {
      const cfg = await loadConfig();
      const data = await loadData();
      cachedTimezone = cfg.timezone || cachedTimezone;
      const persist = persistenceInfo();
      console.log(`✨ Nudge v4.0 已启动`);
      console.log(`   📍 http://0.0.0.0:${PORT}`);
      console.log(`   ⏰ 时区: ${cachedTimezone}`);
      console.log(`   📊 事件数: ${data.events.length}`);
      console.log(`   💾 存储: ${persist.backend}${persist.durable ? '' : ' (非持久)'}`);
      console.log(`   ⏱️  本地调度: 每 60s 扫描到期事项（飞书需在设置中启用）`);
    } catch (e) {
      console.log(`✨ Nudge v4.0 已启动`);
      console.log(`   📍 http://0.0.0.0:${PORT}`);
      console.log(`   ⚠️  存储初始化: ${e.message}`);
    }
    // 本地开发：没有 Vercel Cron，必须自跑调度
    setInterval(() => {
      runScheduledPush().then((r) => {
        if (r.pushed) console.log(`[scheduler] pushed toPush=${r.toPush} digests=${r.digests}`);
      }).catch((e) => console.error('[scheduler]', e.message));
    }, 60 * 1000);
    setTimeout(() => {
      runScheduledPush().catch(() => {});
    }, 3000);
  });
}

module.exports = app;
