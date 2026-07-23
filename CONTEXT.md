# FurniCraft 3D — Project Context & History

> Continuity document for resuming work across context windows. Current as of **R61** (2026‑07‑23).
> The stale pre‑R13 `HANDOFF.md` was deleted in favour of this file; complements `DEVPLAN.md` (the original feature roadmap, all ✅).

---

## 1. What this is

**FurniCraft 3D** — a full‑stack, browser‑based 3D woodworking/furniture designer. Users model cabinets, tables and built‑ins panel‑by‑panel with joinery, hardware, materials, drawers/doors, cut sheets, cost estimates, an AI design assistant (text **and** photo), cloud projects, sharing, and AR preview.

- **GitHub:** `25nikael/furnicraft-3d`, branch `master`.
- **Live:** Render web service **`furnicraft-3d-t77u`** (`https://furnicraft-3d-t77u.onrender.com`) + managed PostgreSQL. **Auto‑deploys on push to `master`** (~1–2 min rebuild).
- **Owner / admin:** `25nikael@gmail.com` (hardcoded admin identity, server‑enforced).

## 2. Stack & layout

- **Frontend:** static files in `public/`. No build step; vanilla JS + inline CSS.
  - `public/index.html` — the entire 3D editor (~6.5k lines, single file, Three.js **r128 UMD** + exporters/OrbitControls via CDN). Inline ES5‑style JS (`var`, function declarations — match it).
  - `public/landing.html` — marketing landing page + the unified auth component (inline, 7‑screen auth router).
  - `public/admin.html` — admin portal (users + feature flags); only for the admin email.
- **Backend:** `server/` — Express + `pg`.
  - `server/index.js` — entry; mounts routes, static, SPA fallback; `app.set('trust proxy', 1)` for rate‑limit IPs.
  - `server/db.js` — pg pool + idempotent schema bootstrap (all migrations via `CREATE ... IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`). Boots even if DB unreachable (endpoints then 503).
  - `server/routes/` — `auth.js`, `projects.js`, `public.js`, `ai.js`, `admin.js`, `flags.js`.
  - `server/middleware/auth.js` — `requireAuth` (JWT verify **+ per‑request `disabled` check**).
  - `server/utils/` — `jwt.js` (30‑day tokens), `email.js` (`sendOTP` + `smtpConfigured`), `rateLimit.js` (in‑memory sliding‑window).
  - `server/scripts/dev-server.js` — **dev‑only** entry (see §4).

## 3. Auth & data model

- **JWT** in `localStorage` under `fc3d_token`, 30‑day expiry. Auth gate in `index.html` redirects tokenless visitors to `/landing` (except `?share=…` links).
- **Auth methods:** email+password, Google Sign‑In (shown only when `GOOGLE_CLIENT_ID` set), passwordless email‑code sign‑in (**only when real SMTP configured**), forgot/reset password (needs email delivery). `GET /api/auth/config` returns `{ googleClientId, dbReady, emailAuth, passwordlessLogin, emailAuthDev }` and the UI shows only usable methods.
- **Endpoints:** `/api/auth/{config,register,verify,login,google,me,forgot,reset,login-code/request,login-code/verify}`.
- **Tables:** `users` (+ `disabled`), `otp_codes` (+ `purpose`: register/reset/login), `projects` (+ `thumb,is_public,share_token`), `project_versions`, `feature_flags`.
- **Feature flags** (`feature_flags`, public `GET /api/flags`, toggled in admin): `ai_design`, `image_to_design`, `public_gallery`, `version_history`, `pdf_export`, `share`. Applied on init in `index.html` via `_applyFeatureFlags()` / `_setFlagVis()` / `_flagOn()`.

## 4. Local development (IMPORTANT — this is how to run/verify locally)

Production needs `DATABASE_URL`; there is none locally. Use the **in‑memory dev server**:

- **`node server/scripts/dev-server.js`** injects `pg-mem` as the `pg` module, sets dev env (`JWT_SECRET`, `PORT`), seeds accounts, and requires the unmodified `server/index.js`. Production code is untouched by it.
- **`.claude/launch.json`** config **"FurniCraft 3D"** runs this dev server on port 3000 (used by the Claude Preview MCP `preview_start`).
- **Seeded accounts:** admin `25nikael@gmail.com` / `admin123`; user `tester@local.test` / `test1234`. In‑memory DB **reseeds on every restart** (test artifacts vanish).
- Fast sign‑in in preview: `fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'tester@local.test',password:'test1234'})}).then(r=>r.json()).then(d=>{localStorage.setItem('fc3d_token',d.token);location.href='/';})`.

## 5. Environment quirks & verification method (READ BEFORE VERIFYING)

- **The Claude Preview tab runs hidden/backgrounded.** Consequences:
  - `preview_screenshot` **times out** — don't rely on it.
  - `requestAnimationFrame` is **paused** when hidden, so animation loops (3D render, the landing wood‑bg parallax) don't advance in the preview — you cannot observe motion there. Verify the **logic/DOM/state**, not the animation.
  - The WebGL canvas can report **0×0** headless, so screen‑projection paths (dimension labels, drag via screen rays) are degenerate in preview but fine in a real browser.
- **Verify via:** `preview_eval` (DOM queries, app‑state reads like `panels.length`, mocking `fetch` to capture payloads), `preview_console_logs` (level `error`), `preview_inspect` (computed styles), and Node‑side checks.
- **To verify what the 3D scene actually RENDERS** (no screenshots available), render offscreen and read pixels — this works even with the tab hidden and the canvas 0×0, because a `WebGLRenderTarget` has its own fixed size and `renderer.render()` can be called manually (rAF is paused, but direct calls are not):
  ```js
  var rt = new THREE.WebGLRenderTarget(64,64);
  var cam = new THREE.PerspectiveCamera(50,1,1,20000);
  cam.position.set(2500,500,0); cam.lookAt(2500,0,0); cam.updateMatrixWorld();
  scene.background = new THREE.Color(0xff0000);           // decisive backdrop
  var buf = new Uint8Array(4);
  renderer.setRenderTarget(rt); renderer.render(scene,cam);
  renderer.readRenderTargetPixels(rt,32,32,1,1,buf); renderer.setRenderTarget(null);
  ```
  Used in R47 to prove the floor was genuinely transparent (red showed through) and that gridlines still drew. **Always run a control** (e.g. same sample with the feature forced off) — and aim the camera at empty space away from the model, or panel geometry contaminates the pixel count.
- **CSS transitions are also paused in the hidden preview tab**, so geometry read after a `.24s` transition still reports the *start* state. To check the settled end state, inject `*{transition:none !important}` for the affected selectors, toggle, then measure (R46).
- **Syntax check for the big HTML files** (catches broken inline JS before commit):
  ```
  node -e "const fs=require('fs');const h=fs.readFileSync('public/index.html','utf8');const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;let m,e=0;while((m=re.exec(h))){const c=m[1];if(!c.trim())continue;try{new Function(c)}catch(x){e++;console.log(x.message)}}console.log(e?'FAIL':'OK')"
  ```
- **Server module load check:** `node -e "require('./server/routes/ai.js');require('./server/db.js');console.log('OK')"`.
- **Deploy verification pattern** (background bash): `until curl -s -m 30 https://furnicraft-3d-t77u.onrender.com/<path> | grep -q "<marker>"; do sleep 20; done; echo LIVE` — poll for a code marker unique to the new commit.
  - ⚠️ **The marker must not appear in `index.html`.** Unknown paths hit the SPA fallback and return `index.html`, so a generic marker (e.g. `grep FurniCraft` on `/manifest.webmanifest`) reports LIVE against the *old* build. This bit in R57. For **static assets poll the content type instead** — the fallback returns `text/html`, so `curl -o /dev/null -w "%{content_type}"` and match `application/manifest+json` / `image/png`.

## 6. Working conventions

- **One change = one `Rxx:` commit** = a resume checkpoint. Current head is **R61**. Continue numbering.
- Commit → push only when the work is verified. Pushing to `master` **deploys to production** — the user has authorized deploys for this work and typically wants each fix live.
- Keep commit messages **quote‑free** in heredocs if using PowerShell here‑strings (the Bash tool handles quotes fine; PowerShell here‑strings historically broke on `"`).
- After a deploy, remind the user to hard‑refresh (Ctrl+Shift+R).
- Match the surrounding code style; don't introduce frameworks or a build step.

## 7. Hard constraints & gotchas (these have bitten before)

- **Render has a ~30s request timeout.** Long single API calls 502. This is why AI text design uses **Haiku** (`claude-haiku-4-5-20251001`), not Sonnet/Opus (learned across R13–R17). The **photo** endpoint uses **`claude-sonnet-4-6`** for accuracy and is the one most at risk of timing out with several images — fall back to Haiku or a streaming/background job if 502s appear.
- **AI features need `ANTHROPIC_API_KEY` set on Render.** Without it every AI endpoint returns a clean 503 "AI not configured". As last checked, the key was **not** set in production — the AI buttons work but return 503 until the owner adds it.
- **Email flows (forgot/reset, passwordless) need SMTP** env (`SMTP_HOST/PORT/USER/PASS/FROM`) on Render. Without it those methods are hidden and codes aren't delivered. Registration OTP has a dev‑mode fallback that shows the code (safe: never in production). Passwordless sign‑in **never** returns a code without real SMTP (hard 503).
- **Claude vision message shape** (used in `ai.js` via raw `fetch`): image content block `{type:'image',source:{type:'base64',media_type,data}}` placed **before** the text block. Images are downscaled client‑side to a 1568px‑long‑edge JPEG.
- **AI system prompt** in `ai.js` encodes the coordinate system + construction rules; output must be raw JSON (an `extractJSON` safety net strips fences).

## 8. Key editor internals (`public/index.html`)

- **Panels:** `panels[]`, `mkPanel`, `snapPanel`, `buildMesh`, `removeMesh`, `syncPos`; fields w/h/d, x/y/z, rx/ry/rz, material, grain, groupId, `mitre*`, roundedEdges, `joints{}`, `func`, textureURL.
- **Hardware:** `hardware[]`, `mkHardware`, `HW_DEFS` (knob/handle/leg/shelfpin/hinge/slide/cleat), `buildHardwareMesh`; selection `selectedHw`. Hardware has `groupId` + `attachedTo`; `_followHardware(panels)` and `adoptHardwareGroup(hw)` make it group and move with panels; `_funcFollowHw` makes it follow door swing / drawer slide.
- **Grouping:** `groupId`, `groupMeta`, `_rootGroup`, `getGroupPanels`, `groupSelected`/`ungroupSelected`.
- **Collision / snapping:** `wouldCollide` (non‑directional mitre clearance via `mitreFaceClearance`, rotation‑aware), `magnetSnapPos`/`magnetSnapY` (Alt / Alt+Shift), screen‑projection drag `_axisScreenProject`.
- **Joinery:** per‑edge `joints`; `buildJointedGeometry`/`subtractBox`/`jointCuts`/`buildJointMarkers`.
- **Functional:** `func` (door|drawer); `doorPose`, `applyFuncPose`, `tickFunctional`, `tickDrawer`, `applyDrawerSlide`, `_drawerGroup`.
- **Exploded view:** `tickExplode` — buckets panels by thickness/normal axis, stacks overlapping ones, enforces a minimum gap; offsets cached per `_sceneRev`.
- **Touch:** touchstart classifies (capture phase, ahead of OrbitControls) → tap select / drag move / handle resize (34px touch radius); two‑finger orbit/pinch native.
- **View‑lock:** `_viewOnly` + `_editBlocked()` guard all mutation entry points for shared/gallery designs; banner offers "Save a copy".
- **Persistence:** `_projectState()` / `_loadProjectState()`; undo/redo `_snapshot`/`_restoreSnapshot`/`undoStack`/`redoStack` (cap 50); `_dirty` flag + `beforeunload` guard.
- **UI system:** `uiToast`, `uiConfirm`, `uiPrompt`, `escHtml` (all user strings escaped), `_MODAL_CLOSERS` / `_closeTopModal` (Esc + backdrop close), `_handleSessionExpired` (in‑place re‑auth, design preserved).
- **AI modal:** `openAIDesign`, `generateAIDesign`/`_aiRun` (text), `_aiImagePicked`/`generateFromImage`/`_aiImages[]`/`_renderAiThumbs` (multi‑photo), `_parseAndShowDesign`, `applyAIDesign`.
- **Landing bg (R42/R43):** `#wood-bg` fixed `z-index:-1` `pointer-events:none`; JS builds N wood panels (28 desktop / 16 mobile) from 13 species palettes, parallax to cursor (`PARALLAX=170`) + idle sine drift; honours `prefers-reduced-motion`.

## 9. History

### Original build (pre‑session) — all shipped, tracked in `DEVPLAN.md`
Foundation → **B1** hardware catalog, **B2** functional doors/drawers, **A1** joinery (commits `cf6f860`→`53b9196`); **F‑series** modeling tools (units, align/distribute, mirror/array, measure, templates, sub‑assemblies, parametric resize); **G‑series** visualization (PBR, exploded view, room mode, texture upload, AR); **J‑series** UX (shortcuts, undo/redo, snap settings, onboarding); **C/D/E/H/I** (cut sheets+CSV, cost/quote PDF, GLB/OBJ/STL/DXF/SVG/PNG export + share, thumbnails/import‑export/version‑history/public‑gallery, AI refine/advise/from‑image). All feature menus A·B·C·D·E·F·G·H·I·J complete.

### This session (R13 → R43)
- **R13–R17** — AI module debugging: collapsed to a single Haiku call (no two‑pass, no prefill, no adaptive thinking) to fix 502 timeouts and empty responses on Render.
- **R14** — landing page, client‑side auth gate, admin portal, feature flags.
- **R18–R20** — Alt magnetic face snap; Z‑axis drag fix + Shift vertical drag; Alt+Shift vertical snap.
- **R21** — stop resetting the camera on add/remove panel/hardware.
- **R22** — mitred ends join (non‑directional, rotation‑aware clearance).
- **R23** — hardware groups with panels and moves together.
- **R24** — exploded view reworked with enforced minimum spacing.
- **R25** — **local dev environment** (in‑memory pg‑mem, seeded accounts; no prod change).
- **R26–R31 (orchestrated QA + fix loop)** — replaced all native `alert/confirm` with in‑app toasts/modals (fixed a freeze); XSS escaping, dirty‑flag/beforeunload, 401 re‑auth, save guards, Ctrl+S, Esc/backdrop modal close (R27); feature‑flag honesty + server‑single‑source admin identity + graceful Google/SMTP degradation (R28); GPU‑leak/idle‑DOM/explode‑cache perf (R29); disabled‑account enforcement + signed‑out share links + project rename/duplicate (R30); shared‑banner hit target (R31).
- **R32–R34** — share **view‑lock** + per‑request disabled enforcement (R32); working **tablet touch** support (R33); modal‑overlap fix on session expiry (R34).
- **R35–R36** — hardware groups/moves with panels reliably (R35); hardware **follows door/drawer open‑close animations** (R36).
- **R37–R39 (landing + auth overhaul)** — auth server: forgot/reset, passwordless code, rate limiting, 8‑char password floor (R37); landing rebuild + unified auth component (R38); same unified auth in the editor modal + session‑expired variant (R39).
- **R40–R41** — **AI design from a photo** (`/api/ai/from-image`, re‑enabled `image_to_design` flag) (R40); **multiple photos** + upgraded the photo path to Sonnet + rigorous multi‑view prompt for accuracy (R41).
- **R42–R43** — **interactive wooden‑panel background** on the landing page (cursor parallax + idle drift) (R42); more panels, 13 wood species, stronger parallax (R43).
- **R44** — landing UI cleanup: replaced the static CSS‑mock cabinet + grey faux tool‑strip with honest **animated SVG demos** (hero drawer slide; showcase grid of panel‑resize‑with‑live‑mm, drawer open/close, door swing). Pure CSS keyframes + one rAF for the mm label; `prefers-reduced-motion` fallback; removed dead `.hv-*`/`.showcase-*` CSS.
- **R45** — **collapsible editor UI (desktop)**: left/right side panels collapse via edge tabs (`#tab-left`/`#tab-right`, `.side-collapsed` class, `toggleSidePanel()`); bottom view‑options toolbar collapses to a 🛠 button (`#toolbar-toggle`, `#toolbar-btns`, `.tb-collapsed`, `toggleToolbar()`). State persists in localStorage (`fc3d_left_collapsed` etc.). Desktop‑only — tabs hidden ≤768px; the existing mobile drawer system (`.open` + `toggleDrawer`/`closeDrawers`) is untouched and separate. *(Panel collapse mechanics superseded by R46.)*
- **R46** — **side panels overlay the viewport instead of resizing it**. R45's panels were flex children of `#app`, so collapsing re‑laid‑out the row and resized the canvas. Now `#app` is `position:relative` and both panels are `position:absolute` overlays (`z-index:21`, drop shadow) that slide off‑screen via `translateX(±100%)`; `#viewport`/`#three-canvas` hold the full window width in every state. Edge tabs sit at the panel's inner edge (188px / 208px) and slide to the window edge, driven by new `body.lp-collapsed` / `body.rp-collapsed` classes set in `_setSideState()`. `#info-hud` shifts to `right:220px` to clear the floating right panel. `_fitViewportSoon()` **deleted** — it existed only to chase the animating width. Mobile: `#…side-collapsed.open` rules make `.open` explicitly win, so a stale desktop collapse flag in localStorage can't wedge a drawer shut. Trade‑off: expanded panels cover ~400px of canvas, so edge‑of‑screen orbit drags hit a panel — inherent to overlaying.
- **R47** — **transparent ground‑plane toggle** (`▦ Floor` button in the view toolbar). The y=0 plane carries two materials: `_floorMatSolid` (opaque `MeshLambertMaterial`) and `_floorMatClear` (a `ShadowMaterial`, opacity .28, which draws *only* the received shadow so the design keeps its ground shadow instead of floating). `setFloorClear()`/`toggleFloor()`, persisted in `fc3d_floor_clear`. `_gridHelper` is a separate scene object and is never touched, so gridlines survive both states. Two gotchas fixed while building: `setTheme()` now recolours `_floorMatSolid` directly instead of `_floorMesh.material` (which in clear mode would tint the shadow material and wash shadows out in the light theme), and `_floorClear` is declared *beside the floor setup* — a later `var` initialiser was silently clobbering the restore‑on‑load value, desyncing the flag from the material and making the first click after a reload a no‑op.
- **R48–R49 (agent‑orchestrated hardware + joinery expansion)** — a multi‑agent Workflow researched supplier catalogs (6 parallel sweeps, 81 candidates), deduped against the existing catalog, ranked by real‑world usage, generated defs, and adversarially verified each (engine API / mounting‑face geometry / dimensional realism). Run had to be resumed 3× across session‑limit windows (`resumeFromRunId` caching); the final verify pass was rewritten **serially** (1 agent at a time, combined 3‑lens verifier, context via scratchpad files) to keep token burn/sec low.
  - **R48 — 10 hardware types** in `HW_DEFS`: `screw` (chipboard 4×40), `bumper`, `magcatch`, `leveler`, `minifix`, `euroscrew`, `confirmat`, `cornerblock`, `cuppull`, `edgepull`. Purely additive — catalog grid/params panel/finish picker/cut sheet all render from `HW_DEFS` generically; `HW_PRICE_DEFAULT` extended. Ranks 11–18 (damper, roller catch, TIP‑ON, threaded insert, cross dowel, figure‑8, Z‑clip, corner brace) are researched + dimensioned but not coded — in the workflow output at the session tasks dir if wanted later.
  - **R49 — 6 joinery types**: cut joints `stoppeddado` (notch=1 → shelf‑corner notch mode), `tonguegroove` (tongue half; mate = existing groove), `halflap`, `mortisetenon` (`role` tenon|mortise), `loosetenon` (Domino‑style, count slots) — all exact AABB removals via `subtractBox`; marker joint `buttjoint` (auto screw layout: 25mm inset, ≤150mm apart at count=0). `buildJointMarkers` refactored (addMarker helper, `MARKER_JOINTS.indexOf` filter, screwMat). **`setJoint` behaviour changes:** switching joint type now resets params to the new type's defaults, and the old blanket `>=1` clamp became per‑field floors (offset/count/notch may be 0; `role` passes through as a string) — the blanket clamp would have silently broken buttjoint auto mode and stoppeddado's notch/stopEnd.
- **R50 — staged exploded view.** Previously only panels exploded (hardware froze at assembly position) and drawer-box panels scattered into the global stacks. Now two smoothstep phases: **0→0.45** each drawer unit (front + groupId panels + its hardware) ejects along `_drawerOutDir` until its rear clears the carcase +gap; **0.45→1** carcase panels separate (stack algorithm scoped to non‑drawer panels) while each drawer's panels fan out around its ejected spot. Collapse mirrors. Hardware host resolution: `attachedTo` → group root → nearest panel by world‑AABB distance (`_distToPanelSq`); slides ride eject but not the fan‑out. Key internals: `_stackOffsets(list,MINGAP,SPREAD,out)` extracted; offsets struct `{main,eject,sub,hw}`; cache key includes `hardware.length`. **Behaviour gates:** `toggleExplode` closes open doors/drawers on entry (else a swung door keeps open rotation while its position explodes); `tickFunctional` is skipped in `animate()` while `_explode > 0.0001` (both wrote positions to the same meshes). Verified by stepping `tickExplode(0.02)` manually with synthetic dt — the animation math is pure and testable headless.
- **R51 — room mode: wood‑plank floor + white walls.** `buildRoom` previously drew a flat tan floor + two off‑white walls. New `_roomFloorTex()` builds a cached procedural plank texture (4 boards/tile, varied tones, dark seam grooves, vertical grain, staggered butt joints; `RepeatWrapping` + max anisotropy); floor material is `roughness:0.88` so it shows true wood albedo instead of washing to grey under the PBR env reflection (this was the real gotcha — a single‑pixel render sample looked warm, but a **wide render‑average** exposed the wash: saturation R‑B 19→33 after deepening tones + raising roughness). Walls repainted `0xF2F1ED`. `buildRoom` now disposes each mesh material on rebuild (the cached floor texture survives). Two‑wall open‑corner layout kept. Verify technique reused from §5: offscreen `WebGLRenderTarget` + averaged pixels (not one texel) to judge how a lit surface actually reads.
- **R52** — darkened the R51 room floor to a deeper walnut (plank tones + seam/grain one shade down; floor render mean [138,127,105]→[123,109,81]). Colour‑only tweak.
- **R53–R54 — furniture library + AI reference base.**
  - **R53 (client):** template library 5→**13** pieces. New: nightstand, dresser (2‑column), desk, coffee table, TV stand, floating shelf, wall cabinet, bench. Picker now uses optgroups. The drawer‑box math is extracted from `tplDrawerUnit` into `_tplDrawers(list, hw, xC, openW, D, yBottom, yTop, n, opts)` — driven by column‑centre + clear‑opening width so it serves single‑ and multi‑column pieces; `tplDrawerUnit` refactored onto it with byte‑identical output. `TPL_GEN` + `TPL_DEFAULTS` + the `#tpl-preset` `<select>` all extended. Templates feed the existing R50 explode/group machinery unchanged.
  - **R54 (server):** `server/routes/ai.js` gains `FURNITURE_REFERENCE`, appended to `AI_SYSTEM_PROMPT` (used by BOTH `/design` and `/from-image`): ergonomic height anchors, shelf/drawer rules of thumb, and a W×H×D catalog of ~18 common pieces, kept consistent with `TPL_DEFAULTS`. Improves accuracy of undimensioned requests. **Only verifiable offline** (require‑load + prompt interpolation) — live AI still needs `ANTHROPIC_API_KEY` on Render (still unset → 503).
- **R55 — landing wood‑panel bg follows device tilt on mobile** (`public/landing.html`). The parallax only tracked a cursor, so phones saw idle drift only. Now `deviceorientation` drives the same `tx/ty` target: **first reading = neutral rest pose** (phones are held at ~50‑70°, not flat), 22° from neutral = full deflection, clamped. `tiltToScreenAxes(beta, gamma, angle)` is a **top‑level pure fn** mapping device→screen axes per rotation (portrait/90/180/270/legacy −90). `orientationchange` clears the neutral to re‑level. **iOS 13+** needs a user gesture → asks once on first `touchend`, refusal remembered in `localStorage.fc3d_tilt_denied` (never re‑prompts); Android starts directly. `touchmove` defers once `tiltActive`. The tilt block sits **after** the `prefers-reduced-motion` early return so reduced‑motion users are never prompted. **Verification limit:** the harness has no accelerometer and rAF is paused, so on‑screen motion was NOT observed — verified the pure mapping exhaustively + spied the global mapper to prove listener wiring. Sensitivity dial = `TILT_DEG`. Needs a real‑phone check.
- **R56 — assembly guide animates on the model.** The guide was text‑only and hardware was a lump appended inside `renderAssemblyGuide` (so the PDF never saw it). Now **guide and model are one list**: `generateAssemblySteps()` attaches a `panel` ref per panel step and emits **hardware steps, one per type**, with `_hwFitDesc(type,n)` guidance (PDF gains these for free). Playback engine: `tickAssembly(dt)` + `_asmRender()`, state `_asmActive/_asmPlaying/_asmIdx/_asmT`, `ASM_STEP_DUR=0.6` s/step (**pacing dial**). Earlier steps seated, current step flies in smoothstep, later hidden. **Fly‑in axis:** panels enter along their `_panelNormalAxis` (thickness) so a side comes from the side / shelf from above / back from behind; hardware along its dominant axis from centre. UI: `#asm-hud` viewport HUD (counter, title, ◀/play/▶/✕) + every guide row is `asmJumpTo(i)` clickable with `.asm-current` highlight; starting playback calls `hideCutSheet()` since the modal covers the model. **Ownership rule (important):** assembly > explode > functional — all three write mesh positions each frame; `animate()` runs `tickFunctional`/`tickExplode` only when `!_asmActive`, `startAssemblyAnim` collapses explode, `toggleExplode` stops playback. Dims suppressed during playback (hidden panels would still be dimensioned), prior `dimsEnabled` restored on exit. `asmStepBy`/`asmJumpTo` call `_asmRender()` so a step change is atomic. Verified by stepping `tickAssembly` with synthetic dt (rAF paused); **pacing never watched live.**
- **R57–R58 — mobile / Android.** See **`MOBILE.md`** (root) for the full story: install-as-PWA steps, the APK build, and how cross-device sync works.
  - **R57 (PWA, verified):** `public/manifest.webmanifest`, `public/sw.js`, `public/icons/*` (regenerate with `node tools/make-icons.js` — zero‑dep PNG encoder using zlib), plus manifest/theme‑color/apple‑touch‑icon meta + SW registration on `index.html` **and** `landing.html`. **SW policy:** `/api/*` is never cached or intercepted (a stale project must never shadow newer cloud work); navigations network‑first with cached fallback; everything else cache‑first; `accounts.google.com` bypassed. **Gotcha fixed:** cross‑origin `<script>` without `crossorigin` gives an **opaque** response (status 0) which the SW refuses to cache, so the CDN libs weren't cached and an offline launch would load the page then fail to boot Three.js. jsdelivr + cdnjs both send `ACAO:*`, so those **7 tags now carry `crossorigin="anonymous"`** (Google's SDK deliberately does not). Bump `CACHE` in sw.js when the shell contract changes.
  - **R58 (Capacitor scaffold):** `mobile/` holds `capacitor.config.json` + its own `package.json` (so the server deps / Render deploy are untouched) + `copy-web.js` (`public/` → `mobile/www`, needed because Capacitor requires a webDir even with `server.url`). The WebView **points at the deployed URL** rather than bundling — keeps everything same‑origin so `/api/*`, `/landing`, `/admin` and the SPA fallback all behave as on the web, and deploys land without republishing. A fully bundled build would additionally need a native `/api` base shim and rewrites for the extensionless routes (both documented in MOBILE.md, neither written).
  - **R59 (APK actually built — the toolchain WAS on the machine, just not on PATH):** Android Studio JBR (**JDK 21**) at `C:/Program Files/Android/Android Studio/jbr`, SDK at `~/AppData/Local/Android/Sdk` (only platform **android‑36** installed, build‑tools 36/37, no cmdline‑tools/sdkmanager). Bumped the scaffold **Capacitor 6→7** (Gradle 8.11.1 / AGP 8.7.2 support JDK 21; Cap 6's Gradle 8.2 does not). Retargeted `variables.gradle` compile/target SDK **35→36** (only installed platform; can't auto‑download). Committed the generated `mobile/android/` project (Capacitor‑idiomatic, makes the APK reproducible); `.gitignore` covers build outputs, `local.properties`, keystores, `*.apk`. **Build:** `JAVA_HOME=<jbr> ANDROID_HOME=<sdk> ./gradlew assembleDebug` → `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (~4 MB, appId `com.furnicraft.app`, versionName 1.0; verified it contains classes.dex + AndroidManifest + assets/public). **Gotcha:** hand‑writing `local.properties` `sdk.dir` with backslashes fails as `IOException: Invalid file path` — properties files treat `\` as an escape; use forward slashes. The `.apk` is gitignored (not committed).
  - **R60 (mobile layout fix):** Android screenshot showed the phone status bar overlapping FurniCraft's topbar, and the working area could scroll off-screen. Native: `MainActivity` goes edge-to-edge and hides the status bar (`WindowInsetsControllerCompat`, `statusBars()` only so the nav pill stays; swipe reveals it). Web (fixes PWA + the WebView): `body{position:fixed;inset:0;height:100dvh;overscroll-behavior:none}` kills document scroll/rubber-band; topbar pads by `env(safe-area-inset-top)` and toolbar/FAB/drawers offset by `env(safe-area-inset-*)`; manifest `display:fullscreen`. Verified in mobile preview (no scroll; simulated 40px inset grows topbar to 82, content clears it, still fits).
  - **R61 (TRUE offline-first bundle):** dropped `server.url` from `capacitor.config.json` so the APK serves from inside itself (`https://localhost`), launching with zero network — only cloud projects need connectivity. Three requirements, all done: **(1)** self-hosted the CDN libs (Three.js/OrbitControls/3 exporters/jsPDF/autotable) into `public/vendor/`, rewrote the 7 `<script>` tags to `/vendor/*` (dropped `crossorigin`; closes the CDN-outage backlog item; Google GSI stays remote). **(2)** `public/native-bridge.js` — loaded FIRST on both pages; when bundled-native (Capacitor native AND origin≠backend) it patches `window.fetch` to rewrite `/api/*`→backend, exposes `window.fcHref()` mapping extensionless routes→`.html`, skips the SW; **strict no-op on web / remote-URL builds**. **(3)** wrapped the 4 index + 2 landing route redirects in `window.fcHref()`, guarded SW registration with `!window.FC_BUNDLED`. (My R58 MOBILE.md missed the CDN-libs requirement — a "bundled" app without them still can't boot offline; now fixed.) **Verified:** web still boots from `/vendor`, login works, bridge no-op; bundled path tested by running the real `native-bridge.js` source in a sandbox with faked Capacitor+localhost (`/api`→backend, `/vendor` stays local, routes→`.html`). APK rebuilt (4.6 MB), `server.url` absent, vendor+bridge inside. **Revert to auto-updating remote:** re-add `server:{url}` — the bridge auto-deactivates.
  - **Sync needed no new code** — mobile is just another API consumer. Verified end‑to‑end against the dev server: device A saved 15 panels + 4 hardware, device B logged in independently (different JWT, same account), listed/loaded it with matching counts, edited it, device A saw the edit. Round‑trip drops only `undefined`‑valued keys (`func.hingeSide/angle` on drawers) — `JSON.stringify` behaving correctly, **not** data loss. **Concurrent edits are last‑write‑wins**; version history is the recovery path.

## 10. Open backlog (owner decisions / not yet done)

- **Set `ANTHROPIC_API_KEY` on Render** → makes all AI features actually generate (currently 503).
- **Set SMTP env on Render** → enables forgot‑password + passwordless code sign‑in live.
- **Privacy Policy / Terms pages** — footer links are placeholders (toast "coming soon"); pending business decision.
- ~~**Self‑host Three.js / jsPDF**~~ — DONE in R61: now in `public/vendor/`, loaded from `/vendor/*`. No CDN dependency for the libraries (Google GSI is still remote).
- ~~Real screenshot assets for the landing hero/showcase~~ — resolved in R44 with animated SVG tool demos (honest, asset‑free). Could still add real editor screenshots later if desired.
- **Passkeys / Apple Sign‑In** — deferred (Apple needs a paid dev account; passkeys can't be verified in this harness).
- **Photo‑AI latency** — Sonnet + multiple images may approach the 30s Render limit; move to streaming/background if 502s appear.
- Minor: share tokens aren't revoked on *unpublish* (only on delete) — flagged, no decision.

## 11. How to resume in a fresh context

1. `git pull`; read this file, then `git log --oneline -20` for recent state. Head should be `R43` or later.
2. To run locally: `preview_start` the "FurniCraft 3D" config (or `node server/scripts/dev-server.js`), sign in with a seeded account.
3. Make the change; **verify via `preview_eval`/DOM + console (not screenshots)**; syntax‑check big HTML files and `require`‑check server modules.
4. Commit as the next `Rxx:` and push (deploys to Render). Poll the deploy with the `until curl … grep` pattern, then tell the user to hard‑refresh.
5. Keep the project memory (`furnicraft-roadmap.md`) and this file updated when the state materially changes.
