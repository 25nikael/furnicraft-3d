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

### Block 1 — Hardware foundation + simple catalog (B1a) ✅
Data model + persistence wiring; procedural factory for knob, handle, leg, shelf-pin; "Hardware" catalog UI to add an item.
**Checkpoint:** add a knob/handle/leg/shelf-pin; save & reload preserves them.
**Done:** `hardware[]` + `nextHwId` state; `mkHardware`/`snapHardware`/`buildHardwareMesh`/`removeHardwareMesh`; `HW_DEFS` factory (knob, handle, leg, shelf-pin) + `HW_FINISH` metals; catalog modal + left-panel Hardware list; wired into `_projectState`/`_loadProjectState`, `saveUndo`/`undo`, `refreshUI`. Verified: add all 4, render, save→reload round-trip, undo.

### Block 2 — Hardware selection, placement & editing (B1b) ✅
Select / move / duplicate / delete hardware; properties panel (position, rotation, size); snap-to-panel-face.
**Checkpoint:** full place/move/edit/delete; persists.
**Done:** `selectedHw` + `Box3Helper` highlight; click-to-select in scene & list; XZ-plane drag mirroring panel drag; dynamic hardware properties panel (name, finish, position, rotation, per-type size params); `snapSelectedHwToFace` (projects onto nearest panel face, orients to normal, sets `attachedTo`); duplicate/delete. Verified: select/edit/param-rebuild/snap/duplicate + save→reload preserves `attachedTo`.

### Block 3 — Complex hardware: hinges, slides, cleats (B1c) ✅
Factory geometry for euro hinge, telescoping drawer slide, French cleat; `attachedTo` orientation helpers.
**Checkpoint:** all 7 hardware types placeable; persists. *(B1 complete.)*
**Done:** `HW_DEFS` extended with hinge (cup+arm+plate), slide (telescoping outer/inner members), cleat (45° extruded profile); added `wood` finish. All inherit the generic select/edit/snap/persist pipeline. Verified: catalog shows 7, all build with geometry, save→reload round-trip, no warnings.

### Block 4 — Joint model + recess joints (A1a) ✅
Per-edge joint metadata + Properties UI; geometry for dado, groove, rabbet (recess in `buildMesh`).
**Checkpoint:** set dado/rabbet/groove on an edge, see the recess; persists.
**Done:** `joints` map on panels; true recesses via axis-aligned box subtraction (`jointCutAABB` + `subtractBox` + `buildJointedGeometry`, merged non-indexed with continuous UVs); Joinery properties section (`renderJointsUI`/`setJoint`) per in-plane edge with depth/width/offset; mutually exclusive with mitre. Verified: box 36→108→180 verts (real subdivision), all 3 types, save→reload preserves joints + geometry, no errors.

### Block 5 — Interlocking joints + fastener markers (A1b) ✅
Finger/box & dovetail profiled edges; dowel & pocket-hole markers; joints reflected in cut sheet / assembly notes.
**Checkpoint:** all joint types representable; notes in cut sheet; persists. *(A1 complete.)*
**Done:** finger/dovetail via multi-slot box subtraction (`fingerCuts`/`jointCuts`); dowel & pocket-hole overlay markers (`buildJointMarkers`, synced in syncPos/removeMesh); UI extended with all 4 new types + count param; `_jointSummary` surfaces mitre+joints in the cut-sheet table & PDF (column renamed Mitre→Joinery). Verified: finger 288 verts, markers 7 (rebuild on reload), summary text, cut sheet renders, no errors. NOTE: dovetail is shown schematically as box-comb interlock (axis-aligned); true angled pins deferred.

### Block 6 — Functional doors (B2a) ✅
Designate panel as door (hinge side, swing angle); swing animation; hinge hardware tie-in; open/close toggle.
**Checkpoint:** door swings open/closed; designation persists.
**Done:** generic `func` field on panels (door|drawer); `doorPose` pivots the panel about its hinge edge; `tickFunctional` animates swing (300°/s) from the render loop; Function properties section (type, hinge side, angle, open/close toggle); `addHingesForDoor` places 2 hinges on the hinge edge. Verified: swing to 100° + back to base, pivot moves position & rotation, hinges added, func persists through save/reload, no errors.

### Block 7 — Functional drawers + clearance (B2b) ✅
Designate drawer (travel, slide type); auto slide-clearance calc; slide-out animation; slide hardware moves with drawer.
**Checkpoint:** drawer opens/closes with clearance; persists. *(B2 complete.)*
**Done:** drawer kind on `func` (travel/slide/clearance); whole front group slides along the front's out-direction (`applyDrawerSlide`/`tickDrawer` at 900mm/s); clearance UI + guidance (12.5mm/side default); `addSlidesForDrawer` places 2 slides at the box sides accounting for clearance. Verified: slides out 450mm & back, group moves together, slides added, func (incl clearance) persists, no errors.

### Block 8 — Integration, polish & docs ✅
Hardware lines in cut sheet; assembly guide mentions hardware & joints; mobile/touch + light-theme styling for new UI; regression pass (save/load, AI design, cut sheet); README update.
**Checkpoint:** end-to-end clean; committed.
**Done:** Hardware BOM section in the cut sheet (`renderHardwareBOM`) + PDF hardware table; "Install hardware" assembly step; joinery already surfaced via `_jointSummary`; new UI reuses themed classes (light theme verified); README "Design features" section. Regression verified: 7 parts + 2 BOM rows, AI opens, light theme intact, full round-trip preserves panels/hardware/joints/func, no errors.

---
**ALL BLOCKS COMPLETE** — B1 (hardware catalog), B2 (functional doors/drawers), A1 (joinery) shipped across commits cf6f860 → (block 8).

---

# Development Plan 2 — F-Series (Modeling & Design Tools)

All seven F features, in dependency order. Same cadence: one block per work
unit, each ending in a commit. Status: ⬜ todo · 🔄 in progress · ✅ done

### F-Block 1 — Unit system (F7) ✅
Global mm/cm/inch setting; `fmtLen`/`parseLen` helpers; applied to properties
dims+positions, overall size, 3D dim labels, cut sheet & PDF; fractional inches
in read-only displays; settings selector. (Built first so later tools display units.)
**Done:** `_unit` + `MM_PER`, `toUnit`/`fromUnit`/`parseLen`/`fmtLen`/`fmtLenLabel` (1/16" fractions); Units section in settings; applied to props (show/apply), overall, 3D labels, cut-sheet table, PDF note. Verified: mm/cm/inch convert, `1 1/2"` fractions, 20"→508mm round-trip, no errors.

### F-Block 2 — Alignment & distribution (F3) ⬜
Multi-select align min/center/max per axis + distribute evenly.

### F-Block 3 — Mirror & array (F4) ⬜
Mirror across X/Y/Z; linear array (count+spacing) and radial array (count+angle).

### F-Block 4 — Measurement & annotation (F5) ⬜
Measure mode: two-point distance (+ angle); persistent annotation overlay; uses unit formatter.

### F-Block 5 — Template/preset library (F2) ⬜
Parametric presets (bookcase, wardrobe, base cabinet, table, drawer unit) + modal with W/H/D.

### F-Block 6 — Sub-assemblies / nested grouping (F6) ⬜
Named groups + group-of-groups; select/move as a unit; group manager.

### F-Block 7 — Parametric overall resize (F1) ⬜
Editable overall W/H/D → proportional refit of all panels (positions + in-plane
dims, thickness preserved). Pragmatic parametric resize for any design.

### F-Block 8 — Integration, polish & docs ⬜
Units flow into new features; mobile/theme; regression; README + DEVPLAN.

## Testing approach (per block)
- Verify via the live preview + `preview_eval` (DOM/state checks; the screenshot tool has been flaky in this environment).
- Always run a **save → reload** round-trip to confirm new fields persist through Postgres JSONB.
- Confirm no regressions to existing cut sheet, assembly guide, and AI design.
