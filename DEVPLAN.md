# FurniCraft 3D — Development Plan: Hardware, Functional Components & Joinery

Three selected features, built in dependency order across uniform work blocks.

## Features
- **B1** — Placeable hardware catalog (hinges, drawer slides, handles, knobs, shelf pins, legs, cleats)
- **B2** — Functional doors & drawers (open/close animation, auto slide-clearance)
- **A1** — Expanded joint types (dado, rabbet, groove, finger/box, dovetail, dowel, pocket-hole) with 3D representation

## Working cadence
- **One block per 5-hour usage window.** Each block is sized to fit comfortably in one window so token usage stays uniform.
- Every block ends at a stable, testable checkpoint **and a git commit** — that commit is the resume point.
- **To resume after a reset:** `git pull`, open this file, find the first ⬜ block, continue.
- Status: ⬜ todo · 🔄 in progress · ✅ done

## Shared data-model decisions (locked in Block 1)
- **Hardware** lives in a new `hardware[]` array with `nextHwId`, parallel to `panels[]`.
  - Shape: `{ id, type, name, x, y, z, rx, ry, rz, params{}, material, attachedTo }`
  - Rendered by a **procedural geometry factory** — no external 3D assets, keeping the app self-contained and fast to load.
- **Joints** are per-edge metadata on panels: `joints.{xMin,xMax,yMin,yMax,zMin,zMax}`, each `null` or `{ type, depth, width, count, offset }`. Mutually exclusive with mitre on the same edge.
- **Functional components:** a panel (door) or group (drawer) carries `func { kind, hingeSide, swingAngle, travel, slideType }`. Open/closed is a runtime toggle (loads closed).
- **Persistence:** `_projectState()` gains `hardware` + `nextHwId`; `snapPanel()` gains `joints` + `func`; add `snapHardware()`. PostgreSQL `state` is JSONB → **no migration needed.**

## Blocks

### Block 1 — Hardware foundation + simple catalog (B1a) ⬜
Data model + persistence wiring; procedural factory for knob, handle, leg, shelf-pin; "Hardware" catalog UI to add an item.
**Checkpoint:** add a knob/handle/leg/shelf-pin; save & reload preserves them.

### Block 2 — Hardware selection, placement & editing (B1b) ⬜
Select / move / duplicate / delete hardware; properties panel (position, rotation, size); snap-to-panel-face.
**Checkpoint:** full place/move/edit/delete; persists.

### Block 3 — Complex hardware: hinges, slides, cleats (B1c) ⬜
Factory geometry for euro hinge, telescoping drawer slide, French cleat; `attachedTo` orientation helpers.
**Checkpoint:** all 7 hardware types placeable; persists. *(B1 complete.)*

### Block 4 — Joint model + recess joints (A1a) ⬜
Per-edge joint metadata + Properties UI; geometry for dado, groove, rabbet (recess in `buildMesh`).
**Checkpoint:** set dado/rabbet/groove on an edge, see the recess; persists.

### Block 5 — Interlocking joints + fastener markers (A1b) ⬜
Finger/box & dovetail profiled edges; dowel & pocket-hole markers; joints reflected in cut sheet / assembly notes.
**Checkpoint:** all joint types representable; notes in cut sheet; persists. *(A1 complete.)*

### Block 6 — Functional doors (B2a) ⬜
Designate panel as door (hinge side, swing angle); swing animation; hinge hardware tie-in; open/close toggle.
**Checkpoint:** door swings open/closed; designation persists.

### Block 7 — Functional drawers + clearance (B2b) ⬜
Designate drawer (travel, slide type); auto slide-clearance calc; slide-out animation; slide hardware moves with drawer.
**Checkpoint:** drawer opens/closes with clearance; persists. *(B2 complete.)*

### Block 8 — Integration, polish & docs ⬜
Hardware lines in cut sheet; assembly guide mentions hardware & joints; mobile/touch + light-theme styling for new UI; regression pass (save/load, AI design, cut sheet); README update.
**Checkpoint:** end-to-end clean; committed.

## Testing approach (per block)
- Verify via the live preview + `preview_eval` (DOM/state checks; the screenshot tool has been flaky in this environment).
- Always run a **save → reload** round-trip to confirm new fields persist through Postgres JSONB.
- Confirm no regressions to existing cut sheet, assembly guide, and AI design.
