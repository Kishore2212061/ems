# NEC Events — Event Management & Ticketing System

Monorepo: `backend/` (NestJS 11 + Fastify + MongoDB) and `frontend/` (React 19 + Vite + Tailwind v4).
Full system design: [docs/ems-system-documentation.md](docs/ems-system-documentation.md).
Remaining work, module by module: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Module status

| # | Module | Status |
|---|--------|--------|
| 1 | Auth — signup, first-login email OTP, login, refresh rotation, logout | ✅ |
| 1.5 | Foundations: tests (104), permissions, audit log, job queue, shared UI, CI | ✅ |
| 2 | Fests, departments, people & roles, invites, profile/security, admin console | ✅ |
| 3 | Department events: catalogue, search, authoring, Tech Fest '25 seed (123 events) | ✅ |
| 4 | Registrations: day-wise schedule, teams, no time clashes, seat holds, organiser view | ✅ |
| 5 | Payments: Razorpay checkout + webhook, fee/GST engine, pay at the desk, refunds on late payment, finance view | ✅ |
| 6 | Tickets: one per member, signed QR in the app and in emails, full-screen pass, public verify | ✅ |
| 7 | Gate check-in in the web app: camera QR scanning, payment at the gate, manual lookup, live counts | ✅ |
| 8 | Refunds: requests + finance approval, automatic refunds when an event or fest is cancelled, cash hand-backs, batch progress | ✅ |
| 9 | Analytics: live dashboard (KPIs vs last edition, per-day, departments, top events, colleges), CSV exports | ✅ |

## Architecture (Module 1)

```
Browser ──► frontend (nginx) ──/api/*──► backend (NestJS/Fastify) ──► MongoDB Atlas
            static SPA + same-origin proxy                       └──► Email (Resend / SMTP)
```

The SPA and API share one origin, so the refresh cookie is first-party (`HttpOnly; Secure; SameSite=Strict`)
and there's no CORS in production.

## Auth API (`/api/v1/auth`)

| Method | Path | Notes |
|---|---|---|
| POST | `/signup` | Creates participant → `{ otpRequired, otpToken, email, resendAfterSec }` |
| POST | `/login` | Password ok + first login → OTP challenge; else `{ accessToken, expiresIn, user }` + refresh cookie |
| POST | `/verify-otp` | `{ otpToken, code }` → session |
| POST | `/resend-otp` | `{ otpToken }` — 60 s cooldown, 3 per 10 min |
| POST | `/refresh` | Rotates refresh cookie → `{ accessToken, expiresIn, user }` |
| POST | `/logout` | Revokes the session family |
| GET | `/me` | Bearer token required |
| GET | `/api/v1/health` | Liveness + DB status |

Errors are always `{ statusCode, code, message, details? }`.

## Local development

Requires Node 20+ (`nvm use 22`).

```bash
cd backend && cp .env.example .env   # fill MONGODB_URI + secrets
npm install && npm run dev           # http://localhost:4000/api/v1/health
```

```bash
cd frontend && npm install && npm run dev   # http://localhost:5173 (proxies /api → :4000)
```

With `EMAIL_PROVIDER=console`, OTP emails are printed in the backend log.

Load the real NEC Tech Fest '25 catalogue (123 events) into the database from `.env` — safe to run again, it never overwrites edits:

```bash
cd backend && npm run build && npm run seed:techfest
```

Publish the upcoming edition as a **live fest** (the same 123 events on next March's Friday + Saturday, registration open, and a mix of free / pay-online / pay-at-the-desk entry):

```bash
cd backend && npm run build && npm run seed:live
```

### Tests

```bash
cd backend && npm test      # 229 e2e/unit tests; uses a local mongod if installed, else downloads one
```

```bash
cd frontend && npm test && npm run build && npm run check:bundle   # 80 tests + gzip budget gate
```

CI (`.github/workflows/ci.yml`) runs typecheck → test → build (+ bundle budget) for both apps on every push.

### Full stack in Docker (mirrors Railway)

```bash
docker compose up --build    # http://localhost:8080
```

## Deploying to Railway

One project, two services from this repo:

| Service | Root directory | Variables |
|---|---|---|
| `backend` | `/backend` | everything in `backend/.env.example`, plus `PORT=4000`, `TRUST_PROXY_HOPS=2`, `NODE_ENV=staging` |
| `frontend` | `/frontend` | `BACKEND_URL=http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:4000` |

Generate a public domain for `frontend` (the app). The backend's public domain is optional (useful for health checks).
MongoDB Atlas → Network Access must allow `0.0.0.0/0`, since Railway egress IPs are dynamic.
