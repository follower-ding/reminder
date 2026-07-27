/**
 * Nudge — 推送渠道工具
 * 
 * 飞书 Webhook / 应用机器人、Server酱 微信推送。
 */
const feishuBot = require('../feishu-bot');

function resolveFeishuChatId(config) {
  return String(config?.feishu?.chat_id || process.env.FEISHU_CHAT_ID || '').trim();
}

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
  if (!config.feishu?.enabled) return { ok: false, error: '飞书未配置' };
  const webhook = String(config.feishu?.webhook_url || '').trim();
  const chatId = resolveFeishuChatId(config);
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
      if (parsed && parsed.code && parsed.code !== 0) return { ok: false, error: parsed.msg || '飞书错误', data: text };
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status, data: text };
      return { ok: true, data: text };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  if (feishuBot.botConfigured() && !chatId) {
    return { ok: false, error: '应用机器人已配置，但还没有 chat_id：请在目标群 @Nudge 发一句「绑定」' };
  }
  return { ok: false, error: '飞书未配置' };
}

async function sendServerchan(config, title, content) {
  if (!config.serverchan?.enabled || !config.serverchan?.sendkey) return { ok: false, error: 'Server酱未配置' };
  try {
    const res = await fetch('https://sctapi.ftqq.com/' + config.serverchan.sendkey + '.send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, desp: content }),
    });
    const json = await res.json();
    return { ok: json.code === 0, data: json };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { resolveFeishuChatId, mergeFeishuConfig, feishuPushReady, sendFeishuCard, sendServerchan };