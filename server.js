const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── 路径 ────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const PORT = process.env.PORT || 3333;

// ─── 工具 ────────────────────────────────────────────
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {}; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function now(date) {
  const d = date ? new Date(date) : new Date();
  const tz = (readJSON(CONFIG_FILE).timezone || 'Asia/Shanghai');
  const opts = { timeZone: tz, hour12: false };
  const parts = {};
  for (const k of ['year','month','day','hour','minute']) {
    parts[k] = parseInt(d.toLocaleString('en-CA', { ...opts, [k==='year'?'year':'numeric']: true, ...(k==='month'?{month:'2-digit'}:{}), ...(k==='day'?{day:'2-digit'}:{}), ...(k==='hour'?{hour:'2-digit'}:{}), ...(k==='minute'?{minute:'2-digit'}:{}) }).split(/[-\s:]/)[['year','month','day','hour','minute'].indexOf(k)], 10);
  }
  return parts;
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
function authToken() {
  return crypto.randomBytes(16).toString('hex');
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
    return { active: true, message: msg.default || `⏰ ${ev.name} — 该行动了`, urgent: true };
  }

  if (mode === 'weekly') {
    const dayOfWeek = sched.day_of_week;
    if (dayOfWeek === undefined || n.dayOfWeek === undefined) {
      const d = new Date(n.year, n.month-1, n.day);
      const dow = d.getDay();
      if (dayOfWeek !== undefined && dow === dayOfWeek) {
        return { active: true, message: msg.default || `📅 ${ev.name} — 今天是提醒日`, urgent: true };
      }
    }
    return null;
  }

  if (mode === 'monthly' || mode === 'yearly') {
    const target = new Date(n.year, (sched.month||1)-1, sched.day||1);
    const targetDay = new Date(n.year, (sched.month||1)-1, sched.day||1);
    let diff = Math.floor((targetDay - new Date(n.year, n.month-1, n.day)) / 86400000);
    if (mode === 'yearly' && diff < 0) {
      targetDay.setFullYear(n.year + 1);
      diff = Math.floor((targetDay - new Date(n.year, n.month-1, n.day)) / 86400000);
    }
    const daysStr = diff.toString();
    if (diff === 0) {
      const m = msg.today ? msg.today.replace(/\{days\}/g, daysStr).replace(/\{name\}/g, ev.name) : `${TYPE_META[ev.type]?.label||'📌'} ${ev.name} — 就是今天！`;
      return { active: true, message: m, urgent: true, days: 0 };
    }
    if (diff > 0 && diff <= ahead) {
      const m = msg.reminder ? msg.reminder.replace(/\{days\}/g, daysStr).replace(/\{name\}/g, ev.name) : `${TYPE_META[ev.type]?.label||'📌'} ${ev.name} — 还有 ${diff} 天`;
      return { active: true, message: m, urgent: false, days: diff };
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
      return { active: true, message: msg[key] || `🩸 经期第${dayInCycle+1}天`, urgent: true, cycleDay: dayInCycle+1 };
    }
    if (dayInCycle >= cycleLen - 14 - 3 && dayInCycle <= cycleLen - 14 + 3) {
      return { active: true, message: msg.ovulation || '🥚 排卵期', urgent: false, cycleDay: dayInCycle+1 };
    }
    const preDays = sched.remind_ahead_cycle || 3;
    if (cycleLen - dayInCycle <= preDays) {
      return { active: true, message: msg.pre || `🩸 经期快到了（还有${cycleLen - dayInCycle}天）`, urgent: false, cycleDay: dayInCycle+1 };
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

  for (const ev of data.events) {
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
    return { ok: res.ok, data: text };
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

// 认证中间件 (简单 Token)
let tokens = {};
function authMiddleware(req, res, next) {
  const bypass = ['/api/login', '/api/health', '/api/check', '/'];
  if (bypass.some(p => req.path === p || req.path.startsWith(p) && req.method === 'GET' && !req.path.startsWith('/api'))) return next();
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token && tokens[token]) { req.user = tokens[token]; return next(); }
  // 仅对 /api/ 路径要求认证
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: '未认证' });
  next();
}
app.use(authMiddleware);

// ─── 认证 ────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const config = readJSON(CONFIG_FILE);
  const user = config.users?.[username];
  if (!user || user.password !== password) return res.status(401).json({ error: '用户名或密码错误' });
  const token = authToken();
  tokens[token] = { username, label: user.label };
  res.json({ token, user: { username, label: user.label } });
});

// ─── 事件管理 ────────────────────────────────────────
app.get('/api/events', (req, res) => {
  const data = readJSON(DATA_FILE);
  res.json(data.events || []);
});

app.post('/api/events', (req, res) => {
  const data = readJSON(DATA_FILE);
  const ev = { id: nextId(data.events), ...req.body, enabled: req.body.enabled !== false };
  if (!ev.type || !ev.name) return res.status(400).json({ error: 'type 和 name 必填' });
  data.events.push(ev);
  data.history = data.history || [];
  data.history.push({ id: nextId(data.history), eventId: ev.id, action: 'create', detail: `${ev.type}:${ev.name}`, date: dateStr(), ts: Date.now() });
  writeJSON(DATA_FILE, data);
  res.json(ev);
});

app.put('/api/events/:id', (req, res) => {
  const data = readJSON(DATA_FILE);
  const idx = data.events.findIndex(e => e.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '未找到' });
  data.events[idx] = { ...data.events[idx], ...req.body, id: data.events[idx].id };
  data.history.push({ id: nextId(data.history), eventId: data.events[idx].id, action: 'update', detail: `${data.events[idx].type}:${data.events[idx].name}`, date: dateStr(), ts: Date.now() });
  writeJSON(DATA_FILE, data);
  res.json(data.events[idx]);
});

app.delete('/api/events/:id', (req, res) => {
  const data = readJSON(DATA_FILE);
  const idx = data.events.findIndex(e => e.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '未找到' });
  const ev = data.events.splice(idx, 1)[0];
  data.history.push({ id: nextId(data.history), eventId: ev.id, action: 'delete', detail: `${ev.type}:${ev.name}`, date: dateStr(), ts: Date.now() });
  writeJSON(DATA_FILE, data);
  res.json({ ok: true });
});

// ─── 检查与统计 ──────────────────────────────────────
app.get('/api/check', (req, res) => {
  const data = readJSON(DATA_FILE);
  const n = now();
  const results = data.events.map(ev => checkEvent(ev, n)).filter(Boolean);
  res.json({ date: dateStr(), results });
});

app.get('/api/dashboard', (req, res) => {
  const data = readJSON(DATA_FILE);
  const n = now();
  const today = data.events.map(ev => checkEvent(ev, n)).filter(r => r && r.active && r.days === 0);
  const upcoming = data.events.map(ev => checkEvent(ev, n)).filter(r => r && r.active && (r.days || 0) > 0 && (r.days || 99) <= 7);
  res.json({ date: dateStr(), today, upcoming: upcoming.sort((a,b) => (a.days||99) - (b.days||99)) });
});

app.get('/api/stats', (req, res) => {
  const data = readJSON(DATA_FILE);
  const events = data.events || [];
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
  const data = readJSON(DATA_FILE);
  res.json(getRecommendations(data));
});

app.get('/api/history', (req, res) => {
  const data = readJSON(DATA_FILE);
  res.json((data.history || []).slice(-100).reverse());
});

app.post('/api/history', (req, res) => {
  const data = readJSON(DATA_FILE);
  const { eventId, action, detail } = req.body || {};
  if (!action || !detail) return res.status(400).json({ error: 'action 和 detail 必填' });
  data.history = data.history || [];
  data.history.push({ id: nextId(data.history), eventId: eventId || 0, action, detail, date: dateStr(), ts: Date.now() });
  writeJSON(DATA_FILE, data);
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
  res.json({ status: 'ok', time: dateStr(), version: '3.0.0' });
});

// ─── 推送测试 ──────────────────────────────────────────
app.post('/api/feishu/test', async (req, res) => {
  const config = readJSON(CONFIG_FILE);
  const card = buildFeishuCard(dateStr(), [{ message: '✅ 这是一条测试消息' }], '🔔 提醒系统测试');
  const result = await sendFeishuCard(config, card);
  res.json(result);
});

app.post('/api/serverchan/test', async (req, res) => {
  const config = readJSON(CONFIG_FILE);
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

// ─── 启动 ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`☀️ 日常提醒系统 v3.0 已启动`);
  console.log(`   📍 http://localhost:${PORT}`);
  console.log(`   ⏰ 时区: ${(readJSON(CONFIG_FILE).timezone || 'Asia/Shanghai')}`);
  console.log(`   📊 事件数: ${(readJSON(DATA_FILE).events || []).length}`);
});
