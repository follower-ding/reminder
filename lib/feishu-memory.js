/**
 * Short multi-turn memory per Feishu chat_id (in-process).
 * Survives within one Node process (pm2 / feishu:ws).
 */
const MAX_TURNS = 5;
const PENDING_TTL_MS = 5 * 60 * 1000;

/** @type {Map<string, { turns: Array<{role:string,text:string,at:number}>, pending: object|null, lastDigest: string|null, updatedAt: number }>} */
const sessions = new Map();

function sessionKey(chatId) {
  return String(chatId || '').trim() || '_anon';
}

function getSession(chatId) {
  const key = sessionKey(chatId);
  let s = sessions.get(key);
  if (!s) {
    s = { turns: [], pending: null, lastDigest: null, updatedAt: Date.now() };
    sessions.set(key, s);
  }
  if (s.pending && s.pending.expiresAt && Date.now() > s.pending.expiresAt) {
    s.pending = null;
  }
  return s;
}

function appendTurn(chatId, role, text) {
  const s = getSession(chatId);
  const t = String(text || '').trim().slice(0, 500);
  if (!t) return s;
  s.turns.push({ role: role === 'assistant' ? 'assistant' : 'user', text: t, at: Date.now() });
  if (s.turns.length > MAX_TURNS) s.turns = s.turns.slice(-MAX_TURNS);
  s.updatedAt = Date.now();
  return s;
}

function setPending(chatId, action) {
  const s = getSession(chatId);
  s.pending = {
    ...action,
    expiresAt: Date.now() + PENDING_TTL_MS
  };
  s.updatedAt = Date.now();
  return s.pending;
}

function clearPending(chatId) {
  const s = getSession(chatId);
  s.pending = null;
  return s;
}

function getPending(chatId) {
  return getSession(chatId).pending;
}

function setLastDigest(chatId, source) {
  const s = getSession(chatId);
  if (source === 'learning' || source === 'github' || source === 'news') {
    s.lastDigest = source;
  }
  return s;
}

function getLastDigest(chatId) {
  return getSession(chatId).lastDigest;
}

/** Text snippet for DeepSeek system context. */
function contextSnippet(chatId) {
  const s = getSession(chatId);
  const lines = [];
  if (s.lastDigest) lines.push(`上一次推送的订阅源：${s.lastDigest}`);
  if (s.pending) {
    lines.push(`待用户确认的动作：${s.pending.type}（${s.pending.summary || ''}）— 用户说「确认」执行、「取消」放弃`);
  }
  for (const t of s.turns) {
    lines.push(`${t.role === 'assistant' ? '助手' : '用户'}：${t.text}`);
  }
  return lines.length ? `近几轮对话：\n${lines.join('\n')}` : '';
}

function resetAllForTests() {
  sessions.clear();
}

module.exports = {
  getSession,
  appendTurn,
  setPending,
  clearPending,
  getPending,
  setLastDigest,
  getLastDigest,
  contextSnippet,
  resetAllForTests,
  MAX_TURNS,
  PENDING_TTL_MS
};
