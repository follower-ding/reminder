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

/**
 * 应用机器人主动推卡片（无需群 Webhook）
 * cardBody: buildFeishuCard() 的返回值 { msg_type, card } 或纯 card
 */
async function sendInteractiveCard(receiveId, cardBody, receiveIdType = 'chat_id') {
  if (!receiveId) return { ok: false, error: '缺少 chat_id / receive_id' };
  if (!botConfigured()) return { ok: false, error: '未配置 FEISHU_APP_ID / FEISHU_APP_SECRET' };
  try {
    const token = await getTenantAccessToken();
    const card = cardBody?.card || cardBody;
    const res = await fetch(
      `${FEISHU_HOST}/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: 'interactive',
          content: JSON.stringify(card)
        })
      }
    );
    const json = await res.json();
    if (json.code !== 0) {
      return { ok: false, error: json.msg || `飞书错误 code=${json.code}`, data: json };
    }
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 去掉群聊 @机器人 / @_user_1，便于识别「收到」 */
function stripMentions(text) {
  return String(text || '')
    .replace(/@_user_\w+/gi, ' ')
    .replace(/@_all\b/gi, ' ')
    .replace(/@[^\s@]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 兼容 WS/HTTP 多种事件外壳，取出 message / chat_id */
function resolveMessageNode(body) {
  const candidates = [
    body?.event?.message,
    body?.message,
    body?.event?.event?.message,
    body?.data?.message
  ];
  for (const m of candidates) {
    if (m && (m.message_id || m.chat_id || m.content)) return m;
  }
  return {};
}

function parseMessageText(event) {
  try {
    const msg = resolveMessageNode(event);
    if (msg.message_type && msg.message_type !== 'text') return '';
    const raw = typeof msg.content === 'string' ? JSON.parse(msg.content) : (msg.content || {});
    return stripMentions(raw.text || '');
  } catch {
    return '';
  }
}

function extractChatId(body) {
  const message = resolveMessageNode(body);
  const raw =
    message.chat_id ||
    body?.event?.chat_id ||
    body?.chat_id ||
    body?.event?.event?.message?.chat_id ||
    '';
  return String(raw || '').trim();
}

function extractMessageMeta(body) {
  const message = resolveMessageNode(body);
  return {
    messageId: message.message_id,
    chatId: extractChatId(body),
    chatType: message.chat_type,
    text: parseMessageText(body)
  };
}

/** 「收到」/「已收到」/「确认」→ ack；可带事项名：收到 跑步 */
function matchAckIntent(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const m = t.match(/^(收到|已收到|确认收到|确认|done|ok)(?:\s*[：:，,]?\s*(.+))?$/i);
  if (m) return { intent: 'ack', nameHint: (m[2] || '').trim() || null };
  const m2 = t.match(/^(?:帮我)?确认(?:一下)?\s*[：:]?\s*(.+)$/);
  if (m2 && m2[1] && !/经期|生理期/.test(m2[1])) {
    return { intent: 'ack', nameHint: m2[1].replace(/[的了吧呀呢]+$/, '').trim() || null };
  }
  return null;
}

/** 「绑定」→ 记下 chat_id（勿交给 DeepSeek 瞎回） */
function matchBindIntent(text) {
  const t = String(text || '').trim();
  return /^(绑定|bind|绑定推送)$/i.test(t);
}

/**
 * 结构化问答意图（优先于通用 DeepSeek）
 * @returns {{ intent: string, source?: string } | null}
 */
function matchQaIntent(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (/^(帮助|help|菜单|能做什么|命令)$/i.test(t)) return { intent: 'help' };

  if (/(重新推送|再推一次|重推|再发一次|再推送)/.test(t)) {
    let source = null;
    if (/(编程|学习|课题)/.test(t)) source = 'learning';
    else if (/(github|开源)/i.test(t)) source = 'github';
    else if (/(快讯|新闻|热点)/.test(t)) source = 'news';
    return { intent: 'repost_digest', source };
  }
  if (/(换学习|换课题|换资料|换编程|轮换课题)/.test(t)) return { intent: 'rotate_learning' };
  if (/(换热点|换快讯|刷新快讯|换新闻|刷新热点)/.test(t)) return { intent: 'refresh_news' };
  if (/(换开源|刷新github|换github|刷新开源)/i.test(t)) return { intent: 'refresh_github' };

  if (/(谁过生日|近期生日|有哪些人.*生日|生日有谁|生日列表|哪些人生日)/.test(t) || /^(生日)$/.test(t)) {
    return { intent: 'birthdays' };
  }
  if (/(即将|日程|这周有什么|未来.*事项|近期提醒|两周内)/.test(t) || /^(日程)$/.test(t)) {
    return { intent: 'upcoming' };
  }
  if (/(清单|有哪些事项|习惯列表|日子列表|待办列表|全部事项)/.test(t) || /^(清单)$/.test(t)) {
    return { intent: 'inventory' };
  }
  if (/(概况|总结一下|今天怎么样|状态如何|项目概况)/.test(t) || /^(概况|总结)$/.test(t)) {
    return { intent: 'summary' };
  }

  if (/(今天学什么|每日编程|编程知识|今日课题|学什么)/.test(t)) return { intent: 'learning' };
  if (/(github|开源热门|热门仓库|今日开源)/i.test(t)) return { intent: 'github' };
  if (/(科技快讯|今日热点|今日新闻|快讯|今日精选)/.test(t)) return { intent: 'news' };
  if (/(今天事项|今日事项|今日提醒|有什么事|今日待办|今天待办)/.test(t)) return { intent: 'today' };
  if (/(哄哄她|哄哄|说句好听|安慰一下|说点好听|来句暖)/.test(t)) return { intent: 'comfort' };
  if (/(经期|生理期)/.test(t)) return { intent: 'period' };
  if (/^(推送状态|推送记录)$/.test(t)) return { intent: 'push_status' };
  if (/^(推迟|延期)\s+.+/.test(t)) return { intent: 'snooze' };
  if (/^(停用)\s+.+/.test(t)) return { intent: 'disable_event' };
  if (/^(启用)\s+.+/.test(t)) return { intent: 'enable_event' };
  if (/^(加习惯|新增习惯)\s+.+/.test(t)) return { intent: 'create_habit' };
  return null;
}

async function replyInteractive(messageId, cardBody) {
  const token = await getTenantAccessToken();
  const card = cardBody?.card || cardBody;
  const res = await fetch(`${FEISHU_HOST}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      msg_type: 'interactive',
      content: JSON.stringify(card)
    })
  });
  const json = await res.json();
  return { ok: json.code === 0, data: json };
}

async function chatWithDeepSeek(userText, contextNote) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return { ok: false, text: '还没配置 DEEPSEEK_API_KEY，暂时无法问答。你可以先回复「收到」确认今日事项。' };
  const system = [
    '你是 Nudge，私人轻量提醒与订阅助手，在飞书里对话。',
    '风格：简洁、口语、有温度；中文为主；不要提「网页助手」或编造不存在的事项。',
    '下方是实时上下文（待确认、生日、日程、清单、经期、订阅摘要）。优先据此回答。',
    '用户可用自然语言；若上下文已含答案直接答。缺数据就承认，并提示可说「生日」「清单」等。',
    '不要假装已经推送了卡片；推送类动作由系统意图路由执行。',
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
        temperature: 0.55,
        max_tokens: 1000
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

  if (matchBindIntent(meta.text)) {
    let chatId = meta.chatId;
    if (handlers.bindChat) {
      const bound = await handlers.bindChat(chatId);
      chatId = bound?.chat_id || chatId;
    }
    const reply = chatId
      ? `推送目标已绑定（${chatId.slice(0, 10)}…）。请打开网页设置 → 启用飞书推送 → 连通性测试。`
      : '没拿到群 chat_id。请在【群聊】里 @我 再发「绑定」，不要只在私聊里发。';
    try {
      if (botConfigured()) await replyText(meta.messageId, reply);
    } catch (e) {
      return { http: 200, json: { ok: true, action: 'bind', chat_id: chatId || null, reply_error: e.message } };
    }
    return { http: 200, json: { ok: true, action: 'bind', chat_id: chatId || null } };
  }

  const memory = require('./lib/feishu-memory');
  const actions = require('./lib/feishu-actions');
  memory.appendTurn(meta.chatId, 'user', meta.text);

  const pendingConfirm = actions.matchConfirmIntent(meta.text);
  if (pendingConfirm && memory.getPending(meta.chatId)) {
    let result;
    if (pendingConfirm.intent === 'confirm_yes') {
      const pending = memory.getPending(meta.chatId);
      memory.clearPending(meta.chatId);
      result = await actions.executePending(pending);
    } else {
      memory.clearPending(meta.chatId);
      result = { ok: true, text: '已取消，什么都没改。' };
    }
    memory.appendTurn(meta.chatId, 'assistant', result.text);
    try {
      if (botConfigured()) await replyText(meta.messageId, result.text || '好的。');
    } catch (e) {
      return { http: 200, json: { ok: true, action: 'confirm', reply_error: e.message, text: result.text } };
    }
    return { http: 200, json: { ok: true, action: 'confirm', text: result.text } };
  }

  const ack = matchAckIntent(meta.text);
  if (ack) {
    const result = handlers.ackToday
      ? await handlers.ackToday(ack.nameHint)
      : { text: '确认能力未就绪' };
    memory.appendTurn(meta.chatId, 'assistant', result.text || '');
    try {
      if (botConfigured()) await replyText(meta.messageId, result.text || '好的，已记下。');
    } catch (e) {
      return { http: 200, json: { ok: true, action: 'ack', reply_error: e.message, ...result } };
    }
    return { http: 200, json: { ok: true, action: 'ack', ...result } };
  }

  const qa = await resolveStructuredIntent(meta.text, handlers);
  if (qa && handlers.answerQa) {
    const result = await handlers.answerQa(qa.intent, meta.text, { ...qa, chatId: meta.chatId });
    try {
      if (botConfigured()) {
        if (result?.card) await replyInteractive(meta.messageId, result.card);
        else await replyText(meta.messageId, result?.text || '好的。');
      }
    } catch (e) {
      return {
        http: 200,
        json: { ok: true, action: 'qa', intent: qa.intent, via: qa.via, reply_error: e.message, text: result?.text }
      };
    }
    return { http: 200, json: { ok: true, action: 'qa', intent: qa.intent, via: qa.via || 'exact', card: !!result?.card } };
  }

  let contextNote = '';
  if (handlers.buildChatContext) {
    contextNote = await handlers.buildChatContext() || '';
  } else if (handlers.listPending) {
    const pending = await handlers.listPending();
    if (pending?.length) {
      contextNote = `今日尚未确认的事项：${pending.map((p) => p.name).join('、')}。用户也可回复「收到」一键确认。`;
    }
  }
  const memNote = memory.contextSnippet(meta.chatId);
  const chat = await chatWithDeepSeek(meta.text, [contextNote, memNote].filter(Boolean).join('\n'));
  memory.appendTurn(meta.chatId, 'assistant', chat.text || '');
  try {
    if (botConfigured()) await replyText(meta.messageId, chat.text);
  } catch (e) {
    return { http: 200, json: { ok: true, action: 'chat', deepseek: chat.ok, reply_error: e.message } };
  }
  return { http: 200, json: { ok: true, action: 'chat', deepseek: chat.ok } };
}

async function sendTextMessage(receiveId, text, receiveIdType = 'chat_id') {
  if (!receiveId) return { ok: false, error: '缺少 chat_id' };
  if (!botConfigured()) return { ok: false, error: '未配置飞书应用凭证' };
  try {
    const token = await getTenantAccessToken();
    const res = await fetch(
      `${FEISHU_HOST}/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: 'text',
          content: JSON.stringify({ text: String(text || '').slice(0, 4000) })
        })
      }
    );
    const json = await res.json();
    if (json.code !== 0) return { ok: false, error: json.msg || `code=${json.code}`, data: json };
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function resolveStructuredIntent(text, handlers = {}) {
  const { resolveQaIntent } = require('./lib/feishu-intent-router');
  if (handlers.resolveQaIntent) {
    return handlers.resolveQaIntent(text);
  }
  return resolveQaIntent(text, matchQaIntent, {
    useLlm: handlers.useLlmRoute !== false
  });
}

module.exports = {
  botConfigured,
  getTenantAccessToken,
  replyText,
  replyInteractive,
  sendInteractiveCard,
  stripMentions,
  parseMessageText,
  matchAckIntent,
  matchBindIntent,
  matchQaIntent,
  extractChatId,
  chatWithDeepSeek,
  handleEvent,
  extractMessageMeta,
  resolveStructuredIntent,
  sendTextMessage
};
