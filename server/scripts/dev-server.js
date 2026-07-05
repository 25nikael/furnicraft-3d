'use strict';

/**
 * DEV-ONLY entry point — runs FurniCraft 3D fully locally with an in-memory
 * Postgres (pg-mem), so register/login/projects/flags/admin all work without a
 * real database or any external services.
 *
 * How it works:
 *   1. Create a pg-mem database and build its pg-compatible adapter.
 *   2. Inject that adapter into Node's module cache under the `pg` module id,
 *      BEFORE anything requires `pg`. server/db.js then transparently talks to
 *      pg-mem instead of a real Postgres server.
 *   3. Set safe dev env defaults (JWT_SECRET, PORT, DATABASE_URL sentinel) —
 *      but never ANTHROPIC_API_KEY / GOOGLE_CLIENT_ID, so AI and Google Sign-In
 *      stay disabled exactly as in a bare local checkout.
 *   4. Require the UNMODIFIED server/index.js, which boots normally, runs the
 *      real SCHEMA against pg-mem, and starts listening.
 *   5. Seed an admin user and a normal tester user for UX testing.
 *
 * No production file is touched by this script. Run with:
 *   node server/scripts/dev-server.js
 */

const path = require('path');
const bcrypt = require('bcryptjs');
const { newDb } = require('pg-mem');

// ── 1. In-memory Postgres ────────────────────────────────────────────────
const mem = newDb();
const pgAdapter = mem.adapters.createPg(); // { Pool, Client } compatible with `pg`

// ── 2. Inject pg-mem in place of the real `pg` module ────────────────────
// Resolve the real `pg` id so db.js's `require('pg')` returns our adapter.
const pgId = require.resolve('pg');
const pgModule = require('module');
const fakePg = new pgModule.Module(pgId);
fakePg.filename = pgId;
fakePg.loaded = true;
fakePg.exports = pgAdapter;
require.cache[pgId] = fakePg;

// ── 3. Dev env defaults (only set if missing) ────────────────────────────
// DATABASE_URL just needs to be truthy so db.js takes the "connect" path;
// pg-mem ignores the connection string entirely.
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgres://pg-mem/furnicraft-dev';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'dev-secret-local-only';
if (!process.env.PORT) process.env.PORT = '3000';
// Intentionally NOT set: ANTHROPIC_API_KEY, GOOGLE_CLIENT_ID, SMTP_* — keep
// AI / Google / email in their disabled dev states.

// ── 4. Seed users once the schema is ready, then boot the real server ────
const ADMIN_EMAIL = '25nikael@gmail.com';
const ADMIN_PASSWORD = 'admin123';
const TESTER_EMAIL = 'tester@local.test';
const TESTER_PASSWORD = 'test1234';

async function seedUsers(db) {
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const testerHash = await bcrypt.hash(TESTER_PASSWORD, 10);
  // Insert only if absent so repeated boots on a persistent process stay clean.
  await db.query(
    `INSERT INTO users (email, password_hash, name, verified)
     SELECT $1, $2, $3, TRUE
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = $1)`,
    [ADMIN_EMAIL, adminHash, 'Admin']
  );
  await db.query(
    `INSERT INTO users (email, password_hash, name, verified)
     SELECT $1, $2, $3, TRUE
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = $1)`,
    [TESTER_EMAIL, testerHash, 'Tester']
  );
}

// Poll db.isReady() (index.js kicks off db.init() asynchronously) then seed.
async function seedWhenReady() {
  const db = require(path.join(__dirname, '..', 'db'));
  const deadline = Date.now() + 15000;
  while (!db.isReady()) {
    if (Date.now() > deadline) {
      console.error('[dev-server] DB never became ready — seeding skipped.');
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  try {
    await seedUsers(db);
    console.log('\n──────────────────────────────────────────────');
    console.log('[dev-server] pg-mem ready — seeded test accounts:');
    console.log(`  ADMIN : ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
    console.log(`  USER  : ${TESTER_EMAIL} / ${TESTER_PASSWORD}`);
    console.log('──────────────────────────────────────────────\n');
  } catch (err) {
    console.error('[dev-server] seeding failed:', err.message);
  }
}

console.log('[dev-server] Starting FurniCraft 3D with in-memory pg-mem Postgres…');
seedWhenReady(); // fire-and-forget; resolves once schema is up

// ── 5. Boot the real, unmodified server ──────────────────────────────────
require(path.join(__dirname, '..', 'index.js'));
