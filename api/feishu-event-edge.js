/**
 * Edge：飞书 URL 校验必须在 3s 内返回（避开 Node 冷启动）。
 * 收消息转发到 Node 函数处理。
 */
function isChallenge(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.type === 'url_verification') return true;
  return !!(body.challenge && !body.header && !body.event);
}

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

  if (isChallenge(body)) {
    return Response.json({ challenge: body.challenge });
  }

  const origin = new URL(request.url).origin;
  const upstream = await fetch(`${origin}/api/feishu-event-process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Feishu-Internal': '1'
    },
    body: JSON.stringify(body)
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
