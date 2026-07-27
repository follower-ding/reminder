/**
 * Nudge — HMAC 无状态认证中间件
 *
 * 适合 Vercel 多实例 / 冷启动场景，无需在内存中维护 tokens 表。
 */
const crypto = require('crypto');

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'reminder-hmac-v1-change-me';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function createToken(user) {
  const payload = b64url(JSON.stringify({
    u: user.username,
    l: user.label || user.username,
    exp: Date.now() + TOKEN_TTL_MS,
  }));
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now() || !data.u) return null;
    return { username: data.u, label: data.l || data.u };
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const bypassExact = new Set([
    '/api/login', '/api/health', '/api/check',
    '/api/cron/check', '/api/feishu/event',
  ]);
  if (bypassExact.has(req.path)) return next();
  if (String(req.path || '').includes('feishu/event')) return next();
  if (req.path.startsWith('/api/ack/')) return next();
  if (!req.path.startsWith('/api/')) return next();

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const user = verifyToken(token);
  if (user) { req.user = user; return next(); }
  return res.status(401).json({ error: '\u672A\u8BA4\u8BC1' });
}

module.exports = { createToken, verifyToken, authMiddleware, TOKEN_SECRET, TOKEN_TTL_MS };