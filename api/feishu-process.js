/**
 * Node：处理飞书真实事件（消息回执 / DeepSeek）
 * 仅供 Edge 入口内部调用。
 */
module.exports = async function feishuProcess(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  if (req.headers['x-nudge-internal'] !== '1') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch { body = {}; }
  }
  if (!body || typeof body !== 'object') body = {};

  try {
    const { handleFeishuHttp } = require('../feishu-event-http');
    const result = await handleFeishuHttp(body);
    res.status(result.http || 200).json(result.json || { ok: true });
  } catch (e) {
    console.error('[api/feishu-process]', e.message);
    res.status(200).json({ ok: false, error: e.message });
  }
};
