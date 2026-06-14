'use strict';

const jwt = require('jsonwebtoken');

function secret() {
  return process.env.JWT_SECRET || 'insecure-dev-secret-change-me';
}

/** Sign a session token for a user. */
function sign(user) {
  return jwt.sign(
    { uid: user.id, email: user.email },
    secret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
}

/** Verify a token, returning the decoded payload or null. */
function verify(token) {
  try {
    return jwt.verify(token, secret());
  } catch (e) {
    return null;
  }
}

module.exports = { sign, verify };
