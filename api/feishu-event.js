/**
 * 轻量飞书事件入口：URL 校验必须在 3s 内返回。
 * 校验路径零依赖；真正收消息再加载业务模块。
 */

function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === 'string') {
    try { return Promise.resolve(JSON.parse(req.body || '{}')); } catch { return Promise.resolve({}); }
  }
  if (Buffer.isBuffer(req.body)) {
    try { return Promise.resolve(JSON.parse(req.body.toString('utf8') || '{}')); } catch { return Promise.resolve({}); }
  }
  // Vercel 偶发未预解析 body：从流读取
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
    // 已无流数据时尽快结束
    setTimeout(() => resolve({}), 50);
  });
}

module.exports = async function feishuEvent(req, res) {
  // 预热 / 探活：飞书保存前可先 GET 一次
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.status(200).json({ ok: true, service: 'feishu-event' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const body = await readBody(req);

  // 若开启了 Encrypt Key，飞书会把整包加密成 { encrypt: "..." } —— 请先关掉加密策略
  if (body.encrypt && !body.challenge && !body.type && !body.header) {
    res.status(200).json({
      error: 'encrypted_payload',
      hint: '请在飞书「加密策略」清空 Encrypt Key，仅用 Verification Token'
    });
    return;
  }

  // URL 校验：必须极快返回 challenge
  if (body.type === 'url_verification' || (body.challenge && !body.header && !body.event)) {
    res.status(200).json({ challenge: body.challenge });
    return;
  }

  try {
    const { handleFeishuHttp } = require('../feishu-event-http');
    const result = await handleFeishuHttp(body);
    res.status(result.http || 200).json(result.json || { ok: true });
  } catch (e) {
    console.error('[api/feishu-event]', e.message);
    res.status(200).json({ ok: false, error: e.message });
  }
};
