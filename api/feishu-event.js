/**
 * Edge Runtime：飞书 URL 校验在边缘节点 <3s 返回。
 * 真实消息事件转发到 Node 处理（/api/feishu/process）。
 */
export const config = {
  runtime: 'edge',
  regions: ['hnd1', 'sin1', 'hkg1']
};

async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export default async function handler(request) {
  const method = request.method || 'GET';

  if (method === 'GET' || method === 'HEAD') {
    return Response.json({ ok: true, service: 'feishu-event', runtime: 'edge' });
  }

  if (method !== 'POST') {
    return Response.json({ error: 'POST only' }, { status: 405 });
  }

  const body = await parseBody(request);

  if (body.encrypt && !body.challenge && !body.type && !body.header) {
    return Response.json({
      error: 'encrypted_payload',
      hint: '请在飞书「加密策略」清空 Encrypt Key，仅用 Verification Token'
    });
  }

  // URL 校验：必须极快
  if (body.type === 'url_verification' || (body.challenge && !body.header && !body.event)) {
    return new Response(JSON.stringify({ challenge: body.challenge }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  }

  // 真实事件：尽快 200，异步交给 Node 处理
  const processUrl = new URL('/api/feishu/process', request.url);
  const processPromise = fetch(processUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-nudge-internal': '1'
    },
    body: JSON.stringify(body)
  }).catch((err) => {
    console.error('[feishu-event edge] process failed', err && err.message);
  });

  try {
    const { waitUntil } = await import('@vercel/functions');
    waitUntil(processPromise);
  } catch {
    // 无 waitUntil 时短暂等待，尽量让请求发出
    await Promise.race([
      processPromise,
      new Promise((r) => setTimeout(r, 100))
    ]);
  }

  return Response.json({ ok: true });
}
