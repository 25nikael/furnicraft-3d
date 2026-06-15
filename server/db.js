'use strict';

/**
 * PostgreSQL connection pool + schema bootstrap.
 *
 * The pool is created from DATABASE_URL. On startup we attempt to connect
 * and create the tables if they don't exist. If the database is unreachable
 * the server still boots (serving the static 3D app), but auth/project
 * endpoints respond 503 until the DB becomes available.
 */

const { Pool } = require('pg');

let pool = null;
let ready = false;

function isReady() {
  return ready;
}

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: String(process.env.DATABASE_SSL).toLowerCase() === 'true'
        ? { rejectUnauthorized: false }
        : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000   // fail fast so retries can kick in
    });
    pool.on('error', (err) => {
      console.error('[db] unexpected pool error:', err.message);
    });
  }
  return pool;
}

/** Run a parameterised query. Throws if the DB is not configured. */
function query(text, params) {
  return getPool().query(text, params);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  google_id     TEXT,
  name          TEXT,
  verified      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  code          TEXT NOT NULL,
  password_hash TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes (email);

CREATE TABLE IF NOT EXISTS projects (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  state       JSONB NOT NULL,
  thumb       TEXT,
  is_public   BOOLEAN NOT NULL DEFAULT FALSE,
  share_token TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects (user_id);

-- Columns added after initial release (no-ops if already present)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS thumb TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS share_token TEXT;

CREATE TABLE IF NOT EXISTS project_versions (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  state       JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_versions_project ON project_versions (project_id);

CREATE TABLE IF NOT EXISTS feature_flags (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL DEFAULT '',
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO feature_flags (key, label, enabled) VALUES
  ('ai_design',       'AI Design Assistant',    true),
  ('image_to_design', 'AI Design from Image',   true),
  ('public_gallery',  'Public Gallery',         true),
  ('version_history', 'Version History',        true),
  ('pdf_export',      'PDF / Cut Sheet Export', true),
  ('share',           'Share Projects',         true)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE;
`;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Try to connect and ensure the schema exists.
 * @param {number} maxAttempts  0 = retry forever (background mode).
 * @returns {Promise<boolean>} true once connected.
 */
async function connectWithRetry(maxAttempts) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt++;
    try {
      await getPool().query(SCHEMA);
      ready = true;
      console.log('[db] connected and schema ready');
      return true;
    } catch (err) {
      ready = false;
      console.error(`[db] connect attempt ${attempt} failed: ${err.message}`);
      if (maxAttempts && attempt >= maxAttempts) return false;
      await sleep(Math.min(30000, 2000 * attempt)); // backoff, capped at 30s
    }
  }
}

/**
 * Connect and ensure the schema exists. Makes a few attempts up front (the DB
 * is often not accepting connections the instant the web service boots), then
 * keeps retrying in the background so the app recovers without a manual restart.
 */
async function init() {
  if (!process.env.DATABASE_URL) {
    console.warn('[db] DATABASE_URL not set — auth & projects disabled. '
      + 'Static 3D designer will still load.');
    ready = false;
    return false;
  }
  const ok = await connectWithRetry(5);
  if (!ok) {
    console.warn('[db] not ready after initial attempts — retrying in background.');
    connectWithRetry(0); // fire-and-forget; flips ready=true once reachable
  }
  return ok;
}

module.exports = { init, query, getPool, isReady };
