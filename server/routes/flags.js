'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');

// Public endpoint — returns all feature flags so the frontend can gate features
router.get('/', async (req, res) => {
  if (!db.isReady()) return res.json({ flags: {} });
  try {
    const result = await db.query('SELECT key, enabled FROM feature_flags');
    const flags = {};
    result.rows.forEach(r => { flags[r.key] = r.enabled; });
    res.json({ flags });
  } catch (err) {
    // Fail open — if DB error, treat all flags as enabled
    res.json({ flags: {} });
  }
});

module.exports = router;
