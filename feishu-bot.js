/**
 * Feishu application bot — receive messages, ack "收到", DeepSeek chat.
 * Requires FEISHU_APP_ID + FEISHU_APP_SECRET (env). Optional FEISHU_VERIFICATION_TOKEN.
 */
const FEISHU_HOST = 'https://open.feishu.cn';

let tokenCache = { token: null, expireAt: 0 };

function botConfigured() {
  return !!(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET);
}

function verificationToken() {
  return process.env.FEISHU_VERIFICATION_TOKEN || '';
}

async function getTenantAccessToken() {
  if (!botConfigured()) throw new Error('未配置 FEISHU_APP_ID / FEISHU_APP_SECRET');
  if (tokenCache.token && Date.now() < tokenCache.expireAt - 60_000) return tokenCache.token;
  const res = await fetch(`${FEISHU_HOST}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET
    })
  });
  const json = await res.json();
  if (json.code !== 0 || !json.tenant_access_token) {
    throw new Error(json.msg || '获取 tenant_access_token 失败');
  }
  tokenCache = {
    token: json.tenant_access_token,
    expireAt: Date.now() + (json.expire || 7200) * 1000
  };
  return tokenCache.token;
}

async function replyText(messageId, text) {
  const token = await getTenantAccessToken();
  const res = await fetch(`${FEISHU_HOST}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      msg_type: 'text',
      content: JSON.stringify({ text: String(text || '').slice(0, 4000) })
    })
  });
  const json = await res.json();
  return { ok: json.code === 0, data: json };
}

function parseMessageText(event) {
  try {
    const msg = event?.event?.message || event?.message || {};
    if (msg.message_type && msg.message_type !== 'text') return '';
    const raw = typeof msg.content === 'string' ? JSON.parse(msg.content) : (msg.content || {});
    return String(raw.text || '').trim();
  } catch {
    return '';
  }
}

function extractMessageMeta(body) {
  const event = body?.event || body;
  const message = event?.message || {};
  return {
    messageId: message.message_id,
    chatId: message.chat_id,
    chatType: message.chat_type,
    text: parseMessageText(body)
  };
}

/** 「收到」/「已收到」/「确认」→ ack；可带事项名：收到 跑步 */
function matchAckIntent(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const m = t.match(/^(收到|已收到|确认收到|确认|done|ok)(?:\s*[：:，,]?\s*(.+))?$/i);
  if (!m) return null;
  return { intent: 'ack', nameHint: (m[2] || '').trim() || null };
}

async function chatWithDeepSeek(userText, contextNote) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return { ok: false, text: '还没配置 DEEPSEEK_API_KEY，暂时无法问答。你可以先回复「收到」确认今日事项。' };
  const system = [
    '你是 Nudge，轻量日常提醒助手。',
    '回答简洁、口语、有用；中文为主。',
    '用户在飞书里和你对话；不要提网页助手。',
    contextNote || ''
  ].filter(Boolean).join('\n');
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userText }
        ],
        temperature: 0.6,
        max_tokens: 800
      })
    });
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) return { ok: false, text: 'DeepSeek 暂时没返回内容，稍后再试。' };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, text: `问答失败：${e.message}` };
  }
}

/**
 * Handle Feishu event callback body.
 * handlers: { ackToday(nameHint), listPending() }
 */
async function handleEvent(body, handlers = {}) {
  if (!body || typeof body !== 'object') return { http: 400, json: { error: 'bad body' } };

  // URL verification
  if (body.type === 'url_verification' || body.challenge) {
    const token = verificationToken();
    if (token && body.token && body.token !== token) {
      return { http: 403, json: { error: 'invalid token' } };
    }
    return { http: 200, json: { challenge: body.challenge } };
  }

  const token = verificationToken();
  if (token && body.token && body.token !== token) {
    return { http: 403, json: { error: 'invalid token' } };
  }

  // v2 schema: header.event_type
  const eventType = body.header?.event_type || body.event?.type || body.type;
  if (eventType && eventType !== 'im.message.receive_v1' && !body.event?.message) {
    return { http: 200, json: { ok: true, ignored: eventType } };
  }

  const meta = extractMessageMeta(body);
  if (!meta.messageId || !meta.text) {
    return { http: 200, json: { ok: true, ignored: 'empty' } };
  }

  const ack = matchAckIntent(meta.text);
  if (ack) {
    const result = handlers.ackToday
      ? await handlers.ackToday(ack.nameHint)
      : { text: '确认能力未就绪' };
    try {
      if (botConfigured()) await replyText(meta.messageId, result.text || '好的，已记下。');
    } catch (e) {
      return { http: 200, json: { ok: true, action: 'ack', reply_error: e.message, ...result } };
    }
    return { http: 200, json: { ok: true, action: 'ack', ...result } };
  }

  let contextNote = '';
  if (handlers.listPending) {
    const pending = await handlers.listPending();
    if (pending?.length) {
      contextNote = `今日尚未确认的事项：${pending.map((p) => p.name).join('、')}。用户也可回复「收到」一键确认。`;
    }
  }
  const chat = await chatWithDeepSeek(meta.text, contextNote);
  try {
    if (botConfigured()) await replyText(meta.messageId, chat.text);
  } catch (e) {
    return { http: 200, json: { ok: true, action: 'chat', deepseek: chat.ok, reply_error: e.message } };
  }
  return { http: 200, json: { ok: true, action: 'chat', deepseek: chat.ok } };
}

module.exports = {
  botConfigured,
  getTenantAccessToken,
  replyText,
  parseMessageText,
  matchAckIntent,
  chatWithDeepSeek,
  handleEvent,
  extractMessageMeta
};
