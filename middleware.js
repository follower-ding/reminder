/**
 * Edge：飞书 URL 校验在边缘秒回 challenge（规避美区 Node 冷启动 >3s）
 */
import { next } from '@vercel/edge';

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

  // clone：避免读 body 后 next() 时 Node 拿不到请求体
  let body = {};
  try {
    body = await request.clone().json();
  } catch {
    body = {};
  }

  if (body.encrypt && !body.challenge && body.type !== 'url_verification') {
    return Response.json({
      error: 'encrypted_payload',
      hint: '请在飞书加密策略清空 Encrypt Key'
    });
  }

  if (body.type === 'url_verification' || (body.challenge && !body.header && !body.event)) {
    return new Response(JSON.stringify({ challenge: body.challenge }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  }

  return next();
}
