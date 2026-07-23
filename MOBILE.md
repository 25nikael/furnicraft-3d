# FurniCraft 3D on mobile

Two ways to run FurniCraft on a phone or tablet. Both talk to the **same backend
and the same database as the desktop site**, so a project started on a PC opens
on the phone and vice versa.

---

## 1. Install as an app (no build required) — works today

The site is a PWA, so Android/Chrome can install it straight to the home screen:

1. Open `https://furnicraft-3d-t77u.onrender.com` in Chrome on the device.
2. Menu (⋮) → **Add to Home screen** / **Install app**.
3. Launch it from the icon — it runs full-screen with no browser chrome.

Sign in with the same account you use on the PC and your projects are there.

On iOS the equivalent is Safari → Share → *Add to Home Screen* (the 3D editor
works; iOS gives PWAs less storage and no install prompt).

## 2. Build a real Android APK (Capacitor)

Use this if you want a sideloadable `.apk` or a Play Store listing. The shell
lives in `mobile/` and is kept out of the server's `package.json`, so none of it
affects the Render deploy.

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | 18+ |
| JDK | 17+ — Android Studio's bundled JBR (21) works; needs Gradle 8.5+, which Capacitor 7 ships |
| Android Studio | with an installed SDK **platform** + Platform-Tools |

The `mobile/` shell uses **Capacitor 7** (Gradle 8.11.1, AGP 8.7.2 — the combo
that supports JDK 21). `variables.gradle` targets **SDK 36**; change
`compileSdkVersion`/`targetSdkVersion` there to a platform you actually have
installed (there is no `sdkmanager` auto-download for platforms).

### Build (verified 2026-07-23)

This exact flow produced a working `app-debug.apk`:

```bash
cd mobile
npm install
npm run add:android      # copies public/ -> www/ and generates the android project

# Point Gradle at the JDK and SDK (adjust paths for your machine):
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="$HOME/AppData/Local/Android/Sdk"

cd android
./gradlew assembleDebug        # first run downloads Gradle + AGP (~2-6 min)
```

The debug APK lands in `mobile/android/app/build/outputs/apk/debug/app-debug.apk`
(~4 MB). Or open Android Studio with `npm run open` and use
**Build → Build APK(s)** instead of the CLI.

> **local.properties gotcha:** if you write `sdk.dir` by hand, use **forward
> slashes** (`sdk.dir=C:/Users/you/AppData/Local/Android/Sdk`). Backslashes are
> escape characters in a `.properties` file, so a Windows path with them fails
> the build with a cryptic `java.io.IOException: Invalid file path`. Android
> Studio writes this file correctly on its own.

After a web change run `npm run sync` (re-copies `public/` and re-syncs Gradle),
then rebuild.

For a release build you need a signing key:

```bash
keytool -genkey -v -keystore furnicraft.jks -keyalg RSA -keysize 2048 -validity 10000 -alias furnicraft
```

Keep that file **out of git** (already covered by `.gitignore`) — losing it means
you can never update the Play Store listing again.

### How it is wired

`mobile/capacitor.config.json` points the WebView at the deployed site:

```json
"server": { "url": "https://furnicraft-3d-t77u.onrender.com" }
```

That choice is deliberate:

* Everything stays **same-origin**, so `/api/*`, the `/landing` and `/admin`
  routes and the SPA fallback behave exactly as they do on the web. A bundled
  build would break all of those (see below).
* The app **updates itself** whenever you deploy — no re-publishing the APK for
  a front-end change.
* The service worker still runs inside the WebView, so the app shell is cached
  and the editor still launches without a connection after the first run.

Trade-offs to know about: the very first launch needs a connection, and a
remote-URL wrapper is a thinner "native app" than a bundled one, which is worth
considering if you submit to the Play Store.

### If you ever want a fully bundled (offline-first) build

Delete the `server.url` line so Capacitor serves `www/` from inside the APK.
Two things then need fixing, because the bundle is static files with no Express
in front of it:

1. **API calls** — the app uses relative `/api/...` paths, which would resolve
   to the local bundle. Add a shim that rewrites them to the absolute backend
   URL when `window.Capacitor.isNativePlatform()` is true. CORS is already
   enabled server-side (`app.use(cors())`) and auth is a Bearer token rather
   than a cookie, so cross-origin calls work.
2. **Extensionless routes** — `/landing` and `/admin` exist only because Express
   maps them; as static files they are `landing.html` and `admin.html`. Those
   redirect targets need rewriting for the native case.

Neither has been implemented, because neither can be tested without an Android
toolchain — do it alongside a real device build.

---

## Security note

The mobile app talks to the **REST API**, never to PostgreSQL directly, and that
is not negotiable. An APK can be unzipped and decompiled, so a bundled database
connection string would hand every user's data to anyone who downloads the app.
All access stays behind `/api/*` with a JWT, exactly like the web client.

## How cross-device sync works

There is no sync engine — projects live server-side and are fetched on demand:

* `POST /api/projects` saves `{ name, state }` against your user id.
* `GET /api/projects` lists them; `GET /api/projects/:id` returns the full state.
* `PUT /api/projects/:id` updates one and appends a version snapshot.

Each device holds its own JWT (`fc3d_token` in localStorage) but they resolve to
the same account, so all devices see the same projects. **Last write wins** — the
app does not merge concurrent edits, so avoid editing the same project on two
devices at once; use the version history to recover if you do.
