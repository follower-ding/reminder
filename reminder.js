/**
 * ☀️ 日常提醒系统 — 定时推送脚本
 * 
 * 使用方法：
 *   node reminder.js              # 立即执行一次检查并推送
 *   node reminder.js --watch      # 每隔 5 分钟检查一次（开发用）
 *   
 * 配合 cron / PM2 定时执行：
 *   # crontab: 每天 9:00, 14:00, 21:00 执行
 *   0 9,14,21 * * * cd /opt/reminder && node reminder.js >> /var/log/reminder.log 2>&1
 */

const fs = require('fs');
const path = require('path');

const { loadData, loadConfig, normalizeData } = require('./store');

const DATA_FILE = path.join(__dirname, 'data.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return {}; }
}

function now(date) {
  const d = date ? new Date(date) : new Date();
  // timezone from env/file fallback for CLI; store.loadConfig used in runCheck
  let tz = 'Asia/Shanghai';
  try {
    const cfg = readJSON(CONFIG_FILE);
    if (cfg.timezone) tz = cfg.timezone;
  } catch { /* ignore */ }
  const opts = { timeZone: tz, hour12: false };
  const fmt = d.toLocaleString('en-CA', { ...opts, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const [y, mo, day, h, mi] = fmt.split(/[-\s:]/).map(Number);
  return { year: y, month: mo, day, hour: h, minute: mi,
    dateObj: new Date(d.toLocaleString('en-US', { timeZone: tz })) };
}

function dateStr(date) {
  const d = now(date);
  return `${d.year}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`;
}

// ─── 检查引擎（与 server.js 一致）─────────────────────
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

  if (!ev.enabled) return null;

  if (mode === 'daily') {
    return { active: true, message: msg.default || `⏰ ${ev.name} — 该行动了`, urgent: true, type: ev.type, name: ev.name };
  }

  if (mode === 'weekly') {
    const d = new Date(n.year, n.month-1, n.day);
    const dow = d.getDay();
    if (sched.day_of_week !== undefined && dow === sched.day_of_week) {
      return { active: true, message: msg.default || `📅 ${ev.name} — 今天是提醒日`, urgent: true, type: ev.type, name: ev.name };
    }
    return null;
  }

  if (mode === 'monthly' || mode === 'yearly') {
    const targetDay = new Date(n.year, (sched.month||1)-1, sched.day||1);
    let diff = Math.floor((targetDay - new Date(n.year, n.month-1, n.day)) / 86400000);
    if (mode === 'yearly' && diff < 0) {
      targetDay.setFullYear(n.year + 1);
      diff = Math.floor((targetDay - new Date(n.year, n.month-1, n.day)) / 86400000);
    }
    const daysStr = diff.toString();
    if (diff === 0) {
      const m = msg.today ? msg.today.replace(/\{days\}/g, daysStr).replace(/\{name\}/g, ev.name) : `${TYPE_META[ev.type]?.label||'📌'} ${ev.name} — 就是今天！`;
      return { active: true, message: m, urgent: true, days: 0, type: ev.type, name: ev.name };
    }
    if (diff > 0 && diff <= ahead) {
      const m = msg.reminder ? msg.reminder.replace(/\{days\}/g, daysStr).replace(/\{name\}/g, ev.name) : `${TYPE_META[ev.type]?.label||'📌'} ${ev.name} — 还有 ${diff} 天`;
      return { active: true, message: m, urgent: false, days: diff, type: ev.type, name: ev.name };
    }
    return null;
  }

  if (mode === 'cycle') {
    const cycleLen = sched.cycle_length || 28;
    const periodLen = sched.period_length || 5;
    const lastStart = sched.last_start ? new Date(sched.last_start) : null;
    if (!lastStart) return null;
    const nowDate = new Date(n.year, n.month-1, n.day);
    const daysSince = Math.floor((nowDate - lastStart) / 86400000);
    const dayInCycle = daysSince % cycleLen;

    if (dayInCycle < periodLen) {
      const key = `day_${dayInCycle + 1}`;
      return { active: true, message: msg[key] || `🩸 经期第${dayInCycle+1}天`, urgent: true, cycleDay: dayInCycle+1, type: ev.type, name: ev.name };
    }
    if (dayInCycle >= cycleLen - 14 - 3 && dayInCycle <= cycleLen - 14 + 3) {
      return { active: true, message: msg.ovulation || '🥚 排卵期', urgent: false, cycleDay: dayInCycle+1, type: ev.type, name: ev.name };
    }
    const preDays = sched.remind_ahead_cycle || 3;
    if (cycleLen - dayInCycle <= preDays) {
      return { active: true, message: msg.pre || `🩸 经期快到了（还有${cycleLen - dayInCycle}天）`, urgent: false, cycleDay: dayInCycle+1, type: ev.type, name: ev.name };
    }
    return null;
  }

  return null;
}

// ─── 推送 ────────────────────────────────────────────
async function sendFeishuCard(config, cardBody) {
  if (!config.feishu?.enabled || !config.feishu?.webhook_url) {
    console.log('  ⚠️  飞书未配置，跳过');
    return false;
  }
  try {
    const res = await fetch(config.feishu.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cardBody),
    });
    const text = await res.text();
    console.log(`  📤 飞书推送: ${res.ok ? '✅ 成功' : '❌ 失败'} — ${text}`);
    return res.ok;
  } catch (e) {
    console.log(`  ❌ 飞书推送异常: ${e.message}`);
    return false;
  }
}

async function sendServerchan(config, title, content) {
  if (!config.serverchan?.enabled || !config.serverchan?.sendkey) {
    console.log('  ⚠️  Server酱未配置，跳过');
    return false;
  }
  try {
    const res = await fetch(`https://sctapi.ftqq.com/${config.serverchan.sendkey}.send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, desp: content }),
    });
    const json = await res.json();
    console.log(`  📤 Server酱推送: ${json.code === 0 ? '✅ 成功' : '❌ 失败'} — ${json.message || ''}`);
    return json.code === 0;
  } catch (e) {
    console.log(`  ❌ Server酱推送异常: ${e.message}`);
    return false;
  }
}

function buildFeishuCard(dateStr, items) {
  const lines = items.map(i => `• ${i.message}`);
  return {
    msg_type: 'interactive',
    card: {
      header: { title: { tag: 'plain_text', content: `📅 ${dateStr} 提醒` }, color: 'blue' },
      elements: [
        { tag: 'markdown', content: `**📌 今日提醒**\n${lines.join('\n')}` },
        { tag: 'hr' },
      ]
    }
  };
}

// ─── 主流程 ──────────────────────────────────────────
async function runCheck() {
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`🔍 日常提醒检查 — ${dateStr()} ${now().hour}:${String(now().minute).padStart(2,'0')}`);
  console.log(`═══════════════════════════════════════════`);

  const config = await loadConfig();
  const data = await loadData();
  const events = normalizeData(data).events;
  const n = now();
  const todayItems = events.map(ev => checkEvent(ev, n)).filter(r => r && r.active && r.days === 0);
  const upcomingItems = events.map(ev => checkEvent(ev, n)).filter(r => r && r.active && r.days !== undefined && r.days > 0 && r.days <= 7);
  const cycleItems = events.map(ev => checkEvent(ev, n)).filter(r => r && r.active && r.cycleDay !== undefined);

  console.log(`  今日提醒: ${todayItems.length} 项`);
  console.log(`  近期待办: ${upcomingItems.length} 项`);
  console.log(`  周期事件: ${cycleItems.length} 项`);

  // 合并所有需要推送的消息
  const allItems = [...todayItems, ...upcomingItems, ...cycleItems];

  if (allItems.length === 0) {
    console.log(`  💤 暂无需要推送的消息`);
    return;
  }

  // 飞书推送
  if (config.feishu?.enabled) {
    console.log(`\n  📤 推送至飞书...`);
    const card = buildFeishuCard(dateStr(), allItems);
    await sendFeishuCard(config, card);
  }

  // Server酱推送
  if (config.serverchan?.enabled) {
    console.log(`\n  📤 推送至 Server酱...`);
    const title = `📅 ${dateStr()} 日常提醒`;
    const content = allItems.map(i => `- ${i.message}`).join('\n');
    await sendServerchan(config, title, content);
  }

  console.log(`\n  ✅ 推送完成`);
}

// ─── 入口 ────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--watch')) {
  console.log(`👀 监控模式启动，每 5 分钟检查一次...`);
  runCheck();
  setInterval(runCheck, 5 * 60 * 1000);
} else {
  runCheck().catch(e => console.error('运行出错:', e));
}
