'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const ADMIN_EMAIL = '25nikael@gmail.com';

function requireAdmin(req, res, next) {
  if (req.user.email !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Admin access only.' });
  }
  next();
}

// All admin routes require auth + admin email
router.use(requireAuth, requireAdmin);

// ── Users ────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, name, verified, disabled, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/users/:id', async (req, res) => {
  const { disabled } = req.body;
  if (typeof disabled !== 'boolean') return res.status(400).json({ error: 'disabled (boolean) required' });
  try {
    const result = await db.query(
      'UPDATE users SET disabled = $1 WHERE id = $2 RETURNING id, email, disabled',
      [disabled, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Feature flags ────────────────────────────────────────
router.get('/flags', async (req, res) => {
  try {
    const result = await db.query('SELECT key, label, enabled, updated_at FROM feature_flags ORDER BY key');
    res.json({ flags: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/flags/:key', async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) required' });
  try {
    const result = await db.query(
      `UPDATE feature_flags SET enabled = $1, updated_at = NOW() WHERE key = $2
       RETURNING key, label, enabled`,
      [enabled, req.params.key]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Flag not found.' });
    res.json({ flag: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
