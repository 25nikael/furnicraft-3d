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
      idleTimeoutMillis: 30000
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
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects (user_id);
`;

/** Connect and ensure the schema exists. Resolves to true on success. */
async function init() {
  if (!process.env.DATABASE_URL) {
    console.warn('[db] DATABASE_URL not set — auth & projects disabled. '
      + 'Static 3D designer will still load.');
    ready = false;
    return false;
  }
  try {
    await getPool().query(SCHEMA);
    ready = true;
    console.log('[db] connected and schema ready');
    return true;
  } catch (err) {
    ready = false;
    console.error('[db] connection failed:', err.message);
    console.error('[db] auth & projects disabled until the database is reachable.');
    return false;
  }
}

module.exports = { init, query, getPool, isReady };
