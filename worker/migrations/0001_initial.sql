-- Migration number: 0001 	 initial
-- FileCast D1 schema (Phase 1). Applied with `wrangler d1 migrations apply filecast-db`.
-- This is the wrangler-native migration format: a numbered SQL file in migrations_dir.
-- (Alembic is not applicable here — it drives SQLAlchemy/FastAPI, not Cloudflare D1.)

-- Tool operational state (overlay on YAML configs)
CREATE TABLE tools (
  id TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  display_name TEXT,
  sort_order INTEGER DEFAULT 0,
  maintenance_message TEXT,
  custom_max_file_size TEXT,
  updated_at TEXT
);

-- Users (Google OAuth)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'user',
  max_file_size TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

-- Favorites
CREATE TABLE user_favorites (
  user_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, tool_id)
);

-- Conversion history (per-user)
CREATE TABLE user_conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  input_format TEXT,
  output_format TEXT,
  file_size_kb INTEGER,
  duration_ms INTEGER,
  status TEXT,
  created_at TEXT NOT NULL
);

-- User preferences
CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY,
  preferences TEXT NOT NULL
);

-- Anonymous ratings (dedup via server-computed fingerprint, not client-supplied)
CREATE TABLE ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id TEXT NOT NULL,
  vote TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(tool_id, fingerprint)
);

-- Aggregate conversion counters (anonymous)
CREATE TABLE conversions (
  tool_id TEXT NOT NULL,
  date TEXT NOT NULL,
  count INTEGER DEFAULT 0,
  failures INTEGER DEFAULT 0,
  PRIMARY KEY (tool_id, date)
);

-- Announcements
CREATE TABLE announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  link TEXT,
  type TEXT DEFAULT 'info',
  active INTEGER DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL
);

-- Client error tracking
CREATE TABLE errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id TEXT NOT NULL,
  error_type TEXT,
  error_message TEXT,
  browser TEXT,
  created_at TEXT NOT NULL
);

-- Indexes
CREATE INDEX idx_conversions_date ON conversions(date);
CREATE INDEX idx_conversions_tool ON conversions(tool_id);
CREATE INDEX idx_errors_created ON errors(created_at);
CREATE INDEX idx_errors_tool ON errors(tool_id);
CREATE INDEX idx_user_conversions_user ON user_conversions(user_id);
CREATE INDEX idx_ratings_tool ON ratings(tool_id);
