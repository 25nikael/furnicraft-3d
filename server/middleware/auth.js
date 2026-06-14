'use strict';

const { verify } = require('../utils/jwt');
const db = require('../db');

/**
 * Express middleware: require a valid Bearer token.
 * On success, attaches req.user = { id, email }.
 */
function requireAuth(req, res, next) {
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
  req.user = { id: payload.uid, email: payload.email };
  next();
}

module.exports = { requireAuth };
