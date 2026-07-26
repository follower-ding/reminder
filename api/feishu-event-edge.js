/**
 * 飞书事件入口（Edge）：URL 校验必须在 3s 内返回。
 * Edge 冷启动远快于 Node，且离国内更近；业务消息转发到 Node 函数。
 */
export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return Response.json({ ok: true, service: 'feishu-event-edge' });
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'POST only' }, { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (body.encrypt && !body.challenge && !body.type && !body.header) {
    return Response.json({
      error: 'encrypted_payload',
      hint: '请在飞书「加密策略」清空 Encrypt Key，仅用 Verification Token'
    });
  }

  // URL 校验：极快返回 challenge（飞书保存订阅地址时）
  if (body.type === 'url_verification' || (body.challenge && !body.header && !body.event)) {
    return Response.json({ challenge: body.challenge });
  }

  const origin = new URL(request.url).origin;
  const upstream = await fetch(`${origin}/api/feishu/event/node`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
