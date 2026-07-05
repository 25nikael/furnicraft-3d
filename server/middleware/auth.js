'use strict';

const { verify } = require('../utils/jwt');
const db = require('../db');

/**
 * Express middleware: require a valid Bearer token.
 * On success, attaches req.user = { id, email }.
 *
 * Beyond verifying the JWT this also re-checks the account against the DB on
 * every request, so a token issued before an admin disabled (or deleted) the
 * account stops working immediately instead of lingering until it expires.
 * If the DB is momentarily down we skip that check (routes that need the DB
 * 503 via their own guard anyway) so static/auth-gated behaviour still works.
 */
async function requireAuth(req, res, next) {
  if (!db.isReady()) {
    return res.status(503).json({ error: 'Database not available. Try again shortly.' });
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  const payload = verify(token);
  if (!payload) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
  try {
    const result = await db.query('SELECT disabled FROM users WHERE id = $1', [payload.uid]);
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Account no longer exists.' });
    }
    if (result.rows[0].disabled) {
      return res.status(403).json({ error: 'This account has been disabled. Contact support if you believe this is a mistake.' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Could not verify your account. Try again shortly.' });
  }
  req.user = { id: payload.uid, email: payload.email };
  next();
}

module.exports = { requireAuth };
