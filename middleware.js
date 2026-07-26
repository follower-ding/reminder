/**
 * Edge：飞书 URL 校验在边缘节点直接返回 challenge（避免打到美区 Node 冷启动 >3s）
 */
export const config = {
  matcher: '/api/feishu/event'
};

export default async function middleware(request) {
  const method = request.method || 'GET';

  if (method === 'GET' || method === 'HEAD') {
    return Response.json({ ok: true, service: 'feishu-event', edge: true });
  }

  if (method !== 'POST') {
    return Response.json({ error: 'POST only' }, { status: 405 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // 加密策略开了 Encrypt Key 时无法在边缘解密
  if (body.encrypt && !body.challenge && body.type !== 'url_verification') {
    return Response.json({
      error: 'encrypted_payload',
      hint: '请在飞书加密策略清空 Encrypt Key'
    });
  }

  // URL 验证：必须 <3s，边缘直接回
  if (body.type === 'url_verification' || (body.challenge && !body.header && !body.event)) {
    return new Response(JSON.stringify({ challenge: body.challenge }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  }

  // 真实事件：放行到 Node 函数处理
  return fetch(request);
}
