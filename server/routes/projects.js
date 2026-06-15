'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// All project routes require a valid session
router.use(requireAuth);

// Record a version snapshot, keeping only the latest 20 per project (H2)
async function recordVersion(projectId, state) {
  try {
    await db.query('INSERT INTO project_versions (project_id, state) VALUES ($1, $2)', [projectId, state]);
    await db.query(
      'DELETE FROM project_versions WHERE project_id = $1 AND id NOT IN ' +
      '(SELECT id FROM project_versions WHERE project_id = $1 ORDER BY created_at DESC LIMIT 20)',
      [projectId]
    );
  } catch (e) { console.error('[versions/record]', e.message); }
}

function meta(row) {
  return {
    id: row.id,
    name: row.name,
    thumb: row.thumb || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ── List the current user's projects (metadata + thumbnail) ─────────────
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, thumb, created_at, updated_at FROM projects WHERE user_id = $1 ORDER BY updated_at DESC',
      [req.user.id]
    );
    res.json({ projects: result.rows.map(meta) });
  } catch (err) {
    console.error('[projects/list]', err);
    res.status(500).json({ error: 'Could not load projects.' });
  }
});

// ── Get one project including its full saved state ──────────────────────
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Project not found.' });
    const row = result.rows[0];
    res.json({ project: { ...meta(row), state: row.state } });
  } catch (err) {
    console.error('[projects/get]', err);
    res.status(500).json({ error: 'Could not load project.' });
  }
});

// ── Create a new project ────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const state = req.body.state;
    if (!name) return res.status(400).json({ error: 'Project name is required.' });
    if (!state || typeof state !== 'object') return res.status(400).json({ error: 'Invalid project data.' });

    const thumb = typeof req.body.thumb === 'string' ? req.body.thumb : null;
    const result = await db.query(
      'INSERT INTO projects (user_id, name, state, thumb) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, name, state, thumb]
    );
    await recordVersion(result.rows[0].id, state);
    res.status(201).json({ project: meta(result.rows[0]) });
  } catch (err) {
    console.error('[projects/create]', err);
    res.status(500).json({ error: 'Could not save project.' });
  }
});

// ── Update name and/or state of an existing project ─────────────────────
router.put('/:id', async (req, res) => {
  try {
    // Verify ownership first
    const owned = await db.query(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (owned.rowCount === 0) return res.status(404).json({ error: 'Project not found.' });

    const sets = [];
    const vals = [];
    let i = 1;
    if (typeof req.body.name === 'string' && req.body.name.trim()) {
      sets.push(`name = $${i++}`); vals.push(req.body.name.trim());
    }
    if (req.body.state && typeof req.body.state === 'object') {
      sets.push(`state = $${i++}`); vals.push(req.body.state);
    }
    if (typeof req.body.thumb === 'string') {
      sets.push(`thumb = $${i++}`); vals.push(req.body.thumb);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
    sets.push('updated_at = NOW()');
    vals.push(req.params.id, req.user.id);

    const result = await db.query(
      `UPDATE projects SET ${sets.join(', ')} WHERE id = $${i++} AND user_id = $${i} RETURNING *`,
      vals
    );
    if (req.body.state && typeof req.body.state === 'object') await recordVersion(req.params.id, req.body.state);
    res.json({ project: meta(result.rows[0]) });
  } catch (err) {
    console.error('[projects/update]', err);
    res.status(500).json({ error: 'Could not update project.' });
  }
});

// ── Delete a project ────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Project not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[projects/delete]', err);
    res.status(500).json({ error: 'Could not delete project.' });
  }
});

// ── Version history (H2) ────────────────────────────────────────────────
router.get('/:id/versions', async (req, res) => {
  try {
    const owned = await db.query('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (owned.rowCount === 0) return res.status(404).json({ error: 'Project not found.' });
    const r = await db.query('SELECT id, created_at FROM project_versions WHERE project_id = $1 ORDER BY created_at DESC', [req.params.id]);
    res.json({ versions: r.rows.map(function (v) { return { id: v.id, createdAt: v.created_at }; }) });
  } catch (err) {
    console.error('[versions/list]', err);
    res.status(500).json({ error: 'Could not load versions.' });
  }
});

router.post('/:id/versions/:vid/restore', async (req, res) => {
  try {
    const owned = await db.query('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (owned.rowCount === 0) return res.status(404).json({ error: 'Project not found.' });
    const v = await db.query('SELECT state FROM project_versions WHERE id = $1 AND project_id = $2', [req.params.vid, req.params.id]);
    if (v.rowCount === 0) return res.status(404).json({ error: 'Version not found.' });
    await db.query('UPDATE projects SET state = $1, updated_at = NOW() WHERE id = $2', [v.rows[0].state, req.params.id]);
    res.json({ state: v.rows[0].state });
  } catch (err) {
    console.error('[versions/restore]', err);
    res.status(500).json({ error: 'Could not restore version.' });
  }
});

module.exports = router;
