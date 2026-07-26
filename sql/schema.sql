-- reminder 持久化表（Neon / Vercel Postgres / 任意 PostgreSQL）
-- 应用首次读写时也会自动 CREATE IF NOT EXISTS

CREATE TABLE IF NOT EXISTS reminder_kv (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- key = 'data'   → { events: [...], history: [...] }
-- key = 'config' → 飞书 / Server酱 / 用户等配置
