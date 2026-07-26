/**
 * Durable store for events + config.
 *
 * Backends (first match wins):
 * 1) PostgreSQL — DATABASE_URL / POSTGRES_URL / POSTGRES_PRISMA_URL
 * 2) Local filesystem — DATA_DIR（本地开发、Zeabur/VPS 单机）
 *
 * Vercel 上若未配置 DATABASE_URL，会落到 /tmp（ephemeral）。
 *
 * 注意：Serverless / Fluid 多实例下禁止进程级读缓存，否则 A 实例删除后
 * B 实例仍返回旧数据，看起来像「删不掉」。
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  feishu: { enabled: false, webhook_url: '', chat_id: '' },
  serverchan: { enabled: false, sendkey: '' },
  check_times: ['09:00'],
  default_push_time: '09:00',
  timezone: 'Asia/Shanghai',
  brand: { name: 'Nudge', tagline: '轻推一下，刚好想起' },
  digests: {
    enabled: true,
    push_time: '20:00',
    ai_summary: true,
    github: { enabled: true, push_time: '', ai: true },
    news: { enabled: true, push_time: '', ai: true, feeds: ['https://hnrss.org/frontpage'] },
    learning: { enabled: true, push_time: '', ai: true, topics: ['前端', '算法', 'Git', 'HTTP'] }
  },
  users: { admin: { password: 'admin123', label: '管理员' } }
};

const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp' : path.join(__dirname));
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  '';

const KEY_DATA = 'data';
const KEY_CONFIG = 'config';

let sqlClient = null;
let schemaReady = false;

function emptyData() {
  return { events: [], history: [], push_ledger: [] };
}

function normalizeData(raw) {
  if (Array.isArray(raw)) return { events: raw, history: [], push_ledger: [] };
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    events: Array.isArray(data.events) ? data.events : [],
    history: Array.isArray(data.history) ? data.history : [],
    push_ledger: Array.isArray(data.push_ledger) ? data.push_ledger : []
  };
}

function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    ...DEFAULT_CONFIG,
    ...cfg,
    feishu: { ...DEFAULT_CONFIG.feishu, ...(cfg.feishu || {}) },
    serverchan: { ...DEFAULT_CONFIG.serverchan, ...(cfg.serverchan || {}) },
    digests: {
      ...DEFAULT_CONFIG.digests,
      ...(cfg.digests || {}),
      github: { ...DEFAULT_CONFIG.digests.github, ...(cfg.digests?.github || {}) },
      news: { ...DEFAULT_CONFIG.digests.news, ...(cfg.digests?.news || {}) },
      learning: { ...DEFAULT_CONFIG.digests.learning, ...(cfg.digests?.learning || {}) }
    },
    users: { ...DEFAULT_CONFIG.users, ...(cfg.users || {}) }
  };
}

function detectBackend() {
  if (DATABASE_URL) return 'postgres';
  if (process.env.VERCEL) return 'ephemeral';
  return 'fs';
}

function persistenceInfo() {
  const backend = detectBackend();
  return {
    backend,
    durable: backend === 'postgres' || backend === 'fs',
    hint: backend === 'ephemeral'
      ? 'Vercel /tmp 不跨实例持久化。请在 Vercel 环境变量中配置 DATABASE_URL（Neon / Vercel Postgres）。'
      : null
  };
}

/** 完整演示种子（可选，不再在首次启动时自动灌入）。 */
function readSeedData() {
  const seedFile = path.join(__dirname, 'seed.data.json');
  try {
    const raw = fs.readFileSync(seedFile, 'utf8').replace(/^\uFEFF/, '');
    return normalizeData(JSON.parse(raw));
  } catch {
    return emptyData();
  }
}

/** 推送联调测试数据：覆盖「今日必推」场景。 */
function readPushTestData(nowParts) {
  const n = nowParts || {};
  const month = n.month || (new Date().getMonth() + 1);
  const day = n.day || new Date().getDate();
  const hh = String(n.hour != null ? n.hour : new Date().getHours()).padStart(2, '0');
  const time = `${hh}:00`;
  return {
    events: [
      {
        id: 9001,
        type: 'custom',
        name: '【测试】每日学习',
        category: 'test',
        enabled: true,
        remind_ahead: 0,
        schedule: { mode: 'daily', time },
        messages: { default: '📚 【推送测试】该学习了' }
      },
      {
        id: 9002,
        type: 'birthday',
        name: '【测试】今日生日',
        category: 'test',
        enabled: true,
        remind_ahead: 0,
        schedule: { mode: 'yearly', month, day, time },
        messages: {
          today: '🎂 【推送测试】生日快乐！',
          reminder: '还有 {days} 天是测试生日'
        }
      },
      {
        id: 9003,
        type: 'custom',
        name: '【测试】今日缴费',
        category: 'test',
        enabled: true,
        remind_ahead: 0,
        schedule: { mode: 'monthly', day, time },
        messages: {
          today: '📄 【推送测试】今天要缴费',
          reminder: '还有 {days} 天缴费'
        }
      },
      {
        id: 9004,
        type: 'period',
        name: '【测试】经期',
        category: 'test',
        enabled: true,
        remind_ahead: 0,
        schedule: {
          mode: 'cycle',
          cycle_length: 28,
          period_length: 5,
          last_start: `${n.year || new Date().getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          cycle_history: [`${n.year || new Date().getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`],
          time
        },
        messages: { day_1: '🩸 【推送测试】经期第1天' }
      }
    ],
    history: []
  };
}

function readJSONFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback();
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch {
    return fallback();
  }
}

function writeJSONFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getSql() {
  if (!DATABASE_URL) return null;
  if (!sqlClient) {
    const { neon } = require('@neondatabase/serverless');
    sqlClient = neon(DATABASE_URL);
  }
  return sqlClient;
}

async function ensureSchema() {
  if (schemaReady) return;
  const sql = getSql();
  if (!sql) return;
  await sql`
    CREATE TABLE IF NOT EXISTS reminder_kv (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  schemaReady = true;
}

async function pgGet(key) {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`SELECT value FROM reminder_kv WHERE key = ${key} LIMIT 1`;
  if (!rows.length) return null;
  return rows[0].value;
}

async function pgSet(key, value) {
  const sql = getSql();
  await ensureSchema();
  const payload = JSON.stringify(value);
  await sql`
    INSERT INTO reminder_kv (key, value, updated_at)
    VALUES (${key}, ${payload}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = NOW()
  `;
}

// ─── Public API ───────────────────────────────────────

async function loadData() {
  const backend = detectBackend();
  if (backend === 'postgres') {
    const existing = await pgGet(KEY_DATA);
    if (existing == null) {
      // 首次建库：空列表，不再自动灌入演示种子（避免「删不掉」错觉）
      const data = emptyData();
      await pgSet(KEY_DATA, data);
      return structuredClone(data);
    }
    return normalizeData(existing);
  }
  if (process.env.VERCEL && !fs.existsSync(DATA_FILE)) {
    writeJSONFile(DATA_FILE, emptyData());
  }
  return normalizeData(readJSONFile(DATA_FILE, emptyData));
}

async function saveData(data) {
  const normalized = normalizeData(data);
  const backend = detectBackend();
  if (backend === 'postgres') {
    await pgSet(KEY_DATA, normalized);
  } else {
    writeJSONFile(DATA_FILE, normalized);
  }
  return structuredClone(normalized);
}

async function loadConfig() {
  const backend = detectBackend();
  if (backend === 'postgres') {
    const existing = await pgGet(KEY_CONFIG);
    if (existing == null) {
      const cfg = normalizeConfig(DEFAULT_CONFIG);
      await pgSet(KEY_CONFIG, cfg);
      return structuredClone(cfg);
    }
    return normalizeConfig(existing);
  }
  if (process.env.VERCEL && !fs.existsSync(CONFIG_FILE)) {
    writeJSONFile(CONFIG_FILE, DEFAULT_CONFIG);
  }
  return normalizeConfig(readJSONFile(CONFIG_FILE, () => DEFAULT_CONFIG));
}

async function saveConfig(cfg) {
  const normalized = normalizeConfig(cfg);
  const backend = detectBackend();
  if (backend === 'postgres') {
    await pgSet(KEY_CONFIG, normalized);
  } else {
    writeJSONFile(CONFIG_FILE, normalized);
  }
  return structuredClone(normalized);
}

/** @deprecated 进程缓存已移除；保留空实现以兼容测试调用 */
function resetCache() {
  schemaReady = false;
}

module.exports = {
  DEFAULT_CONFIG,
  DATA_DIR,
  DATA_FILE,
  CONFIG_FILE,
  normalizeData,
  normalizeConfig,
  detectBackend,
  persistenceInfo,
  loadData,
  saveData,
  loadConfig,
  saveConfig,
  resetCache,
  readSeedData,
  readPushTestData,
  emptyData,
  ensureSchema
};
