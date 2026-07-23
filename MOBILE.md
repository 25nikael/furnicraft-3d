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

### How it is wired — offline-first, bundled (R61)

`mobile/capacitor.config.json` has **no `server.url`**, so Capacitor serves the
whole app from inside the APK (`https://localhost`). The editor launches with no
connection at all — the 3D libraries are bundled too (see below). Only *cloud
projects* need the network, which is the correct model: you can design offline
and save/load when you're online.

Three pieces make this work:

1. **Self-hosted libraries.** Three.js, its exporters and jsPDF now live in
   `public/vendor/` and load from `/vendor/*` instead of a CDN. Without this a
   "bundled" app would still fail to boot offline, because the editor can't run
   without Three.js. (Bonus: the web app no longer depends on a CDN staying up.)
2. **`public/native-bridge.js`** — loaded first on every page. It detects the
   bundled-native case (Capacitor native **and** origin ≠ the backend) and then:
   * rewrites `/api/*` fetches to the absolute backend URL (CORS is enabled
     server-side and auth is a Bearer token, so cross-origin is fine);
   * maps the extensionless routes `/landing` and `/admin` to `landing.html` /
     `admin.html` via `window.fcHref()`, since there's no Express in the bundle;
   * skips the service worker (assets are already local).
   On the normal web and in a remote-URL build it is a **strict no-op**.
3. **`server.url` removed** from the Capacitor config.

Trade-off vs. the remote-URL approach: a front-end change now needs an APK
rebuild + reinstall to reach installed users (the web PWA still updates itself).
If you'd rather have auto-updating and don't need true offline, add
`"server": { "url": "https://furnicraft-3d-t77u.onrender.com" }` back — the
bridge deactivates automatically (origin becomes the backend).

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
