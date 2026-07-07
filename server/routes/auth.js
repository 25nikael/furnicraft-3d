'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');

const db = require('../db');
const { sign } = require('../utils/jwt');
const { sendOTP, smtpConfigured } = require('../utils/email');
const { rateLimit, emailSendAllowed } = require('../utils/rateLimit');
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

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const DISABLED_MSG = 'This account has been disabled. Contact support if you believe this is a mistake.';

// Rate-limit windows (in-memory, per client IP). Tighter caps on flows that
// send email or create accounts; looser on interactive verify/login attempts.
const WINDOW_MS = 15 * 60 * 1000;
const limitVerify = rateLimit('verify', 10, WINDOW_MS);   // /login /verify /reset /login-code/verify
const limitSend = rateLimit('send', 5, WINDOW_MS);        // /register /forgot /login-code/request

// ── Public config: tells the frontend which auth methods are available ──
router.get('/config', (req, res) => {
  // Gating logic (evaluated per request so env changes take effect on restart):
  //   emailAuth         — forgot/reset offered (dev fallback OK outside prod)
  //   passwordlessLogin — email sign-in offered (ONLY with real SMTP, never dev)
  //   emailAuthDev      — dev may display codes for register/reset (never in prod)
  const isProd = process.env.NODE_ENV === 'production';
  const smtp = smtpConfigured();
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    dbReady: db.isReady(),
    emailAuth: smtp || !isProd,
    passwordlessLogin: smtp,
    emailAuthDev: !smtp && !isProd
  });
});

// ── Step 1 of registration: validate + send OTP ─────────────────────────
router.post('/register', dbGuard, limitSend, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) return res.status(409).json({ error: 'That email is already registered.' });

    // Per-email send cap (independent of the per-IP window) throttles OTP spam.
    if (!emailSendAllowed(email)) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const code = genCode();
    const expires = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);

    // Replace any prior pending registration codes for this email (scoped by
    // purpose so a concurrent reset/login code is not clobbered).
    await db.query("DELETE FROM otp_codes WHERE email = $1 AND purpose = 'register'", [email]);
    await db.query(
      "INSERT INTO otp_codes (email, code, password_hash, purpose, expires_at) VALUES ($1, $2, $3, 'register', $4)",
      [email, code, passwordHash, expires]
    );

    const { devMode } = await sendOTP(email, code, 'register');
    // In dev mode (no SMTP), return the code so the UI can display it.
    res.json({ ok: true, devMode, devCode: devMode ? code : undefined });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Could not start registration.' });
  }
});

// ── Step 2 of registration: verify OTP + create the account ─────────────
router.post('/verify', dbGuard, limitVerify, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    if (!isEmail(email) || !code) return res.status(400).json({ error: 'Missing email or code.' });

    const row = await db.query(
      `SELECT * FROM otp_codes
       WHERE email = $1 AND code = $2 AND purpose = 'register' AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    );
    if (row.rowCount === 0) return res.status(400).json({ error: 'Incorrect or expired code.' });

    // Guard against a race where the account was created already
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) {
      await db.query("DELETE FROM otp_codes WHERE email = $1 AND purpose = 'register'", [email]);
      return res.status(409).json({ error: 'That email is already registered.' });
    }

    const inserted = await db.query(
      `INSERT INTO users (email, password_hash, verified)
       VALUES ($1, $2, TRUE) RETURNING *`,
      [email, row.rows[0].password_hash]
    );
    await db.query("DELETE FROM otp_codes WHERE email = $1 AND purpose = 'register'", [email]);

    const user = inserted.rows[0];
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (err) {
    console.error('[auth/verify]', err);
    res.status(500).json({ error: 'Could not verify account.' });
  }
});

// ── Login with email + password ─────────────────────────────────────────
router.post('/login', dbGuard, limitVerify, async (req, res) => {
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
    // Disabled accounts cannot sign in (admin can toggle users.disabled).
    if (user.disabled) {
      return res.status(403).json({ error: 'This account has been disabled. Contact support if you believe this is a mistake.' });
    }

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
      // Disabled accounts cannot sign in, even via Google.
      if (user.disabled) {
        return res.status(403).json({ error: 'This account has been disabled. Contact support if you believe this is a mistake.' });
      }
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
    // requireAuth already rejected missing/disabled accounts (401/403) before we
    // get here, so any row we load belongs to an active, enabled user.
    const result = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (result.rowCount === 0) return res.status(401).json({ error: 'Account no longer exists.' });
    res.json({ user: publicUser(result.rows[0]) });
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Could not load account.' });
  }
});

// ── Forgot password: request a reset code ───────────────────────────────
// Always returns a generic 200 so an attacker cannot probe which emails exist.
// A code is only created/sent for an existing, enabled, password-based account.
router.post('/forgot', dbGuard, limitSend, async (req, res) => {
  const generic = { ok: true };
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!isEmail(email)) return res.json(generic);

    const emailAuthDev = !smtpConfigured() && process.env.NODE_ENV !== 'production';
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (user && user.password_hash && !user.disabled && emailSendAllowed(email)) {
      const code = genCode();
      const expires = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);
      await db.query("DELETE FROM otp_codes WHERE email = $1 AND purpose = 'reset'", [email]);
      await db.query(
        "INSERT INTO otp_codes (email, code, purpose, expires_at) VALUES ($1, $2, 'reset', $3)",
        [email, code, expires]
      );
      const { devMode } = await sendOTP(email, code, 'reset');
      // devCode is exposed ONLY when emailAuthDev — which is never true in
      // production — so real users never receive a code in the response. In dev
      // its presence reveals account existence, acceptable for local testing.
      if (devMode && emailAuthDev) return res.json({ ok: true, devMode: true, devCode: code });
    }
    return res.json(generic);
  } catch (err) {
    console.error('[auth/forgot]', err);
    return res.json(generic);
  }
});

// ── Reset password: verify code + set a new password (signs the user in) ─
router.post('/reset', dbGuard, limitVerify, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const password = String(req.body.password || '');
    if (!isEmail(email) || !code) return res.status(400).json({ error: 'Missing email or code.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const row = await db.query(
      `SELECT * FROM otp_codes
       WHERE email = $1 AND code = $2 AND purpose = 'reset' AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    );
    if (row.rowCount === 0) return res.status(400).json({ error: 'That code is incorrect or has expired.' });

    const ures = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (ures.rowCount === 0) return res.status(400).json({ error: 'That code is incorrect or has expired.' });
    const user = ures.rows[0];
    if (user.disabled) return res.status(403).json({ error: DISABLED_MSG });

    const passwordHash = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, user.id]);
    await db.query("DELETE FROM otp_codes WHERE email = $1 AND purpose = 'reset'", [email]);

    const fresh = (await db.query('SELECT * FROM users WHERE id = $1', [user.id])).rows[0];
    res.json({ token: sign(fresh), user: publicUser(fresh) });
  } catch (err) {
    console.error('[auth/reset]', err);
    res.status(500).json({ error: 'Could not reset password.' });
  }
});

// ── Passwordless sign-in: request an email code ─────────────────────────
// SECURITY INVARIANT: with no SMTP this returns 503 and NEVER a code, in any
// environment. The frontend hides this method unless config.passwordlessLogin.
router.post('/login-code/request', dbGuard, limitSend, async (req, res) => {
  try {
    if (!smtpConfigured()) {
      return res.status(503).json({ error: 'Email sign-in is not available on this server.' });
    }
    const email = String(req.body.email || '').trim().toLowerCase();
    if (isEmail(email)) {
      const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
      const user = result.rows[0];
      if (user && !user.disabled && emailSendAllowed(email)) {
        const code = genCode();
        const expires = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);
        await db.query("DELETE FROM otp_codes WHERE email = $1 AND purpose = 'login'", [email]);
        await db.query(
          "INSERT INTO otp_codes (email, code, purpose, expires_at) VALUES ($1, $2, 'login', $3)",
          [email, code, expires]
        );
        await sendOTP(email, code, 'login'); // emailed only — never in the response
      }
    }
    res.json({ ok: true }); // generic regardless of account existence
  } catch (err) {
    console.error('[auth/login-code/request]', err);
    res.json({ ok: true });
  }
});

// ── Passwordless sign-in: verify the email code ─────────────────────────
router.post('/login-code/verify', dbGuard, limitVerify, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    if (!isEmail(email) || !code) return res.status(400).json({ error: 'Missing email or code.' });

    const row = await db.query(
      `SELECT * FROM otp_codes
       WHERE email = $1 AND code = $2 AND purpose = 'login' AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    );
    if (row.rowCount === 0) return res.status(400).json({ error: 'That code is incorrect or has expired.' });

    const ures = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (ures.rowCount === 0) return res.status(400).json({ error: 'That code is incorrect or has expired.' });
    const user = ures.rows[0];
    if (user.disabled) return res.status(403).json({ error: DISABLED_MSG });

    await db.query("DELETE FROM otp_codes WHERE email = $1 AND purpose = 'login'", [email]);
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (err) {
    console.error('[auth/login-code/verify]', err);
    res.status(500).json({ error: 'Could not sign in.' });
  }
});

module.exports = router;
