'use strict';

// Public, unauthenticated read-only access: shared designs + gallery (H3, H4)

const express = require('express');
const db = require('../db');

const router = express.Router();

router.use(function (req, res, next) {
  if (!db.isReady()) return res.status(503).json({ error: 'Database not available. Try again shortly.' });
  next();
});

// List opt-in public designs (newest first)
router.get('/gallery', async (req, res) => {
  try {
    const r = await db.query(
      'SELECT id, name, thumb, share_token FROM projects WHERE is_public = TRUE ORDER BY updated_at DESC LIMIT 60'
    );
    res.json({ projects: r.rows.map(function (x) { return { id: x.id, name: x.name, thumb: x.thumb || null, token: x.share_token }; }) });
  } catch (err) {
    console.error('[public/gallery]', err);
    res.status(500).json({ error: 'Could not load gallery.' });
  }
});

// View a shared design by its token (read-only). Defined after /gallery so it doesn't shadow it.
router.get('/:token', async (req, res) => {
  try {
    const r = await db.query('SELECT name, state FROM projects WHERE share_token = $1', [req.params.token]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Shared design not found.' });
    res.json({ name: r.rows[0].name, state: r.rows[0].state });
  } catch (err) {
    console.error('[public/view]', err);
    res.status(500).json({ error: 'Could not load shared design.' });
  }
});

module.exports = router;
