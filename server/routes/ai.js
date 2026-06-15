'use strict';
const express = require('express');
const router = express.Router();

const AI_SYSTEM_PROMPT = `You are an expert furniture designer and cabinet maker.

BEFORE OUTPUTTING: Mentally compare this design against 10 real-world examples of the same furniture type. Verify that every structural element present in those examples is included. Common omissions to check: back panel, top/bottom panels, all 5 drawer box panels per drawer, 2 hardware slides per drawer, legs/stretchers on tables, mounting rail on wall-hung units, door panels.

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
6. DRAWERS — each drawer is a group of 5 panels + 2 hardware slides:
   - Variables: T=18 (thickness), clr=12.5 (slide clearance each side)
   - Drawer opening height dh = available_inner_height / number_of_drawers
   - boxW = cabinet_width - 2*T - 2*clr  (box outer width, inside the slides)
   - boxH = dh - 24  (box height, leave gap top/bottom)
   - boxD = cabinet_depth - 40  (box depth, clear of back)
   - cz = 0  (box centred in depth; front face will protrude forward)
   - yc = bottom_of_opening + dh*(i+0.5)  (vertical centre of this drawer slot)
   - groupKey "_g": use a unique string per drawer e.g. "d0", "d1" — ALL 5 panels of one drawer share the same _g value
   - "_gname": human label e.g. "Drawer 1"
   - Panel list for drawer i:
     a) Drawer Front: w=cabinet_width-2*T-4, h=dh-6, d=T, x=0, y=yc, z=cabinet_depth/2-T/2
        Add "func":{"kind":"drawer","travel":cabinet_depth-30,"slide":"sidemount","clearance":12.5,"open":false}
     b) Left side:    w=T, h=boxH, d=boxD, x=-(boxW/2-T/2), y=yc, z=cz
     c) Right side:   w=T, h=boxH, d=boxD, x=+(boxW/2-T/2), y=yc, z=cz
     d) Back:         w=boxW-2*T, h=boxH, d=T, x=0, y=yc, z=cz-boxD/2+T/2
     e) Bottom:       w=boxW-2*T, h=T, d=boxD-2*T, x=0, y=yc-boxH/2+T/2, z=cz
   - Hardware slides (2 per drawer) — add to the "hardware" array:
     { "type":"slide", "x": +(boxW/2+clr/2), "y": yc, "z": cz, "params":{"length":boxD,"height":45} }
     { "type":"slide", "x": -(boxW/2+clr/2), "y": yc, "z": cz, "params":{"length":boxD,"height":45} }
7. Doors: single panel per door opening, d=18, z = depth/2 + 9 (proud of cabinet)
8. Wall-mounted units MUST include a mounting rail: h=75, d=18, positioned at back-top inside cabinet
9. For desks with legs: use 4 leg panels, w=50, d=50, h=leg_height, positioned at corners
10. French cleats for wall mounting: two panels per cleat set (wall piece + cabinet piece)

MATERIALS — use ONLY these exact keys: oak, walnut, pine, maple, cherry, birch, white, black, grey, metal, glass
- Structural carcass: oak / birch / pine / white
- Visible faces / doors / drawer fronts: oak / walnut / cherry / maple
- Drawer box internals, back panels: birch
- Painted/modern look: white or black
- MDF painted: grey
- Steel frame / legs: metal
- Display shelves / inserts: glass`;

// Extract the first valid JSON object from a string that may contain prose
function extractJSON(text) {
  const s = text.trim();
  const stripped = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  if (stripped.startsWith('{')) return stripped;
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start !== -1 && end > start) return s.slice(start, end + 1);
  return stripped;
}

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
      `If the instruction describes an entirely new piece, return a fresh design.`;
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 6000,
        thinking: { type: 'adaptive' },
        system: AI_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      return res.status(resp.status).json({ error: e.error ? e.error.message : `API error ${resp.status}` });
    }

    const data = await resp.json();
    const textBlock = data.content.find(b => b.type === 'text');
    if (!textBlock) return res.status(500).json({ error: 'No design content returned. Please try again.' });

    const jsonText = extractJSON(textBlock.text);
    try {
      JSON.parse(jsonText);
    } catch (_) {
      return res.status(500).json({ error: 'Design generation returned invalid JSON. Please try again.' });
    }

    res.json({ text: jsonText });
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
