/**
 * Nudge — 推送测试 / 定时推送路由
 */
const { Router } = require('express');
const store = require('../store');
const push = require('../lib/push');
const { asyncHandler } = require('../middleware/error');

const router = Router();

router.post('/feishu/test', asyncHandler(async (req, res) => {
  const config = await store.loadConfig();
  const card = {
    msg_type: 'interactive',
    card: {
      header: { title: { tag: 'plain_text', content: '🔔 提醒系统测试' }, color: 'blue' },
      elements: [
        { tag: 'markdown', content: '**✅ 这是一条测试消息**\n如果收到说明配置正确' },
      ]
    }
  };
  const result = await push.sendFeishuCard(config, card);
  res.json(result);
}));

router.post('/serverchan/test', asyncHandler(async (req, res) => {
  const config = await store.loadConfig();
  const result = await push.sendServerchan(config, '🔔 提醒系统测试', '这是一条测试消息，收到说明配置正确 ✅');
  res.json(result);
}));

router.post('/feishu/send-card', asyncHandler(async (req, res) => {
  const config = await store.loadConfig();
  const { title, items } = req.body || {};
  const lines = (items || []).map(i => '• ' + (i.message || ''));
  const card = {
    msg_type: 'interactive',
    card: {
      header: { title: { tag: 'plain_text', content: title || '提醒' }, color: 'blue' },
      elements: [
        { tag: 'markdown', content: lines.join('\n') },
      ]
    }
  };
  const result = await push.sendFeishuCard(config, card);
  res.json(result);
}));

module.exports = router;