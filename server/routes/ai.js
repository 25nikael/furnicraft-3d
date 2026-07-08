'use strict';
const express = require('express');
const router = express.Router();

const AI_SYSTEM_PROMPT = `You are an expert furniture designer and cabinet maker. Output ONLY a valid JSON object — no markdown fences, no explanation, just raw JSON.

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

// Single Claude call that returns a validated design-JSON string.
// `userContent` may be a plain string or an array of content blocks (for vision).
// Haiku is used deliberately — it is vision-capable and fast enough to stay under
// Render's 30s request timeout, which past iterations proved Sonnet/Opus exceed.
// Returns { jsonText } on success or { status, error } on failure.
async function requestDesignJSON(apiKey, userContent) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 6000,
      system: AI_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }]
    })
  });

  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    return { status: resp.status, error: e.error ? e.error.message : `API error ${resp.status}` };
  }

  const data = await resp.json();
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) return { status: 500, error: 'No design content returned. Please try again.' };

  const jsonText = extractJSON(textBlock.text);
  try {
    JSON.parse(jsonText);
  } catch (_) {
    return { status: 500, error: 'Design generation returned invalid JSON. Please try again.' };
  }
  return { jsonText };
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
    const out = await requestDesignJSON(apiKey, userContent);
    if (out.error) return res.status(out.status).json({ error: out.error });
    res.json({ text: out.jsonText });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Design from a photo (vision) ────────────────────────────────────────
// Accepts a base64 image data URL, asks Claude to reproduce the furniture in
// the photo as a buildable design in the same JSON format as /design.
router.post('/from-image', async (req, res) => {
  const { image, prompt, currentDesign } = req.body || {};
  if (!image || typeof image !== 'string') return res.status(400).json({ error: 'An image is required.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured on this server. Ask the admin to set ANTHROPIC_API_KEY.' });

  // Parse a data URL: data:image/<type>;base64,<data>
  const m = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(image.trim());
  if (!m) return res.status(400).json({ error: 'Unsupported image. Please use a PNG, JPEG, WebP or GIF photo.' });
  const mediaType = m[1] === 'image/jpg' ? 'image/jpeg' : m[1];
  const b64 = m[2];
  // Guard against oversized payloads (decoded bytes ≈ base64 length × 3/4).
  if (b64.length * 0.75 > 4 * 1024 * 1024) {
    return res.status(413).json({ error: 'That image is too large. Please use a smaller or lower-resolution photo.' });
  }

  const note = prompt && prompt.trim() ? `\n\nExtra notes from the user: ${prompt.trim()}` : '';
  const ctx = (currentDesign && Array.isArray(currentDesign.panels) && currentDesign.panels.length > 0)
    ? `\n\nFor reference only, the user's canvas currently contains: ${JSON.stringify(currentDesign)}. Ignore it unless the notes ask you to combine.`
    : '';

  const instruction =
    `The image shows a piece of furniture. Study its overall form, proportions, and structure — count the shelves, drawers, doors, legs and panels, and note the apparent material and style. ` +
    `Reproduce it as a buildable design using the coordinate system, construction rules and material keys defined above. ` +
    `Estimate real-world dimensions in millimetres from the photo, assuming typical furniture sizes where the scale is unclear. ` +
    `Include a short "name", a one-line "description", and "assembly_notes". Output ONLY the raw JSON design object.` + note + ctx;

  const userContent = [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
    { type: 'text', text: instruction }
  ];

  try {
    const out = await requestDesignJSON(apiKey, userContent);
    if (out.error) return res.status(out.status).json({ error: out.error });
    res.json({ text: out.jsonText });
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
