# FurniCraft 3D

A full-stack 3D woodworking & furniture designer. Design panel-based
furniture in the browser, get auto-generated cut sheets and assembly
guides, export to PDF, and save your projects to your account in the cloud.

- **Frontend** — single-page Three.js app (`public/index.html`)
- **Backend** — Node + Express REST API (`server/`)
- **Database** — PostgreSQL (users + projects)
- **Auth** — email/password (bcrypt + JWT), Google Sign-In, email OTP verification

---

## Quick start (local)

### 1. Prerequisites
- [Node.js](https://nodejs.org) 18 or newer
- [PostgreSQL](https://www.postgresql.org/download/) running locally

### 2. Create a database
```bash
createdb furnicraft
# or via psql:  CREATE DATABASE furnicraft;
```

### 3. Configure environment
```bash
cp .env.example .env
```
Edit `.env` and set at minimum:
```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/furnicraft
DATABASE_SSL=false
JWT_SECRET=<paste a long random string>
```
Generate a secret quickly:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 4. Install & run
```bash
npm install
npm start          # production
npm run dev        # auto-reload during development (nodemon)
```
Open <http://localhost:3000>.

The tables (`users`, `projects`, `otp_codes`) are created automatically on
first start. You can also create them manually with `npm run initdb`.

> **No email server?** Registration still works in **DEV mode** — the
> 6-digit verification code is shown in the UI instead of being emailed.

---

## Deploy to Render

This repo includes `render.yaml`, so the whole stack deploys as a blueprint.

1. Push the repo to GitHub.
2. In Render: **New → Blueprint** and select the repo.
3. Render creates the Postgres database and the web service, wiring
   `DATABASE_URL` and generating `JWT_SECRET` automatically.
4. (Optional) In the service's **Environment** tab, fill in
   `GOOGLE_CLIENT_ID` and the `SMTP_*` values to enable Google Sign-In and
   real verification emails.

`DATABASE_SSL` is preset to `true` for Render's managed Postgres.

---

## Deploy to your own server / VPS

1. Install Node 18+ and PostgreSQL.
2. Clone the repo and create a `.env` (see local setup above). Use a strong
   `JWT_SECRET` and your production `DATABASE_URL`.
3. Install and start behind a process manager:
   ```bash
   npm install --omit=dev
   npm install -g pm2
   pm2 start server/index.js --name furnicraft
   pm2 save
   ```
4. Put it behind a reverse proxy (nginx/Caddy) with HTTPS. Proxy all traffic
   to the app's port; everything (frontend + `/api`) is served by the one
   Node process.

---

## Optional features

### Google Sign-In
1. Create an **OAuth 2.0 Client ID** (Web application) at
   <https://console.cloud.google.com>.
2. Add your site's origin to **Authorized JavaScript origins**
   (e.g. `http://localhost:3000` and your production URL).
3. Set `GOOGLE_CLIENT_ID` in `.env` (or the Render dashboard) and restart.

### Email OTP delivery
Set the `SMTP_*` variables. For Gmail, create an
[App Password](https://myaccount.google.com/apppasswords) and use:
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
```

### AI Furniture Designer
The **✦ AI Design** tool calls the Anthropic API directly from the browser
using a key the user supplies in the UI (stored locally, never sent to this
server). If the browser blocks the call (CORS), it falls back to a copy-paste
"Manual Mode". No server configuration is required.

---

## API reference

All responses are JSON. Authenticated routes require an
`Authorization: Bearer <token>` header.

| Method | Path                  | Auth | Purpose                              |
|--------|-----------------------|------|--------------------------------------|
| GET    | `/api/health`         | —    | Service + DB status                  |
| GET    | `/api/auth/config`    | —    | Which auth methods are enabled       |
| POST   | `/api/auth/register`  | —    | Validate + send OTP                  |
| POST   | `/api/auth/verify`    | —    | Confirm OTP, create account          |
| POST   | `/api/auth/login`     | —    | Email/password login                 |
| POST   | `/api/auth/google`    | —    | Verify Google ID token               |
| GET    | `/api/auth/me`        | ✓    | Current user                         |
| GET    | `/api/projects`       | ✓    | List your projects                   |
| POST   | `/api/projects`       | ✓    | Create a project                     |
| GET    | `/api/projects/:id`   | ✓    | Load a project (with full state)     |
| PUT    | `/api/projects/:id`   | ✓    | Update name and/or state             |
| DELETE | `/api/projects/:id`   | ✓    | Delete a project                     |

---

## Project structure
```
.
├── public/
│   └── index.html        # the entire 3D frontend
├── server/
│   ├── index.js          # Express app: serves frontend + mounts API
│   ├── db.js             # Postgres pool + schema bootstrap
│   ├── middleware/auth.js# JWT guard
│   ├── routes/
│   │   ├── auth.js       # register / verify / login / google / me
│   │   └── projects.js   # projects CRUD
│   ├── utils/
│   │   ├── jwt.js        # sign / verify tokens
│   │   └── email.js      # OTP delivery (nodemailer)
│   └── scripts/initdb.js # one-off schema setup
├── render.yaml           # Render blueprint (web service + Postgres)
├── .env.example          # configuration template
└── package.json
```
