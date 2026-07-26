/**
 * Node：飞书消息业务（收到 / DeepSeek），由 Edge 转发。
 */
module.exports = async function feishuEventProcess(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  if (req.headers['x-feishu-internal'] !== '1') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  try {
    const { handleFeishuHttp } = require('../feishu-event-http');
    const result = await handleFeishuHttp(body);
    res.status(result.http || 200).json(result.json || { ok: true });
  } catch (e) {
    console.error('[feishu-event-process]', e.message);
    res.status(200).json({ ok: false, error: e.message });
  }
};
