'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const db = require('./db');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const publicRoutes = require('./routes/public');
const aiRoutes = require('./routes/ai');
const adminRoutes = require('./routes/admin');
const flagsRoutes = require('./routes/flags');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' })); // project state can be large

// ── API routes ──────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/flags', flagsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, dbReady: db.isReady() });
});

// ── Static frontend ─────────────────────────────────────────────────────
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// Explicit named pages
app.get('/landing', (req, res) => res.sendFile(path.join(publicDir, 'landing.html')));
app.get('/admin',   (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));

// SPA fallback for the main app
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ── Start ────────────────────────────────────────────────────────────────
(async function start() {
  await db.init(); // connects + ensures schema; non-fatal if DB unreachable
  app.listen(PORT, () => {
    console.log(`[server] FurniCraft 3D listening on http://localhost:${PORT}`);
  });
})();
