# FurniCraft 3D — Project Context & History

> Continuity document for resuming work across context windows. Current as of **R43** (2026‑07‑10).
> Supersedes the older `HANDOFF.md` (pre‑R13) and complements `DEVPLAN.md` (the original feature roadmap, all ✅).

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
- **Syntax check for the big HTML files** (catches broken inline JS before commit):
  ```
  node -e "const fs=require('fs');const h=fs.readFileSync('public/index.html','utf8');const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;let m,e=0;while((m=re.exec(h))){const c=m[1];if(!c.trim())continue;try{new Function(c)}catch(x){e++;console.log(x.message)}}console.log(e?'FAIL':'OK')"
  ```
- **Server module load check:** `node -e "require('./server/routes/ai.js');require('./server/db.js');console.log('OK')"`.
- **Deploy verification pattern** (background bash): `until curl -s -m 30 https://furnicraft-3d-t77u.onrender.com/<path> | grep -q "<marker>"; do sleep 20; done; echo LIVE` — poll for a code marker unique to the new commit.

## 6. Working conventions

- **One change = one `Rxx:` commit** = a resume checkpoint. Current head is **R43**. Continue numbering.
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

## 10. Open backlog (owner decisions / not yet done)

- **Set `ANTHROPIC_API_KEY` on Render** → makes all AI features actually generate (currently 503).
- **Set SMTP env on Render** → enables forgot‑password + passwordless code sign‑in live.
- **Privacy Policy / Terms pages** — footer links are placeholders (toast "coming soon"); pending business decision.
- **Self‑host Three.js / jsPDF** — currently CDN; an outage would break the editor.
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
