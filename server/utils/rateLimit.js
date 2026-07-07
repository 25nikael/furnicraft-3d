'use strict';

/**
 * In-memory sliding-window rate limiting.
 *
 * Two facilities:
 *   1. rateLimit(name, max, windowMs) — Express middleware keyed on
 *      `req.ip + ':' + name`. Rejects with 429 once a key exceeds `max` hits
 *      inside the trailing `windowMs`.
 *   2. emailSendAllowed(email) — a per-email send cap (5 sends/hour/email)
 *      used to throttle outbound OTP emails independently of request rate.
 *
 * Both are process-local. On a single Render web service that is sufficient;
 * a multi-instance deployment would need a shared store (Redis) instead.
 * Memory is kept bounded by pruning timestamps outside the window on every
 * hit and dropping keys once their window is empty.
 */

// key -> number[] of hit timestamps (ms), oldest first
const hits = new Map();

/**
 * Record a hit for `key` and report whether it is within `max` per `windowMs`.
 * Prunes expired timestamps for the key so the array never grows unbounded.
 * @returns {boolean} true if allowed, false if the limit is exceeded.
 */
function allow(key, max, windowMs) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const arr = hits.get(key) || [];
  // Drop timestamps that have aged out of the window.
  let i = 0;
  while (i < arr.length && arr[i] <= cutoff) i++;
  const recent = i > 0 ? arr.slice(i) : arr;

  if (recent.length >= max) {
    // Still over the limit — keep the pruned array so it can decay, but do not
    // record this attempt (otherwise a flood could never recover).
    if (recent.length === 0) hits.delete(key);
    else hits.set(key, recent);
    return false;
  }

  recent.push(now);
  hits.set(key, recent);
  return true;
}

/**
 * Express middleware factory: sliding-window limiter keyed on client IP + name.
 * @param {string} name    logical bucket name (keeps different routes separate)
 * @param {number} max     max hits allowed per window
 * @param {number} windowMs  window length in ms
 */
function rateLimit(name, max, windowMs) {
  return function rateLimitMiddleware(req, res, next) {
    const key = (req.ip || 'unknown') + ':' + name;
    if (!allow(key, max, windowMs)) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    next();
  };
}

const EMAIL_SEND_MAX = 5;
const EMAIL_SEND_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Per-email outbound send cap: max 5 OTP emails per hour per address.
 * Callers check this before generating/sending a code; when it returns false
 * they should skip the send but still return their normal (generic) response
 * so account existence is not leaked.
 * @param {string} email  normalized (lowercased) recipient address
 * @returns {boolean} true if a send is allowed and has been counted.
 */
function emailSendAllowed(email) {
  return allow('email-send:' + String(email || '').toLowerCase(), EMAIL_SEND_MAX, EMAIL_SEND_WINDOW_MS);
}

module.exports = { rateLimit, emailSendAllowed };
