const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── 路径 ────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp' : __dirname);
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const PORT = process.env.PORT || 3333;

const DEFAULT_CONFIG = {
  feishu: { enabled: false, webhook_url: '' },
  serverchan: { enabled: false, sendkey: '' },
  check_times: ['09:00', '14:00', '21:00'],
  timezone: 'Asia/Shanghai',
  users: { admin: { password: 'admin123', label: '管理员' } }
};

// ─── 工具 ────────────────────────────────────────────
function readJSON(file) {
  // On Vercel, if file doesn't exist in DATA_DIR, copy from deployment source
  if (process.env.VERCEL && !fs.existsSync(file)) {
    const srcFile = path.join(__dirname, path.basename(file));
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, file);
    } else if (path.basename(file) === 'config.json') {
      fs.writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
    } else if (path.basename(file) === 'data.json') {
      const seedFile = path.join(__dirname, 'seed.data.json');
      if (fs.existsSync(seedFile)) {
        fs.copyFileSync(seedFile, file);
      } else {
        fs.writeFileSync(file, JSON.stringify({ events: [], history: [] }, null, 2), 'utf8');
      }
    }
  }
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Normalize legacy seed (raw array) into { events, history }. */
function normalizeData(raw) {
  if (Array.isArray(raw)) return { events: raw, history: [] };
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    events: Array.isArray(data.events) ? data.events : [],
    history: Array.isArray(data.history) ? data.history : []
  };
}

function loadData() {
  return normalizeData(readJSON(DATA_FILE));
}

function saveData(data) {
  const normalized = normalizeData(data);
  writeJSON(DATA_FILE, normalized);
  return normalized;
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function now(date) {
  const d = date ? new Date(date) : new Date();
  const tz = (readJSON(CONFIG_FILE).timezone || 'Asia/Shanghai');
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

// ─── 检查引擎 ───────────────────────────────────────
const TYPE_META = {
  birthday:    { label: '🎂 生日',      modes: ['yearly'] },
  anniversary: { label: '💑 纪念日',    modes: ['yearly'] },
  period:      { label: '🩸 经期',      modes: ['cycle'] },
  medicine:    { label: '💊 吃药',      modes: ['daily'] },
  bill:        { label: '📄 缴费',      modes: ['monthly'] },
  health:      { label: '🏃 健康',      modes: ['daily','weekly'] },
  festival:    { label: '🎉 节日',      modes: ['yearly'] },
  checkup:     { label: '🏥 体检',      modes: ['yearly'] },
  custom:      { label: '📌 自定义',    modes: ['daily','weekly','monthly','yearly'] },
};

function checkEvent(ev, _now) {
  const n = _now || now();
  const sched = ev.schedule || {};
  const mode = sched.mode || 'yearly';
  const ahead = ev.remind_ahead || 0;
  const msg = ev.messages || {};
  const today = dateStr();

  if (!ev.enabled) return null;

  if (mode === 'daily') {
    return { active: true, message: msg.default || `⏰ ${ev.name} — 该行动了`, urgent: true, days: 0, name: ev.name, type: ev.type };
  }

  if (mode === 'weekly') {
    const dayOfWeek = sched.day_of_week;
    const d = new Date(n.year, n.month-1, n.day);
    const dow = d.getDay();
    if (dayOfWeek !== undefined && dow === dayOfWeek) {
      return { active: true, message: msg.default || `📅 ${ev.name} — 今天是提醒日`, urgent: true, days: 0, name: ev.name, type: ev.type };
    }
    return null;
  }

  if (mode === 'monthly' || mode === 'yearly') {
    const month = mode === 'monthly' ? n.month : (sched.month || 1);
    const targetDay = new Date(n.year, month - 1, sched.day || 1);
    let diff = Math.floor((targetDay - new Date(n.year, n.month-1, n.day)) / 86400000);
    if (mode === 'yearly' && diff < 0) {
      targetDay.setFullYear(n.year + 1);
      diff = Math.floor((targetDay - new Date(n.year, n.month-1, n.day)) / 86400000);
    }
    if (mode === 'monthly' && diff < 0) {
      targetDay.setMonth(n.month); // next month
      diff = Math.floor((targetDay - new Date(n.year, n.month-1, n.day)) / 86400000);
    }
    const daysStr = diff.toString();
    if (diff === 0) {
      const m = msg.today ? msg.today.replace(/\{days\}/g, daysStr).replace(/\{name\}/g, ev.name) : `${TYPE_META[ev.type]?.label||'📌'} ${ev.name} — 就是今天！`;
      return { active: true, message: m, urgent: true, days: 0, name: ev.name, type: ev.type };
    }
    if (diff > 0 && diff <= ahead) {
      const m = msg.reminder ? msg.reminder.replace(/\{days\}/g, daysStr).replace(/\{name\}/g, ev.name) : `${TYPE_META[ev.type]?.label||'📌'} ${ev.name} — 还有 ${diff} 天`;
      return { active: true, message: m, urgent: false, days: diff, name: ev.name, type: ev.type };
    }
    return null;
  }

  if (mode === 'cycle') {
    // 周期（经期）模式
    const cycleLen = sched.cycle_length || 28;
    const periodLen = sched.period_length || 5;
    const lastStart = sched.last_start ? new Date(sched.last_start) : null;
    if (!lastStart) return null;
    const nowDate = new Date(n.year, n.month-1, n.day);
    const daysSince = Math.floor((nowDate - lastStart) / 86400000);
    const dayInCycle = daysSince % cycleLen;

    if (dayInCycle < periodLen) {
      const key = `day_${dayInCycle + 1}`;
      return { active: true, message: msg[key] || `🩸 经期第${dayInCycle+1}天`, urgent: true, days: 0, cycleDay: dayInCycle+1, name: ev.name, type: ev.type };
    }
    if (dayInCycle >= cycleLen - 14 - 3 && dayInCycle <= cycleLen - 14 + 3) {
      return { active: true, message: msg.ovulation || '🥚 排卵期', urgent: false, days: 0, cycleDay: dayInCycle+1, name: ev.name, type: ev.type };
    }
    const preDays = sched.remind_ahead_cycle || 3;
    if (cycleLen - dayInCycle <= preDays) {
      return { active: true, message: msg.pre || `🩸 经期快到了（还有${cycleLen - dayInCycle}天）`, urgent: false, days: cycleLen - dayInCycle, cycleDay: dayInCycle+1, name: ev.name, type: ev.type };
    }
    return null;
  }

  return null;
}

// ─── 推荐引擎 ───────────────────────────────────────
function getRecommendations(data) {
  const recs = [];
  const n = now();
  const nowDate = new Date(n.year, n.month-1, n.day);

  for (const ev of (data.events || [])) {
    if (!ev.enabled) continue;
    const sched = ev.schedule || {};

    if (ev.type === 'period' && sched.mode === 'cycle') {
      const lastStart = sched.last_start ? new Date(sched.last_start) : null;
      if (lastStart) {
        const cycleLen = sched.cycle_length || 28;
        const daysSince = Math.floor((nowDate - lastStart) / 86400000);
        const dayInCycle = daysSince % cycleLen;
        const daysToNext = cycleLen - dayInCycle;
        if (daysToNext <= 5 && daysToNext > 0) {
          recs.push({ type: 'period', name: ev.name, message: '🩸 经期快到了，记得准备暖宝宝', priority: 1 });
        }
      }
    }

    if ((ev.type === 'birthday' || ev.type === 'anniversary') && sched.mode === 'yearly') {
      const target = new Date(n.year, (sched.month||1)-1, (sched.day||1));
      let diff = Math.floor((target - nowDate) / 86400000);
      if (diff < 0) { target.setFullYear(n.year + 1); diff = Math.floor((target - nowDate) / 86400000); }
      if (diff <= 7 && diff >= 0) {
        recs.push({ type: ev.type, name: ev.name, message: `🎁 还有 ${diff} 天${ev.type==='birthday'?'生日':'纪念日'}，可以开始准备啦`, priority: 2 });
      }
    }

    if (ev.type === 'health') {
      recs.push({ type: 'health', name: ev.name, message: `🏃 每天记得 ${ev.name}，坚持就是胜利`, priority: 3 });
    }

    if (ev.type === 'bill' && sched.mode === 'monthly') {
      const target = new Date(n.year, n.month, (sched.day||1));
      let diff = Math.floor((target - nowDate) / 86400000);
      if (diff <= 5 && diff >= 0) {
        recs.push({ type: 'bill', name: ev.name, message: `💰 ${ev.name} 还有 ${diff} 天，记得预算`, priority: 2 });
      }
    }
  }

  return recs.sort((a, b) => a.priority - b.priority);
}

// ─── 推送 ────────────────────────────────────────────
async function sendFeishuCard(config, cardBody) {
  if (!config.feishu?.enabled || !config.feishu?.webhook_url) return { ok: false, error: '飞书未配置' };
  try {
    const res = await fetch(config.feishu.webhook_url, {
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

function buildFeishuCard(dateStr, items, title) {
  const lines = items.map(i => `• ${i.message}`);
  return {
    msg_type: 'interactive',
    card: {
      header: { title: { tag: 'plain_text', content: title || `📅 ${dateStr} 提醒` }, color: 'blue' },
      elements: [
        { tag: 'markdown', content: `**📌 今日提醒**\n${lines.join('\n')}` },
        { tag: 'hr' },
        { tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '📋 查看' }, type: 'primary', multi_url: { url: `http://localhost:${PORT}` } }] }
      ]
    }
  };
}

// ─── Express 应用 ────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 认证中间件（HMAC 签名 Token，跨进程/冷启动有效）
function authMiddleware(req, res, next) {
  const bypassExact = new Set(['/api/login', '/api/health', '/api/check', '/api/cron/check']);
  if (bypassExact.has(req.path)) return next();
  if (!req.path.startsWith('/api/')) return next();
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const user = verifyToken(token);
  if (user) { req.user = user; return next(); }
  return res.status(401).json({ error: '未认证' });
}
app.use(authMiddleware);

// ─── 认证 ────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const config = readJSON(CONFIG_FILE);
  const user = config.users?.[username];
  if (!user || user.password !== password) return res.status(401).json({ error: '用户名或密码错误' });
  const token = createToken({ username, label: user.label });
  res.json({ token, user: { username, label: user.label } });
});

// ─── 事件管理 ────────────────────────────────────────
app.get('/api/events', (req, res) => {
  const data = loadData();
  res.json(data.events);
});

app.post('/api/events', (req, res) => {
  const data = loadData();
  const ev = { id: nextId(data.events), ...req.body, enabled: req.body.enabled !== false };
  if (!ev.type || !ev.name) return res.status(400).json({ error: 'type 和 name 必填' });
  data.events.push(ev);
  data.history.push({ id: nextId(data.history), eventId: ev.id, action: 'create', detail: `${ev.type}:${ev.name}`, date: dateStr(), ts: Date.now() });
  saveData(data);
  res.json(ev);
});

app.put('/api/events/:id', (req, res) => {
  const data = loadData();
  const idx = data.events.findIndex(e => e.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '未找到' });
  data.events[idx] = { ...data.events[idx], ...req.body, id: data.events[idx].id };
  data.history.push({ id: nextId(data.history), eventId: data.events[idx].id, action: 'update', detail: `${data.events[idx].type}:${data.events[idx].name}`, date: dateStr(), ts: Date.now() });
  saveData(data);
  res.json(data.events[idx]);
});

app.delete('/api/events/:id', (req, res) => {
  const data = loadData();
  const idx = data.events.findIndex(e => e.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '未找到' });
  const ev = data.events.splice(idx, 1)[0];
  data.history.push({ id: nextId(data.history), eventId: ev.id, action: 'delete', detail: `${ev.type}:${ev.name}`, date: dateStr(), ts: Date.now() });
  saveData(data);
  res.json({ ok: true });
});

// ─── 检查与统计 ──────────────────────────────────────
app.get('/api/check', (req, res) => {
  const data = loadData();
  const n = now();
  const results = data.events.map(ev => checkEvent(ev, n)).filter(Boolean);
  res.json({ date: dateStr(), results });
});

app.get('/api/dashboard', (req, res) => {
  const data = loadData();
  const n = now();
  const today = data.events.map(ev => checkEvent(ev, n)).filter(r => r && r.active && r.days === 0);
  const upcoming = data.events.map(ev => checkEvent(ev, n)).filter(r => r && r.active && (r.days || 0) > 0 && (r.days || 99) <= 7);
  res.json({ date: dateStr(), today, upcoming: upcoming.sort((a,b) => (a.days||99) - (b.days||99)) });
});

app.get('/api/stats', (req, res) => {
  const data = loadData();
  const events = data.events;
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
});

app.get('/api/recommend', (req, res) => {
  const data = loadData();
  res.json(getRecommendations(data));
});

app.get('/api/history', (req, res) => {
  const data = loadData();
  res.json(data.history.slice(-100).reverse());
});

app.post('/api/history', (req, res) => {
  const data = loadData();
  const { eventId, action, detail } = req.body || {};
  if (!action || !detail) return res.status(400).json({ error: 'action 和 detail 必填' });
  data.history.push({ id: nextId(data.history), eventId: eventId || 0, action, detail, date: dateStr(), ts: Date.now() });
  saveData(data);
  res.json({ ok: true });
});

// ─── 配置 ────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  const config = readJSON(CONFIG_FILE);
  res.json(config);
});

app.put('/api/config', (req, res) => {
  const config = readJSON(CONFIG_FILE);
  const updated = { ...config, ...req.body };
  writeJSON(CONFIG_FILE, updated);
  res.json(updated);
});

// ─── 健康检查 ──────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const data = loadData();
  res.json({
    status: 'ok',
    time: dateStr(),
    version: '3.0.1',
    events: data.events.length,
    vercel: !!process.env.VERCEL
  });
});

// ─── Cron 定时检查（供 cron-job.org 调用）────────────
app.get('/api/cron/check', async (req, res) => {
  const data = loadData();
  const config = readJSON(CONFIG_FILE);
  const n = now();
  const todayItems = data.events.map(ev => checkEvent(ev, n)).filter(r => r && r.active && r.days === 0);
  const upcomingItems = data.events.map(ev => checkEvent(ev, n)).filter(r => r && r.active && r.days !== undefined && r.days > 0 && r.days <= 7);
  const cycleItems = data.events.map(ev => checkEvent(ev, n)).filter(r => r && r.active && r.cycleDay !== undefined);
  const allItems = [...todayItems, ...upcomingItems, ...cycleItems];
  const results = { date: dateStr(), today: todayItems.length, upcoming: upcomingItems.length, pushed: false };
  if (allItems.length === 0) { return res.json({ ...results, message: 'no reminders' }); }
  try {
    if (config.feishu?.enabled) {
      const card = buildFeishuCard(dateStr(), allItems);
      await sendFeishuCard(config, card);
    }
    if (config.serverchan?.enabled) {
      const title = `📅 ${dateStr()} 日常提醒`;
      const content = allItems.map(i => `- ${i.message}`).join('\n');
      await sendServerchan(config, title, content);
    }
    results.pushed = true;
  } catch (e) { results.error = e.message; }
  res.json(results);
});
 
// ─── 推送测试 ──────────────────────────────────────────
app.post('/api/feishu/test', async (req, res) => {
  const saved = readJSON(CONFIG_FILE);
  const body = req.body || {};
  // 允许用请求体覆盖（前端测试时可直接带表单值，避免未保存/实例间丢失）
  const config = {
    ...saved,
    feishu: {
      ...(saved.feishu || {}),
      enabled: body.enabled != null ? !!body.enabled : !!saved.feishu?.enabled,
      webhook_url: body.webhook_url != null ? String(body.webhook_url).trim() : (saved.feishu?.webhook_url || '')
    }
  };
  if (body.persist) {
    saved.feishu = config.feishu;
    writeJSON(CONFIG_FILE, saved);
  }
  const card = buildFeishuCard(dateStr(), [{ message: '✅ 这是一条测试消息' }], '🔔 提醒系统测试');
  const result = await sendFeishuCard(config, card);
  res.json(result);
});

app.post('/api/serverchan/test', async (req, res) => {
  const saved = readJSON(CONFIG_FILE);
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
    writeJSON(CONFIG_FILE, saved);
  }
  const result = await sendServerchan(config, '🔔 提醒系统测试', '这是一条来自日常提醒系统的测试消息\n\n如果收到这条消息，说明配置正确 ✅');
  res.json(result);
});

app.post('/api/feishu/send-card', async (req, res) => {
  const config = readJSON(CONFIG_FILE);
  const { title, items } = req.body || {};
  const card = buildFeishuCard(dateStr(), items || [], title);
  const result = await sendFeishuCard(config, card);
  res.json(result);
});

// ─── SPA 兜底 ─────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: '未知 API' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── 启动（直接 node server.js 时；Vercel / 测试 require 时不自动 listen）──
if (require.main === module && !process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`☀️ 日常提醒系统 v3.0 已启动`);
    console.log(`   📍 http://0.0.0.0:${PORT}`);
    console.log(`   ⏰ 时区: ${(readJSON(CONFIG_FILE).timezone || 'Asia/Shanghai')}`);
    console.log(`   📊 事件数: ${(readJSON(DATA_FILE).events || []).length}`);
  });
}

module.exports = app;
