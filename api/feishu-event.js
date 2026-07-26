/**
 * 轻量飞书事件入口：URL 校验必须在 3s 内返回。
 * 校验路径零依赖；真正收消息再加载业务模块。
 */
module.exports = async function feishuEvent(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  // 飞书「请求地址」保存时的 challenge（必须极快）
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
    // 飞书要求尽快 200，避免重试风暴
    res.status(200).json({ ok: false, error: e.message });
  }
};
