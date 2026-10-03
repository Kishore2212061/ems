# EMS — Remaining Implementation Plan (Module by Module)

> **Scope:** everything left to build after Module 1 (Auth).
> **Source of truth for requirements:** [docs/ems-system-documentation.md](docs/ems-system-documentation.md)
> **Last updated:** 2026-10-03

Every module follows the same loop, and a module is **not done** until all five steps pass:

```
 ① Backend  →  ② Frontend  →  ③ Edge-case tests  →  ④ Deploy (Railway)  →  ⑤ Live smoke test
```

---

## Table of Contents

0. [Current State & Carry-over from Module 1](#0-current-state--carry-over-from-module-1)
1. [Conventions (apply to every module)](#1-conventions-apply-to-every-module)
2. [Module 1.5 — Foundations (tests, RBAC core, job queue, audit)](#2-module-15--foundations)
3. [Module 2 — Global Events, Departments & Role Switching](#3-module-2--global-events-departments--role-switching)
4. [Module 3 — Local Event Catalog & Seed Data](#4-module-3--local-event-catalog--seed-data)
5. [Module 4 — Registrations, Teams & Seat Holds](#5-module-4--registrations-teams--seat-holds)
6. [Module 5 — Payments (Razorpay + Pay at Venue)](#6-module-5--payments-razorpay--pay-at-venue)
7. [Module 6 — Tickets & Signed QR](#7-module-6--tickets--signed-qr)
8. [Module 7 — Scanner PWA & Gate Check-in](#8-module-7--scanner-pwa--gate-check-in)
9. [Module 8 — Refunds & Cancellations](#9-module-8--refunds--cancellations)
10. [Module 9 — Analytics, Exports & Live SSE](#10-module-9--analytics-exports--live-sse)
11. [Module 10 — Hardening & Go-Live](#11-module-10--hardening--go-live)
12. [Bundle & Performance Budgets](#12-bundle--performance-budgets)
13. [Effort Estimate & Order of Work](#13-effort-estimate--order-of-work)

---

## 0. Current State & Carry-over from Module 1

### ✅ Built and verified locally
| Area | What exists |
|---|---|
| Backend | NestJS 11 + Fastify, Mongoose 8, zod validation, uniform `{statusCode, code, message, details}` errors, `/api/v1/health` |
| Auth API | `signup`, `login`, `verify-otp`, `resend-otp`, `forgot-password`, `reset-password`, `refresh`, `logout`, `me` |
| Security | argon2id + pepper, HMAC-hashed OTPs (TTL index), login lockout, IP+email throttling, refresh rotation (max 1×/hour) with reuse detection, revoked tokens auto-purged after 1 day, `session_version` revocation, fixed proxy-hop trust |
| Email | Provider-agnostic: `smtp` (Gmail, working), `resend`, `console` |
| Frontend | React 19 + Vite + Tailwind v4 + wouter + zustand. Login, Signup, Verify OTP, Forgot/Reset password, Dashboard. Medium-dark default theme + light toggle, client-side validation, mobile verified at 320 px |
| Deploy prep | Dockerfiles (backend Node 22 alpine, frontend nginx with same-origin `/api` proxy + gzip_static), `railway.json` ×2, `docker-compose.yml`, `backend/.env.railway` (git-ignored) |

### ⏳ Must finish before starting Module 2
| # | Task | Owner |
|---|---|---|
| 1 | Commit the 33 uncommitted changes (redesign, forgot password, refresh tuning) | Claude (on request) |
| 2 | `git push` to `github.com/Kishore2212061/ems` | **You** (push needs your credentials) |
| 3 | Railway: create `backend` + `frontend` services, paste `backend/.env.railway` into Raw Editor, set `BACKEND_URL` on frontend, generate both domains | **You** |
| 4 | Atlas → Network Access → `0.0.0.0/0` | **You** |
| 5 | Set `WEB_BASE_URL` / `CORS_ORIGINS` to the real frontend URL | **You** |
| 6 | Change `SEED_SUPER_ADMIN_EMAIL` from the public `admin@mailsac.com` to a real inbox | **You** |
| 7 | Live smoke test: signup → OTP email → dashboard → reload stays logged in → logout → forgot password | Both |

### Deferred from Module 1 (picked up later in this plan)
| Item | Lands in |
|---|---|
| `POST /auth/switch-role` + role switcher UI | Module 2 |
| Admin invites (`/accept-invite/:token`) | Module 2 |
| Profile edit, change password, active sessions list (`/my/profile`, `/my/security`) | Module 2 |
| Audit log | Module 1.5 |
| Automated tests (none exist yet) | Module 1.5 |
| Mongo-backed rate-limit store (needed only with >1 backend instance) | Module 10 |

---

## 1. Conventions (apply to every module)

### 1.1 Backend folder layout
```
backend/src/<module>/
  <module>.module.ts
  <module>.controller.ts        # thin: validate → call service → return
  <module>.service.ts           # business rules, transactions
  <module>.dto.ts               # zod schemas (request + query)
  schemas/<entity>.schema.ts    # Mongoose schema + indexes + toPublic()
  <module>.service.spec.ts      # unit tests
test/<module>.e2e.spec.ts       # HTTP tests against in-memory Mongo
```

### 1.2 Rules that keep endpoints fast
| Rule | Why |
|---|---|
| Every read uses `.lean()` + an explicit projection | 3–5× less CPU/memory than hydrated documents |
| Every filter/sort pattern has an index, declared in the schema file | No collection scans; verify with `explain()` in tests |
| List endpoints use **cursor pagination** (`?cursor=<lastId>&limit=20`, max 100) | `skip()` gets slower with every page |
| Counters (seats, totals) are **denormalised** and updated with `$inc` | No `count()` on hot paths |
| Multi-document money/seat changes run in a **Mongo transaction** | Atlas is a replica set, so transactions are available |
| Concurrency guard = conditional update (`findOneAndUpdate({_id, status:'X'}, …)`) | Atomic without locks |
| Slow side effects (email, PDFs, gateway refunds, exports) go to the **job queue** | Request stays < 100 ms |
| Amounts are **integer paise** everywhere; formatting only in the UI | No float errors |
| Every money/role/state change writes an **audit log** entry | Traceability |

### 1.3 Error codes
Stable `UPPER_SNAKE` codes per module (e.g. `SEATS_UNAVAILABLE`, `HOLD_EXPIRED`, `TICKET_ALREADY_USED`). The frontend switches on `code`, never on `message`.

### 1.4 Frontend layout
```
frontend/src/
  pages/<surface>/<Page>.tsx     # surfaces: public, my, admin, scan — each lazy-loaded
  components/                    # shared UI (ui.tsx, icons.tsx, AuthLayout, …)
  features/<module>/             # api calls + hooks + module-specific components
  lib/ store/
```
- Every route is `lazy()`. Admin and scanner code must **never** reach the participant bundle.
- No heavy UI libraries. Use the native `<dialog>` for modals, native `<input type="datetime-local">` for dates, and the existing `Field`/`Button` components.
- Only semantic colour tokens (`bg-surface`, `text-muted`, `border-line`, …) so dark/light keep working.
- Test every new screen at **320 px, 768 px and 1440 px**, in both themes.

### 1.5 Definition of Done (per module)
- [ ] All endpoints implemented with zod DTOs, indexes and audit logging where relevant
- [ ] Unit + e2e tests for every edge case in the module's table are green
- [ ] Screens built, mobile-checked, dark + light checked
- [ ] Initial JS for public pages stays within the [budget](#12-bundle--performance-budgets)
- [ ] Deployed to Railway; live smoke test passes; `/api/v1/health` shows the new `version`
- [ ] README module table updated

---

## 2. Module 1.5 — Foundations

**Goal:** the shared building blocks every later module depends on. No new user-facing screens.

### 2.1 Test infrastructure
| Piece | Choice | Notes |
|---|---|---|
| Backend runner | **Vitest** + `@nestjs/testing` | Faster than Jest; TS support built in |
| HTTP tests | Fastify `app.inject()` | No real port needed |
| Database | `mongodb-memory-server` **replica set** | Transactions need a replica set |
| Email in tests | `EMAIL_PROVIDER=console` + capture the dispatcher | Assert OTP sent, read the code |
| Frontend | Vitest + Testing Library | Components and hooks |
| E2E smoke | Playwright (1 browser, CI only) | Signup → OTP → dashboard; run against Docker Compose |
| CI | GitHub Actions: `typecheck → test → build` for both apps on every push | Block merge on failure |

**Backfill Module 1 tests:** signup/login/OTP/lockout/refresh rotation/grace race/reuse detection/reset password/validation, i.e. every path tested by hand so far.

### 2.2 RBAC core
- **Permission matrix** (`backend/src/rbac/permissions.ts`): role → permission list, e.g. `global_event.create`, `local_event.publish`, `registration.read`, `order.refund.approve`, `checkin.scan`.
- `@RequirePermission('local_event.publish')` decorator + `PermissionGuard` read the roles from the JWT (no DB hit).
- `ScopeService.filterFor(user, resource)` returns a Mongo filter (e.g. `{ department_id: { $in: [...] } }`) that every scoped list query is AND-ed with.
- **Invariant:** at least one active `SUPER_ADMIN` always exists (checked in a transaction).
- Role change → `session_version += 1` → old access tokens die within 15 min, refresh fails immediately.

### 2.3 Job queue (MongoDB, no Redis)
Collection `job_queue`:
```ts
{ type, payload, status: 'PENDING'|'RUNNING'|'DONE'|'FAILED',
  run_at, attempts, max_attempts, locked_until, last_error, idempotency_key (unique, sparse), created_at }
```
- Worker runs in-process (`setInterval` 1 s) and claims jobs atomically:
  `findOneAndUpdate({status:'PENDING', run_at:{$lte:now}}, {$set:{status:'RUNNING', locked_until: now+60s}, $inc:{attempts:1}})`
- Retry with exponential backoff (`run_at = now + 2^attempts s`), then `FAILED` + an admin alert.
- Stuck-job recovery: `RUNNING` with `locked_until < now` goes back to `PENDING`.
- Indexes: `{status:1, run_at:1}`, `{idempotency_key:1}` unique sparse, TTL on `DONE` jobs after 7 days.
- Move email sending onto the queue (replacing the in-memory retry) so a restart never drops an OTP.

### 2.4 Audit log
- `audit_logs`: `{actor_id, action, entity, entity_id, before, after, ip, at}`. Append-only; the service exposes no update/delete.
- `AuditService.record()` is called inside the same transaction as the change.
- Index `{entity:1, entity_id:1, at:-1}` and `{actor_id:1, at:-1}`.

### 2.5 Edge cases & tests
| Edge case | Expected behaviour |
|---|---|
| Two workers claim the same job | Only one `findOneAndUpdate` succeeds |
| Server restarts mid-job | Job recovers after `locked_until` and runs again → handlers must be idempotent |
| Same idempotency key enqueued twice | Second insert hits the unique index → treated as success |
| Demoting the last Super Admin | `409 LAST_SUPER_ADMIN` |
| User has no permission | `403 FORBIDDEN` with the required permission in `details` |

---

## 3. Module 2 — Global Events, Departments & Role Switching

**Goal:** Super Admin creates fests (several can be live at once), attaches departments, invites staff with scoped roles. Users with multiple roles switch context without logging out.

### 3.1 Data model
| Collection | Key fields | Indexes |
|---|---|---|
| `department_masters` | `code` (CSE…), `name`, `association_name`, `active` | `code` unique |
| `global_events` | `slug`, `name`, `edition_year`, `type` (TECHNICAL/CULTURAL/HACKATHON), `status` (DRAFT/PUBLISHED/SUSPENDED/COMPLETED/CANCELLED), `starts_at`, `ends_at`, `venue`, `banner_url`, `theme_color`, `suspend_reason`, `version` | `slug` unique, `{status:1, starts_at:1}` |
| `global_event_departments` | `global_event_id`, `department_id`, `coordinators[]` | `{global_event_id:1, department_id:1}` unique |
| `admin_invites` | `email`, `role`, `scope_type`, `scope_id`, `token_hash`, `expires_at` (TTL), `invited_by`, `accepted_at` | `token_hash` unique, TTL |
| `users.roles[]` | already exists | `{'roles.role':1,'roles.scope_id':1}` exists |

### 3.2 API
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/global-events?status=PUBLISHED` | public | Public list; cached 60 s (`Cache-Control`) |
| GET | `/global-events/:slug` | public | With departments |
| POST | `/global-events` | `global_event.create` | Creates DRAFT |
| PATCH | `/global-events/:id` | `global_event.update` | Optimistic lock: body carries `version`; mismatch → `409 STALE_VERSION` |
| POST | `/global-events/:id/publish` | `global_event.publish` | Requires ≥1 department + ≥1 published local event (that check is enforced once Module 3 exists) |
| POST | `/global-events/:id/suspend` · `/reactivate` | `global_event.suspend` | Reason required to suspend |
| POST | `/global-events/:id/clone` | `global_event.create` | Copies structure, new year, DRAFT |
| POST | `/global-events/:id/departments` · DELETE `…/:deptId` | `global_event.update` | Cannot detach a department that has local events |
| CRUD | `/departments` | `department.manage` | Master catalog |
| POST | `/auth/switch-role` | authenticated | Body `{role, scopeType, scopeId}`; must be one of the user's roles → new access token with `ctx` claim |
| POST | `/admin/invites` · GET · DELETE `/:id` · POST `/:id/resend` | `user.invite` | 72 h token, email `AUTH_INVITE_ADMIN` |
| POST | `/auth/accept-invite` | public | `{token, fullName, password}` → creates/updates user, adds role, first-login OTP |
| GET/PATCH | `/me/profile` | authenticated | Edit name, phone, college |
| POST | `/me/change-password` | authenticated | Current password required; bump `session_version` except for the current session |
| GET | `/me/sessions` · DELETE `/me/sessions/:familyId` | authenticated | Lists active refresh families (device, IP, last used) |
| GET | `/admin/users?q=&role=` · PATCH `/admin/users/:id/roles` · POST `/:id/suspend` | `user.manage` | Role changes bump `session_version` |

**Concurrent events:** no "current fest" singleton. Every downstream entity carries `global_event_id`, and every list filters by it.

### 3.3 Frontend
| Route | Screen | Notes |
|---|---|---|
| `/` | Public home: live fests as cards (banner, dates, countdown) | Public bundle; small |
| `/events/:globalSlug` | Fest landing page + department grid | |
| `/admin` | Admin shell: sidebar + topbar + **role switcher** | Lazy `admin` chunk |
| `/admin/events` · `/new` · `/:id` | List, create wizard (3 steps: basics → dates/venue → departments), control centre | Status badges, publish/suspend actions with confirm `<dialog>` |
| `/admin/settings/departments` | Department master editor | |
| `/admin/users` · `/invite` | User directory + role assignment, invite form | |
| `/accept-invite/:token` | Set name + password → OTP | Reuse AuthLayout |
| `/my/profile` · `/my/security` | Edit profile, change password, sessions with "sign out this device" | |

**Role switcher:** a pill in the topbar ("CSE Admin ▾"). Choosing a role calls `switch-role`, swaps the access token, resets cached data and navigates to that role's home (`/admin`, `/scan`, `/my/dashboard`). The choice is kept in `sessionStorage`.

**Data fetching:** add **TanStack Query** here (~13 KB gz, loaded only in authenticated chunks), giving caching, invalidation after mutations and request de-duplication.

### 3.4 Edge cases & tests
| Edge case | Expected behaviour |
|---|---|
| Two fests PUBLISHED with overlapping dates | Allowed; both appear on `/`, data never mixes |
| Two admins edit the same fest | Second save → `409 STALE_VERSION`; UI shows "reload to see latest" |
| Publish with zero departments | `422 PUBLISH_REQUIREMENTS` with the missing items in `details` |
| Duplicate slug (`nec-techfest-2025`) | `409 SLUG_TAKEN`; UI suggests `-2` |
| Detach a department that has local events | `409 DEPARTMENT_IN_USE` |
| Switch to a role the user doesn't have | `403 ROLE_NOT_ASSIGNED` |
| Role revoked while the user is logged in | Next refresh fails (`SESSION_REVOKED`); UI returns to login |
| Invite to an email that already has an account | Role is added to the existing user; no duplicate account |
| Expired / reused invite | `410 INVITE_EXPIRED` / `409 INVITE_USED` |
| Scoped admin (CSE) requests MECH data by ID | `404` (scope filter hides it, so existence isn't leaked) |
| Change password | Every other session signed out; current one stays |

### 3.5 Deploy check
Create *Tech Fest '25* and a second test fest, publish both and check both on `/`. Invite a CSE admin and accept on a phone. Switch between Super Admin and CSE Admin.

---

## 4. Module 3 — Local Event Catalog & Seed Data

**Goal:** departments author registerable events (Blind Coding, Hackathon …). The public can browse and filter them. Seed real Tech Fest '25 data.

### 4.1 Data model — `local_events`
```ts
{ global_event_id, department_id, slug, name, category: 'TECHNICAL'|'NON_TECHNICAL'|'WORKSHOP'|'HACKATHON',
  description_md, rules_md, status: 'DRAFT'|'PUBLISHED'|'SUSPENDED'|'CANCELLED'|'COMPLETED',
  participation: 'INDIVIDUAL'|'TEAM', team_min, team_max,
  pricing: { type: 'FREE'|'PAID', unit_price_paise, per: 'MEMBER'|'TEAM', modes: ['ONLINE','OFFLINE'] },
  price_version,                      // bumps on price change; registrations snapshot it
  seats_total, seats_confirmed, seats_held,   // denormalised counters
  registration_opens_at, registration_closes_at, starts_at, ends_at,
  venue: { name, lat, lng, geo_policy: 'OFF'|'WARN'|'MANDATORY', radius_m },
  refund_window_hours, coordinators: [{name, phone, role}], banner_url, version }
```
Indexes: `{global_event_id:1, department_id:1, status:1}`, `{global_event_id:1, slug:1}` unique, `{global_event_id:1, category:1, starts_at:1}`, text index on `name`+`description_md` for search.

Also `local_event_templates`: reusable blueprints (copy fields on create).

### 4.2 API
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/local-events?globalEventId=&dept=&category=&free=&q=&cursor=` | public | Published only for the public; projection without `rules_md` |
| GET | `/local-events/:id` | public | Full detail + `seats_left` |
| POST/PATCH | `/local-events` · `/:id` | `local_event.manage` (dept-scoped) | Optimistic `version` |
| POST | `/:id/publish` · `/suspend` · `/complete` | `local_event.publish` | Validates dates, seats, pricing |
| POST | `/:id/clone` | `local_event.manage` | |
| CLI | `npm run seed:techfest` | — | Imports `seed/techfest-2025.json` idempotently (upsert by slug) |

**Seed data:** run the scraping prompt from the system docs §13.2 against `techfestnec.vercel.app`, save the result to `backend/seed/techfest-2025.json`, review it by hand, and commit it.

### 4.3 Frontend
| Route | Screen |
|---|---|
| `/events` | Directory: fest tabs, department chips, category filter, "free only" toggle, search (debounced 300 ms), infinite scroll |
| `/events/:globalSlug/:deptSlug` | Department events |
| `/events/:globalSlug/:deptSlug/:eventSlug` | Detail: banner, rules (rendered markdown, sanitised), seats-left bar, price, team size, venue map link, **Register** CTA (opens in Module 4) |
| `/admin/events/:id/local/new` · `/:localId` | Authoring studio in tabs: Basics · Schedule · Pricing · Seats & Team · Venue & Geo · Rules · Coordinators |

- Markdown renders with a tiny renderer (e.g. `marked` ~12 KB, lazy, only on the detail page) and is **sanitised on the server** at save time.
- Images: Cloudinary upload widget is heavy. Use a signed direct upload (`POST /media/sign`) with a plain `<input type=file>`, and serve `f_auto,q_auto,w_<n>` URLs.

### 4.4 Edge cases & tests
| Edge case | Expected behaviour |
|---|---|
| Reduce `seats_total` below `seats_confirmed + seats_held` | `409 CAPACITY_BELOW_BOOKED` |
| Change price after registrations exist | Allowed; `price_version++`; existing registrations keep their snapshot |
| FREE → PAID with registrations | Existing stay free; new ones pay |
| `team_min > team_max`, or INDIVIDUAL with team sizes ≠ 1 | `400 VALIDATION_ERROR` |
| `registration_closes_at` after `starts_at` | `400` |
| Publish while the parent fest is DRAFT | Allowed, but not visible publicly until the fest is published |
| Event time edited after registrations | Queue `EVENT_TIME_CHANGED` emails to all registrants |
| HTML/script in description | Stripped by the server sanitiser |
| Seed script run twice | No duplicates (upsert by `{global_event_id, slug}`) |
| Search with special regex chars | Use `$text` (not regex), so no ReDoS |

---

## 5. Module 4 — Registrations, Teams & Seat Holds

**Goal:** a participant picks an event, enters self/team details and gets a **10-minute seat hold**, without overbooking under concurrency. No Redis.

### 5.1 Seat-hold design (MongoDB only)
```
Register click
  └─ findOneAndUpdate(
       { _id: eventId, status:'PUBLISHED',
         $expr: { $lte: [ { $add: ['$seats_confirmed','$seats_held', n] }, '$seats_total' ] } },
       { $inc: { seats_held: n } })                 ← atomic, cannot oversell
  └─ insert seat_holds { local_event_id, registration_id, seats:n, status:'HELD', expires_at: now+10m }
```
- **Release** (payment failed, abandoned, cancelled): `seat_holds` `HELD → RELEASED` via conditional update, **then** `$inc seats_held: -n`. The conditional update guarantees it happens once.
- **Confirm** (paid or free): `HELD → CONSUMED`, `$inc { seats_held:-n, seats_confirmed:+n }`, in one transaction.
- **Expiry sweeper** (job every 30 s): finds `HELD` with `expires_at < now` and releases each one. ⚠️ A TTL index alone would delete the hold **without** giving the seats back; TTL is only for cleanup 7 days later.
- **Lazy safety:** the availability shown to the user subtracts holds that have expired but not yet been swept.

### 5.2 Data model
| Collection | Key fields | Indexes |
|---|---|---|
| `registrations` | `code` (REG-XXXX), `global_event_id`, `local_event_id`, `leader_user_id`, `type` (INDIVIDUAL/TEAM), `team_name`, `status` (DRAFT/PAYMENT_PENDING/CONFIRMED/CANCELLED/REFUNDED/EXPIRED), `price_snapshot`, `payment_mode`, `hold_id`, `version` | `code` unique, `{leader_user_id:1, created_at:-1}`, `{local_event_id:1, status:1}` |
| `registration_members` | `registration_id`, `local_event_id`, `email`, `name`, `phone`, `college`, `roll_no`, `user_id?`, `claim_token_hash`, `status` | **partial unique** `{local_event_id:1, email:1}` where `status ∈ [ACTIVE]` |
| `seat_holds` | as above | `{status:1, expires_at:1}`, TTL on `expires_at` + 7 d |

### 5.3 API
| Method | Path | Notes |
|---|---|---|
| POST | `/registrations` | `{localEventId, members[], teamName?, paymentMode}` → validates window, team size, duplicates → hold → `{registration, holdExpiresAt}`. **Idempotency-Key header** required (stops double click / retry) |
| GET | `/registrations/my?status=` | Participant list |
| GET | `/registrations/:code` | Leader or a member only |
| POST | `/registrations/:code/cancel` | Before payment → release hold. After payment → Module 8 refund request |
| POST | `/registrations/claim` | `{token}` — teammate links their account to their member seat |
| FREE events | — | Skips payment: confirm immediately, tickets issued (Module 6) |

### 5.4 Frontend
| Route | Screen |
|---|---|
| Event detail → **Register** | Bottom sheet on mobile / `<dialog>` on desktop: Step 1 members (leader prefilled, "+ Add teammate" up to `team_max`), Step 2 payment mode, Step 3 review |
| `/checkout/:regCode` | Countdown timer (hold), fee breakdown, Pay button (Module 5) |
| `/my/registrations` | Tabs: Upcoming / Pending payment / Past / Cancelled |
| `/claim/:token` | Teammate claim screen |

### 5.5 Edge cases & tests (concurrency tests are mandatory)
| Edge case | Expected behaviour |
|---|---|
| 50 parallel requests for the last 1 seat | Exactly 1 succeeds; 49 get `409 SEATS_UNAVAILABLE` (test with `Promise.all`) |
| Double click on Register | Same `Idempotency-Key` returns the first result; no second hold |
| Tab abandoned on checkout | Sweeper releases within ≤ 30 s after 10 min; seats reappear |
| Pay after the hold expired | `410 HOLD_EXPIRED`; if seats are still free, re-hold automatically in the same request |
| Teammate email already in another team for this event | `409 MEMBER_ALREADY_REGISTERED` with the email |
| Same person twice in one team | `400 DUPLICATE_MEMBER` |
| Team size outside `team_min..team_max` | `400` |
| Registration window closed / not yet open | `403 REGISTRATION_CLOSED` / `REGISTRATION_NOT_OPEN` |
| Event suspended mid-checkout | Payment step blocked; hold released |
| Two overlapping events across different fests | Allowed; UI shows a time-conflict warning (if enabled in settings) |
| Server crash between `$inc` and the hold insert | Transaction prevents a stranded counter; a nightly reconcile job recomputes `seats_held` from `seat_holds` |
| Teammate claims with someone else's logged-in account | Allowed only if the emails match; otherwise `403 CLAIM_EMAIL_MISMATCH` |

---

## 6. Module 5 — Payments (Razorpay + Pay at Venue)

**Goal:** correct paise math with GST, Razorpay checkout, webhook-safe finalisation, and offline pay-at-venue.

### 6.1 Fee engine
`calculateOrderBreakdown()` from the system docs §6, as a pure function in `backend/src/payments/fees.ts`, with **property tests** (random inputs: total = parts, no negatives, CGST+SGST = GST).

### 6.2 Data model
| Collection | Key fields | Indexes |
|---|---|---|
| `fee_settings` | `gst_bps`, `platform_fee_bps`, `platform_fee_flat_paise`, `fee_bearer`, `org_state_code` | singleton per org |
| `orders` | `code` (ORD-…, also the Razorpay `receipt`), `registration_id`, `global_event_id`, `breakdown{base, platform_fee, gst, cgst, sgst, igst, total}`, `status` (CREATED/PAID/FAILED/EXPIRED/REFUNDED/PARTIALLY_REFUNDED), `mode` (ONLINE/OFFLINE), `rzp_order_id`, `rzp_payment_id`, `paid_at`, `collected_by?` | `code` unique, `rzp_order_id` unique sparse, `{global_event_id:1, status:1, paid_at:-1}` |
| `payment_transactions` | raw gateway payloads, signature-verified flag | `{order_id:1}` |
| `webhook_events` | `provider_event_id` **unique**, `type`, `processed_at` | unique index = idempotency |

### 6.3 API
| Method | Path | Notes |
|---|---|---|
| POST | `/orders` | `{registrationCode}` → computes the breakdown **server-side** → creates the Razorpay order (amount in paise, `receipt=order.code`) → returns `{orderId, rzpOrderId, amount, keyId}`. If an open order already exists for the registration, return it |
| POST | `/orders/:code/verify` | `{razorpay_payment_id, razorpay_order_id, razorpay_signature}` → `HMAC_SHA256(order_id|payment_id, key_secret)` constant-time compare → **finalise()** |
| POST | `/webhooks/razorpay` | Verifies `X-Razorpay-Signature` over the **raw body** → insert `webhook_events` (duplicate → 200 and stop) → `payment.captured` → **finalise()**; `payment.failed` → mark FAILED |
| POST | `/orders/:code/collect-offline` | Scanner/finance only; `{amountPaise}` must equal total; records `collected_by` |
| GET | `/orders/my` · `/orders/:code/invoice.pdf` | Invoice PDF generated by a job, cached |

**`finalise(order)`** (shared by verify + webhook, idempotent): one transaction. Order `CREATED → PAID` (conditional) → registration `CONFIRMED` → hold `CONSUMED` + counters → enqueue `ISSUE_TICKETS` + `SEND_CONFIRMATION`. If the order is already PAID, return the existing state.

⚠️ **Fastify raw body:** register a content-type parser that keeps `rawBody` for the webhook route only. Signature checks fail if computed over re-serialised JSON.

### 6.4 Frontend
- Load Razorpay `checkout.js` **only on the checkout page** (dynamic `<script>`), not in the bundle.
- `/checkout/:regCode`: breakdown table (Base / Platform fee / CGST / SGST / Total), hold countdown, Pay button → Razorpay modal → call `verify` → `/checkout/:regCode/status`.
- Status page polls `GET /orders/:code` every 2 s (max 60 s) in case the webhook arrives first or the verify call failed.
- `/my/orders`: history + invoice download.
- Admin: `/admin/orders` (filters: fest, status, mode, date) and `/admin/settings/fees`.

### 6.5 Edge cases & tests
| Edge case | Expected behaviour |
|---|---|
| Webhook arrives before the browser calls verify | Webhook finalises; verify sees PAID and returns success (idempotent) |
| Same webhook delivered 3 times | Unique `provider_event_id` → processed once |
| Client tampers with the amount | Impossible: the amount comes only from the server breakdown; verify also checks the gateway amount = `total` |
| Forged signature | `400 SIGNATURE_INVALID`, logged, no state change |
| User pays twice (bank app lag) | Second payment on a PAID order → auto-refund job + alert |
| Payment succeeds after the hold expired | Seats still free → confirm. Event full → auto full refund + `SEATS_GONE_REFUNDED` email |
| User closes the Razorpay modal | Order stays CREATED; can retry until the hold expires |
| Interstate participant | IGST instead of CGST+SGST (state from college/profile) |
| ₹0 total (free) | No gateway call; confirm directly |
| Offline amount ≠ total | `400 AMOUNT_MISMATCH` |
| Rounding | Property test: `base + fee + gst === total` for 10 000 random inputs |
| Razorpay API down | `503 GATEWAY_UNAVAILABLE`, hold kept, user can retry |

**Testing payments:** use Razorpay **test mode** keys and test cards/UPI. Webhooks locally via `ngrok`/`cloudflared` or by POSTing recorded payloads with a computed signature in e2e tests.

---

## 7. Module 6 — Tickets & Signed QR

**Goal:** one ticket per member, a signed single-use QR, emailed and viewable in the app.

### 7.1 Data model — `tickets`
`{ code (TCK-XXXX-XX, Crockford base32), registration_id, member_id, user_id?, global_event_id, local_event_id, status: 'ACTIVE'|'PAYMENT_PENDING'|'USED'|'VOID', jti, kid, used_at, used_by_device, issued_at }`
Indexes: `code` unique, `jti` unique, `{local_event_id:1, status:1}`, `{user_id:1, issued_at:-1}`.

### 7.2 Design
- QR payload = compact **JWT HS256** `{sub: ticketId, le: localEventId, jti, exp: event_end+12h}` with a `kid` header (`QR_SIGNING_KID`), so keys can be rotated.
- Issuing runs as a **job** (`ISSUE_TICKETS`): idempotent per member (unique `{registration_id, member_id}`).
- QR image:
  - **In app:** rendered client-side with a tiny QR encoder (`qrcode-generator` ~5 KB, lazy, ticket page only). No image download.
  - **In email:** PNG generated server-side (`qrcode` package) and embedded as a CID attachment, so it shows even when the inbox blocks remote images.
- Pay-at-venue registrations get tickets with status `PAYMENT_PENDING` (the scanner collects cash).
- Public verify page `/verify/:code` shows only the event, holder initials and status, never PII.

### 7.3 API
| Method | Path | Notes |
|---|---|---|
| GET | `/tickets/my` | List |
| GET | `/tickets/:code` | Owner only; includes the signed QR token |
| POST | `/tickets/:code/resend` | Rate-limited 3/hour |
| GET | `/verify/:code` | Public, minimal |

### 7.4 Frontend
- `/my/tickets/:code`: full-screen ticket card (same visual language as the login-page ticket), QR at max size, Wake Lock API to keep the screen on, and a hint to raise brightness (browsers can't change it themselves).
- Ticket list in the dashboard (replacing the "No registrations yet" empty state).
- Add to Home Screen prompt for quick access at the gate.

### 7.5 Edge cases & tests
| Edge case | Expected behaviour |
|---|---|
| `ISSUE_TICKETS` job runs twice | Unique index → no duplicate tickets |
| Member edits email after issue | Resend goes to the new email; QR unchanged |
| Signing key rotated | Old tickets still verify (`kid` lookup keeps old keys until the event ends) |
| Forged/edited QR | Signature fails → scanner shows `INVALID_TICKET` |
| Event time changes | `exp` recomputed on next fetch; scan still checks the server ledger |
| Registration refunded | All its tickets → `VOID` |

---

## 8. Module 7 — Scanner PWA & Gate Check-in

**Goal:** fast, offline-tolerant gate scanning on volunteers' phones, with cash collection and geofencing.

### 8.1 Data model — `check_ins`
`{ ticket_id, local_event_id, operator_id, device_id, scanned_at, synced_at, result, lat, lng, distance_m, offline: bool }`
Index `{local_event_id:1, scanned_at:-1}`, `{ticket_id:1}`.

### 8.2 API
| Method | Path | Notes |
|---|---|---|
| POST | `/checkins/scan` | `{qrToken, localEventId, lat?, lng?, deviceId}` → verify JWT → event match → geofence → atomic `ACTIVE → USED` |
| POST | `/checkins/lookup` | `{q}` by phone / email / ticket code (scoped to the event) |
| POST | `/checkins/sync` | Batch of offline scans, each with its client `scanned_at`; processed in timestamp order |
| POST | `/orders/:code/collect-offline` | From Module 5, used by the Collect Cash modal |
| GET | `/checkins/shift-summary` | Count + cash collected by this operator today |

**Scan outcomes** (stable codes): `OK`, `PAYMENT_DUE` (+ amount), `ALREADY_USED` (+ when / which device), `WRONG_EVENT` (+ correct event name), `INVALID_TICKET`, `VOID_TICKET`, `OUT_OF_GEOFENCE` (+ distance), `NOT_YET_OPEN` (before `CHECKIN_OPEN_BEFORE_MINUTES`).

### 8.3 Frontend (separate `scan` chunk, PWA)
- **Camera:** use the native `BarcodeDetector` API (Chrome/Android: 0 KB). Fall back to a lazy-loaded worker-based decoder (`qr-scanner` ~16 KB gz) on iOS. **Avoid `html5-qrcode`** (~300 KB).
- `/scan`: pick fest → event (only events the operator is scoped to) → camera permission check.
- `/scan/:eventId`: full-screen camera, big result flash (green/amber/red) + vibration + sound, auto-ready for the next scan in 1.5 s.
- Collect Cash modal for `PAYMENT_DUE`: amount, "Received ₹X" confirm → `collect-offline` → admit.
- **Offline queue:** if offline, verify the JWT signature locally? ❌ No: the secret must never ship to the client. Instead, **queue the scan in IndexedDB** (`idb-keyval` ~600 B) and show amber "Saved offline, will sync". Sync on `online` events + every 15 s.
- Service worker (hand-written, ~2 KB): caches the scanner shell so `/scan` opens without network.
- Geolocation requested once per session with an explanation screen.

### 8.4 Edge cases & tests
| Edge case | Expected behaviour |
|---|---|
| Same QR scanned on 2 phones at the same moment | Atomic update → one `OK`, one `ALREADY_USED` |
| Screenshot shared with a friend | Second scan → `ALREADY_USED` with time + device; scanner shows the holder's name for an ID check |
| Wi-Fi drops at the gate | Scans queue offline; sync later; conflicts (already used online elsewhere) reported in `/scan/offline-queue` |
| Offline scans synced out of order | Server sorts by client `scanned_at`; first wins |
| Operator outside the geofence (MANDATORY) | `OUT_OF_GEOFENCE` with distance; Super Admin override flag per event |
| GPS unavailable / denied | MANDATORY → blocked with a clear message; WARN → allowed + flagged |
| Operator scoped to CSE scans a MECH ticket | `WRONG_EVENT` |
| Cash collected but network fails before confirm | Retry is idempotent (`collect-offline` on an already-PAID order returns success) |
| iOS Safari camera quirks | Test on a real iPhone; HTTPS is required (Railway provides it) |
| Scanning before check-in opens | `NOT_YET_OPEN` with the opening time |

---

## 9. Module 8 — Refunds & Cancellations

**Goal:** participant refund requests with approval, and automatic mass refunds when an event is cancelled.

### 9.1 Data model
| Collection | Key fields |
|---|---|
| `refund_requests` | `registration_id`, `reason`, `status` (PENDING/APPROVED/REJECTED/PROCESSED), `decided_by`, `decided_at` |
| `refund_batches` | `scope` (GLOBAL_EVENT/LOCAL_EVENT), `scope_id`, `status` (RUNNING/PAUSED/COMPLETED), `total`, `succeeded`, `failed`, `started_by` |
| `refund_transactions` | `order_id`, `batch_id?`, `request_id?`, `amount_paise`, `rzp_refund_id`, `status` (QUEUED/PROCESSING/SUCCEEDED/FAILED), `failure_code`, `idempotency_key` (unique) |

### 9.2 Flows
- **Participant request:** allowed until `starts_at − refund_window_hours`. Finance approves → `REFUND_ORDER` job.
- **Event cancel** (Super Admin for fests, Admin for local events): event → `CANCELLED` → create `refund_batch` → enqueue one `REFUND_ORDER` job per PAID online order → offline/cash orders listed for manual refund → tickets `VOID` → emails `EVENT_CANCELLED_REFUND_INITIATED`.
- **`REFUND_ORDER` job:** rate-limited to 5/s globally, `razorpay.payments.refund(paymentId, {amount, speed, receipt: idempotency_key})`, then updates the transaction + order. The `refund.processed` / `refund.failed` webhooks finalise the status.
- **Insufficient balance** error: mark `GATEWAY_INSUFFICIENT_FUNDS`, pause the batch, alert finance; a "Resume batch" button re-queues the failed items.

### 9.3 API
`POST /registrations/:code/refund-request` · `GET /admin/refunds?status=` · `POST /admin/refunds/:id/approve|reject` · `POST /global-events/:id/cancel` · `POST /local-events/:id/cancel` (both require typing the event name to confirm, plus step-up OTP) · `GET /admin/refunds/batches/:id` · `POST /admin/refunds/batches/:id/resume`

### 9.4 Frontend
`/my/refunds` (status tracker) · `/admin/refunds` (approval queue) · `/admin/refunds/batches` (progress bars; live via SSE in Module 9) · cancel dialogs with the type-to-confirm pattern.

### 9.5 Edge cases & tests
| Edge case | Expected behaviour |
|---|---|
| Refund job retried after a timeout | Same idempotency key → Razorpay returns the existing refund; no double refund |
| Cancel an event with 500 paid orders | Batch completes under the rate limit; progress visible; no 429 storm |
| Partial refunds (platform fee non-refundable policy) | Amount computed from `fee_settings`; tested |
| Refund request after the window | `403 REFUND_WINDOW_CLOSED` |
| Cancel an already-cancelled event | `409 ALREADY_CANCELLED` |
| Cash-paid orders in a cancelled event | Listed as "manual refund needed"; marked refunded by finance with a note |
| Refund of a ticket already USED | Blocked unless Super Admin overrides |
| Webhook says refund failed after success was shown | Status reverts to FAILED; finance alerted |

---

## 10. Module 9 — Analytics, Exports & Live SSE

**Goal:** live dashboards, year-over-year comparisons and CSV exports without slow queries.

### 10.1 Design
- **Pre-aggregated counters:** `daily_stats {global_event_id, local_event_id, date, registrations, revenue_paise, checkins}` updated with `$inc` when each event happens (registration confirmed, check-in, refund). Dashboards read these small docs instead of aggregating millions of rows.
- **Heavy reports** (top colleges, conversion funnel, GST summary) run as aggregation pipelines **in jobs** and are cached for 5 minutes in `report_cache`.
- **SSE:** `GET /sse/dashboard?globalEventId=`, `/sse/checkins/:eventId`, `/sse/refund-batch/:id`. In-process event bus → `reply.raw.write()`. Heartbeat comment every 20 s.
  ⚠️ nginx must not buffer SSE: add a `location /api/v1/sse/` block with `proxy_buffering off; proxy_read_timeout 1h;`.
  ⚠️ With more than 1 backend instance, use MongoDB **change streams** as the bus (Atlas supports them).
- **CSV exports:** `export_jobs` → worker streams a Mongo cursor → CSV → Cloudinary raw upload (or GridFS) → signed link, expires in 7 days. PII masked unless the user has `participant.pii.export`. Watermark row with the requester and time.

### 10.2 API
`GET /reports/overview?globalEventId=` · `/reports/colleges` · `/reports/revenue?from=&to=` (GST breakdown) · `/reports/yoy?slugBase=techfest` · `POST /exports` · `GET /exports/:id` · SSE routes above.

### 10.3 Frontend
`/admin` dashboard (KPI tiles + sparkline + live check-in counter) · `/admin/analytics/*` · `/admin/exports` · `/admin/checkins` live feed.
Charts: hand-rolled SVG sparklines and bars (a few KB) rather than a chart library; consider uPlot (~45 KB, lazy) only if more is needed.

### 10.4 Edge cases & tests
| Edge case | Expected behaviour |
|---|---|
| SSE client disconnects | Listener removed (no memory leak); test 1 000 connect/disconnect cycles |
| Railway proxy idle timeout | Heartbeat keeps the connection alive; client `EventSource` auto-reconnects |
| Counter drift (crash between write and `$inc`) | Nightly reconcile job recomputes `daily_stats` from source collections |
| Export of 50 000 rows | Streamed; memory stays flat; done in < 30 s |
| Finance requests a PII export without permission | Masked columns |
| Timezone | All "daily" buckets use `Asia/Kolkata` (`SEED_TIMEZONE`), not UTC |

---

## 11. Module 10 — Hardening & Go-Live

| Area | Tasks |
|---|---|
| Secrets | Rotate everything that appeared in chat/docs: Mongo password, Gmail app password, Resend, Razorpay, Cloudinary, JWT secrets. New `PASSWORD_PEPPER` (requires clearing test users) |
| Email | Verify a real domain in Resend (`nec.edu.in` or own domain) → `EMAIL_PROVIDER=resend`, SPF/DKIM/DMARC |
| Scale-out | If >1 backend replica: Mongo-backed throttler store, change-stream SSE bus, separate worker service for the job queue |
| Security | CSP header in nginx, dependency audit in CI, rate limits reviewed per endpoint, step-up OTP for sensitive actions, pen-test checklist |
| Backups | Atlas continuous backup / daily snapshot; test a restore once |
| Monitoring | Railway metrics + uptime ping on `/api/v1/health`; error alerts (Sentry free tier, lazy-loaded on the frontend) |
| Load test | k6: 500 concurrent registrations on one event, 100 scans/min at one gate; p95 < 300 ms |
| Privacy | Terms + privacy page, consent checkbox at signup, account deletion (anonymise), data export (DPDP Act) |
| Final E2E | The 12-point checklist in the system docs §19 on production |

---

## 12. Bundle & Performance Budgets

| Surface | Initial JS (gzip) | Notes |
|---|---|---|
| Public pages (`/`, `/events/*`) | **≤ 95 KB** | React 68 KB + router/store/app shell; currently ~80 KB |
| Auth pages | ≤ 95 KB | Currently ~82 KB |
| Participant portal (`/my/*`) | +≤ 30 KB lazy | Includes TanStack Query |
| Admin console (`/admin/*`) | +≤ 70 KB lazy | Never loaded by participants |
| Scanner (`/scan/*`) | +≤ 40 KB lazy | Native BarcodeDetector; fallback decoder lazy |
| CSS | ≤ 15 KB gz | Single Tailwind file; currently ~11 KB |
| Font | 27 KB woff2 (Latin, 1 file) | Already in place |

| API | Target (p95, Railway) |
|---|---|
| Auth (excluding argon2 time) | < 50 ms |
| Public lists (cached) | < 80 ms |
| Register (hold) | < 150 ms |
| Scan | < 120 ms |

Add a CI step that fails the build if any budget is exceeded (`vite build` output parsed by a small script).

---

## 13. Effort Estimate & Order of Work

| Order | Module | Est. effort* | Depends on |
|---|---|---|---|
| 0 | Finish Module 1 deploy (§0) | 0.5 day | — |
| 1 | **1.5 Foundations** (tests, RBAC, job queue, audit) | 2–3 days | 0 |
| 2 | **2 Global events, departments, roles, invites, profile** | 4–5 days | 1.5 |
| 3 | **3 Local events + seed** | 3–4 days | 2 |
| 4 | **4 Registrations + seat holds** | 4–5 days | 3 |
| 5 | **5 Payments** | 4–5 days | 4 |
| 6 | **6 Tickets + QR** | 2–3 days | 5 |
| 7 | **7 Scanner PWA** | 4–5 days | 6 |
| 8 | **8 Refunds** | 3–4 days | 5, 6 |
| 9 | **9 Analytics + exports + SSE** | 3–4 days | 4–8 |
| 10 | **10 Hardening & go-live** | 3 days | all |

\* Focused working days for one developer pairing with Claude; real calendar time depends on review and testing availability.

**Recommended next step:** finish §0 (deploy Module 1 live), then start **Module 1.5**. Test infrastructure first, so every later module ships with its edge-case tests from day one.
