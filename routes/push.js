/**
 * Nudge — 推送测试路由（行为对齐重构前 server.js）
 */
const { Router } = require('express');
const store = require('../store');
const engine = require('../engine');
const push = require('../lib/push');
const { asyncHandler } = require('../middleware/error');

const router = Router();

const APP_URL = process.env.APP_URL || 'https://reminder-three-gamma.vercel.app';
const BRAND = { name: 'Nudge', tagline: '轻推一下，刚好想起' };

function dateStr(date) {
  const d = date ? new Date(date) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

router.post('/feishu/test', asyncHandler(async (req, res) => {
  const saved = await store.loadConfig();
  const body = req.body || {};
  const config = {
    ...saved,
    feishu: push.mergeFeishuConfig(saved.feishu, {
      enabled: body.enabled != null ? !!body.enabled : saved.feishu?.enabled,
      webhook_url: body.webhook_url,
      chat_id: body.chat_id
    })
  };
  if (body.persist) {
    saved.feishu = config.feishu;
    await store.saveConfig(saved);
  }
  const card = engine.buildFeishuCard(
    dateStr(),
    [{ message: '推送通道可用。此消息不是任何事项提醒。', type: 'custom' }],
    '【连通性测试】非事项提醒',
    APP_URL,
    BRAND.name
  );
  const result = await push.sendFeishuCard(config, card);
  res.json(result);
}));

router.post('/serverchan/test', asyncHandler(async (req, res) => {
  const saved = await store.loadConfig();
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
    await store.saveConfig(saved);
  }
  const result = await push.sendServerchan(
    config,
    '🔔 提醒系统测试',
    '这是一条来自日常提醒系统的测试消息\n\n如果收到这条消息，说明配置正确 ✅'
  );
  res.json(result);
}));

router.post('/feishu/send-card', asyncHandler(async (req, res) => {
  const config = await store.loadConfig();
  const { title, items } = req.body || {};
  const card = engine.buildFeishuCard(dateStr(), items || [], title, APP_URL);
  const result = await push.sendFeishuCard(config, card);
  res.json(result);
}));

module.exports = router;
