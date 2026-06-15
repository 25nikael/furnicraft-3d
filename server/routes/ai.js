'use strict';
const express = require('express');
const router = express.Router();

const AI_SYSTEM_PROMPT = `You are an expert furniture designer and cabinet maker. When given a furniture description, output ONLY a valid JSON object — no markdown fences, no explanation, just raw JSON.

COORDINATE SYSTEM (all values in mm):
- X axis: left = negative, right = positive. Horizontal centre of design = 0
- Y axis: floor = 0, upward = positive. Panel y = vertical centre of panel
- Z axis: back = negative, front = positive. Depth centre of design = 0
- Panel position (x,y,z) is the CENTRE point of the panel

WOODWORKING CONSTRUCTION RULES:
1. Structural panels (sides, tops, bottoms, shelves): 18mm thick
2. Back panels: 12mm thick, recessed 6mm from back face (z = -(depth/2 - 6))
3. Side panels span FULL height: h = total_height, x = ±(total_width/2 - 9)
4. Top & bottom panels fit BETWEEN sides: w = total_width - 36
   - Bottom: y = 9 (sits on floor), Top: y = total_height - 9
5. Shelves fit between sides: w = total_width - 36, d = depth - 12 (clear of back)
6. Drawers: front panel only (face frame), positioned flush with cabinet front
7. Doors: single panel per door opening, d=18, z = depth/2 + 9 (proud of cabinet)
8. Wall-mounted units MUST include a mounting rail: h=75, d=18, positioned at back-top inside cabinet
9. For desks with legs: use 4 leg panels, w=50, d=50, h=leg_height, positioned at corners
10. French cleats for wall mounting: two panels per cleat set (wall piece + cabinet piece)

MATERIALS — use ONLY these exact keys: oak, walnut, pine, maple, cherry, birch, white, black, grey, metal, glass
- Structural carcass: oak / birch / pine / white
- Visible faces / doors: oak / walnut / cherry / maple
- Back panels: birch
- Painted/modern look: white or black
- MDF painted: grey
- Steel frame / legs: metal
- Display shelves / inserts: glass

OUTPUT JSON FORMAT:
{
  "name": "Furniture Name",
  "description": "One sentence design summary",
  "assembly_notes": "Brief ordered assembly steps",
  "panels": [
    {
      "name": "Left Side",
      "w": 18,
      "h": 800,
      "d": 400,
      "x": -241,
      "y": 400,
      "z": 0,
      "material": "oak"
    }
  ]
}

Always include ALL structural panels needed to build the piece. Ensure panels touch correctly at joints. Minimise off-cuts by using standard sheet sizes where possible.`;

router.post('/design', async (req, res) => {
  const { prompt, currentDesign } = req.body || {};
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured on this server. Ask the admin to set ANTHROPIC_API_KEY.' });

  let userContent = prompt.trim();
  if (currentDesign && Array.isArray(currentDesign.panels) && currentDesign.panels.length > 0) {
    userContent =
      `Current design JSON:\n${JSON.stringify(currentDesign)}\n\n` +
      `User instruction: ${prompt.trim()}\n\n` +
      `If the instruction modifies the existing piece, return the COMPLETE updated design. ` +
      `If the instruction describes an entirely new piece, return a fresh design. ` +
      `Respond with ONLY the JSON object.`;
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: AI_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }]
      })
    });
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      return res.status(resp.status).json({ error: e.error ? e.error.message : `API error ${resp.status}` });
    }
    const data = await resp.json();
    res.json({ text: data.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/advise', async (req, res) => {
  const { kind, currentDesign } = req.body || {};
  if (!currentDesign) return res.status(400).json({ error: 'currentDesign required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured on this server.' });

  const ask = kind === 'joinery'
    ? 'Suggest appropriate joinery and hardware for this furniture design. Be specific and concise — short bullet points.'
    : 'Suggest ways to reduce material waste and cost for this design, plus any sensible material substitutions. Concise bullet points.';

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: `Design JSON:\n${JSON.stringify(currentDesign)}\n\n${ask}` }]
      })
    });
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      return res.status(resp.status).json({ error: e.error ? e.error.message : `API error ${resp.status}` });
    }
    const data = await resp.json();
    res.json({ text: data.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
