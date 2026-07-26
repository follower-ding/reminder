/**
 * Durable store for events + config.
 *
 * Backends (first match wins):
 * 1) PostgreSQL — DATABASE_URL / POSTGRES_URL / POSTGRES_PRISMA_URL
 *    (Neon / Vercel Postgres / 任意 Postgres 均可)
 * 2) Local filesystem — DATA_DIR（本地开发、Zeabur/VPS 单机）
 *
 * Vercel 上若未配置 DATABASE_URL，会落到 /tmp（ephemeral），删除/设置会丢失。
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  feishu: { enabled: false, webhook_url: '' },
  serverchan: { enabled: false, sendkey: '' },
  check_times: ['09:00', '14:00', '21:00'],
  timezone: 'Asia/Shanghai',
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

const cache = { data: null, config: null };
let sqlClient = null;
let schemaReady = false;

function normalizeData(raw) {
  if (Array.isArray(raw)) return { events: raw, history: [] };
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    events: Array.isArray(data.events) ? data.events : [],
    history: Array.isArray(data.history) ? data.history : []
  };
}

function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    ...DEFAULT_CONFIG,
    ...cfg,
    feishu: { ...DEFAULT_CONFIG.feishu, ...(cfg.feishu || {}) },
    serverchan: { ...DEFAULT_CONFIG.serverchan, ...(cfg.serverchan || {}) },
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

function readSeedData() {
  const seedFile = path.join(__dirname, 'seed.data.json');
  try {
    const raw = fs.readFileSync(seedFile, 'utf8').replace(/^\uFEFF/, '');
    return normalizeData(JSON.parse(raw));
  } catch {
    return { events: [], history: [] };
  }
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
  if (cache.data) return structuredClone(cache.data);
  const backend = detectBackend();
  let data;
  if (backend === 'postgres') {
    const existing = await pgGet(KEY_DATA);
    if (existing == null) {
      data = readSeedData();
      await pgSet(KEY_DATA, data);
    } else {
      data = normalizeData(existing);
    }
  } else {
    if (process.env.VERCEL && !fs.existsSync(DATA_FILE)) {
      writeJSONFile(DATA_FILE, readSeedData());
    }
    data = normalizeData(readJSONFile(DATA_FILE, readSeedData));
  }
  cache.data = data;
  return structuredClone(data);
}

async function saveData(data) {
  const normalized = normalizeData(data);
  const backend = detectBackend();
  if (backend === 'postgres') {
    await pgSet(KEY_DATA, normalized);
  } else {
    writeJSONFile(DATA_FILE, normalized);
  }
  cache.data = normalized;
  return structuredClone(normalized);
}

async function loadConfig() {
  if (cache.config) return structuredClone(cache.config);
  const backend = detectBackend();
  let cfg;
  if (backend === 'postgres') {
    const existing = await pgGet(KEY_CONFIG);
    if (existing == null) {
      cfg = normalizeConfig(DEFAULT_CONFIG);
      await pgSet(KEY_CONFIG, cfg);
    } else {
      cfg = normalizeConfig(existing);
    }
  } else {
    if (process.env.VERCEL && !fs.existsSync(CONFIG_FILE)) {
      writeJSONFile(CONFIG_FILE, DEFAULT_CONFIG);
    }
    cfg = normalizeConfig(readJSONFile(CONFIG_FILE, () => DEFAULT_CONFIG));
  }
  cache.config = cfg;
  return structuredClone(cfg);
}

async function saveConfig(cfg) {
  const normalized = normalizeConfig(cfg);
  const backend = detectBackend();
  if (backend === 'postgres') {
    await pgSet(KEY_CONFIG, normalized);
  } else {
    writeJSONFile(CONFIG_FILE, normalized);
  }
  cache.config = normalized;
  return structuredClone(normalized);
}

/** Clear memory cache (tests). */
function resetCache() {
  cache.data = null;
  cache.config = null;
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
  ensureSchema
};
