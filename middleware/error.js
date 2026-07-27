/**
 * Nudge — 全局错误处理中间件
 */
const path = require('path');

function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = err.expose ? err.message : '服务器内部错误';
  const detail = process.env.NODE_ENV !== 'production' ? err.message : undefined;

  console.error(`[ERROR] ${req.method} ${req.path} → ${status}: ${err.message}`);
  if (err.stack) console.error(err.stack.split('\n').slice(0, 4).join('\n'));

  res.status(status).json({
    error: message,
    ...(detail ? { detail } : {}),
  });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function notFound(req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: '接口不存在' });
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
}

module.exports = { errorHandler, asyncHandler, notFound };