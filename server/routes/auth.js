'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');

const db = require('../db');
const { sign } = require('../utils/jwt');
const { sendOTP } = require('../utils/email');
const { requireAuth } = require('../middleware/auth');
// Single source of truth for admin identity lives in the admin route module.
// admin.js only requires ../db and ../middleware/auth (not this file), so this
// require does not create a cycle.
const { ADMIN_EMAIL } = require('./admin');

const router = express.Router();

const OTP_TTL_MIN = 10;
const googleClient = process.env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;

function dbGuard(req, res, next) {
  if (!db.isReady()) {
    return res.status(503).json({ error: 'Database not available. Try again shortly.' });
  }
  next();
}

function publicUser(row) {
  return { id: row.id, email: row.email, name: row.name || '', isAdmin: row.email === ADMIN_EMAIL };
}

function isEmail(s) {
  return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

// ── Public config: tells the frontend which auth methods are available ──
router.get('/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    dbReady: db.isReady()
  });
});

// ── Step 1 of registration: validate + send OTP ─────────────────────────
router.post('/register', dbGuard, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) return res.status(409).json({ error: 'That email is already registered.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);

    // Replace any prior pending codes for this email
    await db.query('DELETE FROM otp_codes WHERE email = $1', [email]);
    await db.query(
      'INSERT INTO otp_codes (email, code, password_hash, expires_at) VALUES ($1, $2, $3, $4)',
      [email, code, passwordHash, expires]
    );

    const { devMode } = await sendOTP(email, code);
    // In dev mode (no SMTP), return the code so the UI can display it.
    res.json({ ok: true, devMode, devCode: devMode ? code : undefined });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Could not start registration.' });
  }
});

// ── Step 2 of registration: verify OTP + create the account ─────────────
router.post('/verify', dbGuard, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    if (!isEmail(email) || !code) return res.status(400).json({ error: 'Missing email or code.' });

    const row = await db.query(
      `SELECT * FROM otp_codes
       WHERE email = $1 AND code = $2 AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    );
    if (row.rowCount === 0) return res.status(400).json({ error: 'Incorrect or expired code.' });

    // Guard against a race where the account was created already
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) {
      await db.query('DELETE FROM otp_codes WHERE email = $1', [email]);
      return res.status(409).json({ error: 'That email is already registered.' });
    }

    const inserted = await db.query(
      `INSERT INTO users (email, password_hash, verified)
       VALUES ($1, $2, TRUE) RETURNING *`,
      [email, row.rows[0].password_hash]
    );
    await db.query('DELETE FROM otp_codes WHERE email = $1', [email]);

    const user = inserted.rows[0];
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (err) {
    console.error('[auth/verify]', err);
    res.status(500).json({ error: 'Could not verify account.' });
  }
});

// ── Login with email + password ─────────────────────────────────────────
router.post('/login', dbGuard, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Enter your email and password.' });

    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rowCount === 0) return res.status(401).json({ error: 'No account found for that email.' });

    const user = result.rows[0];
    if (!user.password_hash) {
      return res.status(401).json({ error: 'This account uses Google Sign-In. Use the Google button.' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect password.' });

    res.json({ token: sign(user), user: publicUser(user) });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Could not sign in.' });
  }
});

// ── Google Sign-In: verify the ID token server-side ─────────────────────
router.post('/google', dbGuard, async (req, res) => {
  try {
    if (!googleClient) return res.status(400).json({ error: 'Google Sign-In is not configured on the server.' });
    const credential = String(req.body.credential || '');
    if (!credential) return res.status(400).json({ error: 'Missing Google credential.' });

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) return res.status(401).json({ error: 'Google verification failed.' });

    const email = payload.email.toLowerCase();
    let result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    let user;
    if (result.rowCount === 0) {
      const inserted = await db.query(
        `INSERT INTO users (email, google_id, name, verified)
         VALUES ($1, $2, $3, TRUE) RETURNING *`,
        [email, payload.sub, payload.name || '']
      );
      user = inserted.rows[0];
    } else {
      user = result.rows[0];
      // Backfill google_id if this email registered with a password first
      if (!user.google_id) {
        await db.query('UPDATE users SET google_id = $1 WHERE id = $2', [payload.sub, user.id]);
      }
    }
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (err) {
    console.error('[auth/google]', err);
    res.status(500).json({ error: 'Could not sign in with Google.' });
  }
});

// ── Current user (validates the stored token) ───────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (result.rowCount === 0) return res.status(401).json({ error: 'Account no longer exists.' });
    res.json({ user: publicUser(result.rows[0]) });
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Could not load account.' });
  }
});

module.exports = router;
