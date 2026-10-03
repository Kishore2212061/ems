# NEC Events — Event Management & Ticketing System

Monorepo: `backend/` (NestJS 11 + Fastify + MongoDB) and `frontend/` (React 19 + Vite + Tailwind v4).
Full system design: [docs/ems-system-documentation.md](docs/ems-system-documentation.md).

## Module status

| # | Module | Status |
|---|--------|--------|
| 1 | Auth — signup, first-login email OTP, login, refresh rotation, logout | ✅ |
| 2 | Global events & multi-role switching | ⏳ |

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
