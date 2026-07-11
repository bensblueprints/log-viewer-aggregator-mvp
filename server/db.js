const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

function nativeBindingPath() {
  if (!process.versions.electron) return null;
  const p = path.join(__dirname, '..', 'vendor', 'better_sqlite3-electron.node');
  return fs.existsSync(p) ? p : null;
}

function openDb(dbPath) {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const nativeBinding = nativeBindingPath();
  const db = new Database(dbPath, nativeBinding ? { nativeBinding } : {});
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      api_key TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#60a5fa',
      retention_days INTEGER NOT NULL DEFAULT 14,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS log_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',      -- debug|info|warn|error
      message TEXT NOT NULL,
      raw_json TEXT,
      received_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      source_id INTEGER,                        -- NULL = all sources
      pattern TEXT NOT NULL,                    -- regex on message
      threshold INTEGER NOT NULL DEFAULT 5,
      window_s INTEGER NOT NULL DEFAULT 300,
      webhook_url TEXT DEFAULT '',
      email TEXT DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_fired_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS alert_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL,
      fired_at INTEGER NOT NULL,
      match_count INTEGER NOT NULL,
      channel TEXT NOT NULL,
      ok INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS saved_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      query_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lines_source_time ON log_lines(source_id, received_at);
    CREATE INDEX IF NOT EXISTS idx_lines_time ON log_lines(received_at);
    CREATE INDEX IF NOT EXISTS idx_lines_level ON log_lines(level, received_at);
  `);

  return db;
}

function genToken(prefix = 'lb', len = 24) {
  return `${prefix}_${crypto.randomBytes(len).toString('hex')}`;
}

function genSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { openDb, genToken, genSessionToken };
