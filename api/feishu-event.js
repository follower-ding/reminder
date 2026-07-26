/**
 * 兼容旧路由：优先走 Edge 逻辑（若被 Node 调用则仍支持 challenge）。
 */
module.exports = async function feishuEvent(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.status(200).json({ ok: true, service: 'feishu-event' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  if (body.type === 'url_verification' || (body.challenge && !body.header && !body.event)) {
    res.status(200).json({ challenge: body.challenge });
    return;
  }

  req.headers['x-feishu-internal'] = '1';
  const process = require('./feishu-event-process');
  return process(req, res);
};
