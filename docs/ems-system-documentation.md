# Event Management & Ticketing System (EMS) — Complete System Documentation

> **Organization:** National Engineering College (NEC), Kovilpatti  
> **Version:** 2.0 — MongoDB Adapted, Multi-Role & Multi-Global-Event Architecture  
> **Date:** 2026-10-03  
> **Reference Repository:** EMS Implementation Plan (local)  
> **Seed Source Website:** https://techfestnec.vercel.app/ (NEC Tech Fest '25)  

---

## Table of Contents

1. [Executive Summary & Core Principles](#1-executive-summary--core-principles)
2. [Architecture & Technology Stack (MongoDB Adapted)](#2-architecture--technology-stack-mongodb-adapted)
3. [Multi-Global-Event & Multi-Role Domain Model](#3-multi-global-event--multi-role-domain-model)
   - 3.1 Concurrent Global Events Architecture
   - 3.2 Multi-Role User Model & Role Switching
4. [Role-Based System Workflows](#4-role-based-system-workflows)
   - 4.1 Super Admin (Full Platform Owner)
   - 4.2 Admin (Scoped to Global Event or Department)
   - 4.3 Finance Operator
   - 4.4 Scanner Operator (Door Check-in & Offline Cash)
   - 4.5 Participant & Team Leader (8-Stage Lifecycle)
5. [State Machines & Lifecycle Rules](#5-state-machines--lifecycle-rules)
6. [Payment, Fee & GST Engine (Paise Math)](#6-payment-fee--gst-engine-paise-math)
7. [Refund & Cancellation System](#7-refund--cancellation-system)
8. [Ticketing & QR Code Engine](#8-ticketing--qr-code-engine)
9. [Gate Check-in & Scanner System](#9-gate-check-in--scanner-system)
10. [Email & Notification System (24 Templates)](#10-email--notification-system-24-templates)
11. [Reports, Analytics & Live SSE](#11-reports-analytics--live-sse)
12. [MongoDB Data Model (All 30 Collections)](#12-mongodb-data-model-all-30-collections)
13. [Default Seed Data & TechFest 2025 Scraping Prompt](#13-default-seed-data--techfest-2025-scraping-prompt)
14. [Complete Environment Variables Setup](#14-complete-environment-variables-setup)
15. [Complete API Endpoints Inventory](#15-complete-api-endpoints-inventory)
16. [Module-by-Module Deployment Strategy (Railway First)](#16-module-by-module-deployment-strategy-railway-first)
17. [Module-by-Module Edge Cases & Mitigations Matrix](#17-module-by-module-edge-cases--mitigations-matrix)
18. [Screen Inventory (68 Screens across 4 Surfaces)](#18-screen-inventory-68-screens-across-4-surfaces)
19. [Deployment Verification & End-to-End Checklist](#19-deployment-verification--end-to-end-checklist)

---

## 1. Executive Summary & Core Principles

### What Is This System?
A production-grade, multi-tenant Event Management & Ticketing platform designed for engineering colleges and universities. It handles technical symposiums, national conferences, hackathons, and cultural fests from draft authoring through dynamic registration, online/offline fee collection, signed QR ticketing, geo-fenced gate check-in, automated refund batches, and year-over-year analytics.

### Key Architectural Highlights
1. **Multiple Concurrent Active Global Events:** Supports running 2 or more major global events simultaneously (e.g., *NEC Tech Fest 2025* and *NEC Cultural Fest 2025* or *National Hackathon*). Registrations, quotas, departments, and financial streams remain strictly segregated or unified as needed.
2. **Multiple Roles per User:** A single user identity can hold multiple roles (e.g. a Faculty Admin for CSE, a Scanner Volunteer for MECH, and a Participant in an Open Hackathon). Users can seamlessly toggle active role contexts in the UI without re-authenticating.
3. **MongoDB + Mongoose Core:** Replaces PostgreSQL/Prisma with a scalable document model using MongoDB transactions, optimistic concurrency control (`version` fields), and partial unique indexes.
4. **Single SPA, 4 Surfaces:** 68 screens delivered via one modern React 19 SPA with lazy-loaded route boundaries (Public Site, Participant Portal, Admin Console, and Scanner PWA).
5. **Incremental Module Deployment (Railway First):** Module 1 (Auth & User Profile) is deployed first to Railway to establish live URLs, configure CORS, and test session cookies before layering downstream event, payment, and ticketing modules.

---

## 2. Architecture & Technology Stack (MongoDB Adapted)

### System Topology Diagram

```
                        ┌──────────────────────────────────────────────────┐
   Public Browsers ───► │            SINGLE REACT 19 SPA (Vite)            │
   Admins / HODs   ───► │  Role-based routing, Context Switcher, Zustand  │
   Scanner PWAs    ───► │  TanStack Query v5, Radix UI, Lucide, html5-qrcode│
                        └────────────────────────┬─────────────────────────┘
                                                 │ HTTPS (Bearer JWT / Refresh Cookie)
                                                 │ Server-Sent Events (SSE)
                                                 ▼
                        ┌──────────────────────────────────────────────────┐
                        │             NESTJS 11 BACKEND MONOLITH           │
                        │  Modules: Auth, Events, Regs, Orders, Tickets    │
                        │  Checkin, Refunds, Reports, SSE, Audit           │
                        ├────────────────────────┬─────────────────────────┤
                        │  MongoDB 7 (Atlas)     │  Redis 7 (BullMQ)       │
                        │  Mongoose 8 ODM        │  Queue, Cache, Mutexes  │
                        └───────────┬────────────┴─────────────┬───────────┘
                                    │                          │
                   ┌────────────────┴───────────┐  ┌───────────┴───────────┐
                   ▼                            ▼  ▼                       ▼
            ┌──────────────┐             ┌──────────────┐           ┌──────────────┐
            │ Razorpay     │             │ Resend API   │           │ Cloudinary   │
            │ Payments &   │             │ 24 Email     │           │ Banners & QR │
            │ Auto-Refunds │             │ Templates    │           │ Code PNGs    │
            └──────────────┘             └──────────────┘           └──────────────┘
```

### Technology Matrix

| Component | Technology Choice | Why / Adaptation Notes |
|---|---|---|
| **Backend Framework** | NestJS 11 (Node.js 20 LTS) | Strict modular architecture, TypeScript decorators, built-in validation pipes |
| **Database** | **MongoDB 7+ (Mongoose 8)** | Replaces PostgreSQL. Uses document nesting for audit snapshots and transactions for seat holds |
| **Caching & Queues** | Redis 7 + BullMQ | Handles ticket generation, email blasts, CSV exports, and gateway reconciliation |
| **Frontend Framework** | React 19 + TypeScript (Vite) | Lightning fast HMR, small bundle footprint, single SPA hosting all 4 surfaces |
| **State & Query** | Zustand + TanStack Query v5 | Zustand for multi-role session state; TanStack Query for cache invalidation |
| **Payment Gateway** | Razorpay (Standard Checkout) | HMAC SHA256 webhook verification, instant refunds, UPI/cards/netbanking |
| **Transactional Email**| Resend API | Modern developer-first email delivery with high inbox deliverability |
| **Asset Storage** | Cloudinary | Auto-transforms banners, creates responsive image formats, hosts signed QR PNGs |
| **Hosting Platform** | Railway | Native Docker deployment, managed Redis & MongoDB connection, automatic SSL |

---

## 3. Multi-Global-Event & Multi-Role Domain Model

### 3.1 Concurrent Global Events Architecture
A college frequently operates more than one global fest simultaneously or overlaps preparation and live execution windows.

```
                           Organization (NEC)
                                    │
       ┌────────────────────────────┴─────────────────────────────┐
       ▼                                                          ▼
Global Event A:                                          Global Event B:
"NEC TECH FEST 2025" (Technical)                         "SPANDANA 2025" (Cultural)
Status: PUBLISHED (Live)                                 Status: PUBLISHED (Live)
Dates: Mar 14-15, 2025                                   Dates: Mar 14-16, 2025
Departments: CSE, IT, ECE, EEE...                        Departments: Dance, Music, Fine Arts...
Local Events: 108+ (Blind Coding, Hackathons)            Local Events: 45+ (Battle of Bands, Choreonite)
```

#### Multi-Active Global Event Rules:
1. **Isolated Hierarchies:** Every `DepartmentAttachment`, `LocalEvent`, `Registration`, `Order`, `Ticket`, and `RefundBatch` contains a mandatory `global_event_id` reference.
2. **Public Portal Routing:** The public landing page lists all currently `PUBLISHED` global events. Users can browse `/events/nec-techfest-2025` or `/events/spandana-2025`.
3. **Cart & Registration Segregation:** A participant can register for events across different global fests, but each order is scoped to a specific global fest to keep finance books and GST invoicing strictly partitioned.
4. **Time Conflict Detection:** If enabled in college settings, the system warns participants if two local events across different global events share overlapping time slots on the same day.

---

### 3.2 Multi-Role User Model & Role Switching

A user account is identified by a single email address, but can possess **multiple concurrent roles** across different scopes:

```
                                  User Account
                       (john.doe@nec.edu.in / ID: u_101)
                                      │
       ┌──────────────────────────────┼──────────────────────────────┐
       ▼                              ▼                              ▼
Role: SUPER_ADMIN             Role: ADMIN                     Role: SCANNER
Scope: ORG (National Engg)     Scope: DEPARTMENT               Scope: LOCAL_EVENT
Can manage college settings    ScopeId: dept_cse               ScopeId: le_blind_coding
and financial policies         Can manage CSE events           Can scan tickets at entrance
```

#### Roles Definition & Scoping Hierarchy:

| Role Enum | Valid Scopes | Capabilities |
|---|---|---|
| `SUPER_ADMIN` | `ORG` | Full system control, financial tax settings, cancel events, issue bulk refunds, manage all users |
| `ADMIN` | `ORG`, `GLOBAL_EVENT`, `DEPARTMENT` | Create & manage local events, approve manual check-ins, view event registrations and rosters |
| `FINANCE` | `ORG`, `GLOBAL_EVENT` | View orders, generate GST reports, audit offline cash collections, approve refund requests |
| `SCANNER` | `GLOBAL_EVENT`, `LOCAL_EVENT` | Operate camera scanner PWA, search attendee list, collect offline cash at entrance |
| `PARTICIPANT`| `GLOBAL` | Register for events, create/join teams, access signed QR tickets, request refunds |

#### Multi-Role Database Schema (MongoDB):
```typescript
// Embedded in User or referenced in user_roles collection:
interface IUserRole {
  role: 'SUPER_ADMIN' | 'ADMIN' | 'FINANCE' | 'SCANNER' | 'PARTICIPANT';
  scope_type: 'ORG' | 'GLOBAL_EVENT' | 'DEPARTMENT' | 'LOCAL_EVENT';
  scope_id?: mongoose.Types.ObjectId; // null if scope_type is ORG or PARTICIPANT
  granted_at: Date;
  granted_by: mongoose.Types.ObjectId;
}

// User Document
const UserSchema = new Schema({
  email: { type: String, required: true, unique: true, index: true },
  password_hash: { type: String, required: true },
  full_name: { type: String, required: true },
  roles: [UserRoleSchema], // Array of assigned roles
  active_role_context: {  // Default selected role on login
    role: { type: String, default: 'PARTICIPANT' },
    scope_type: { type: String, default: 'ORG' },
    scope_id: { type: Schema.Types.ObjectId, default: null }
  },
  first_login_otp_done: { type: Boolean, default: false },
  status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' }
});
```

#### UI Role Switcher Experience:
When a user has more than 1 role assigned, the top-right navigation bar renders an active role pill with an instant Switcher Dropdown:
- **Switch Context:** Clicking *“Switch to Scanner (Blind Coding)”* or *“Switch to CSE Admin”* immediately updates Zustand session state, swaps navigation menus, and scopes TanStack Query caches without forcing a logout.
- **Permission Guard:** The backend JWT contains an array of all active role tuples `[{ role, scopeType, scopeId }]`. Route guards evaluate whether any active role satisfies the required action.

---

## 4. Role-Based System Workflows

### 4.1 Super Admin (Full Platform Owner)
- **Journey 0 (Activation):** Receives invite email → Sets strong password → Enters first-time OTP → Dashboard unlocked (`first_login_otp_done: true`). Future logins require only email + password.
- **Journey 1 (Platform Setup):** Configures college GSTIN, platform fee bearer (Participant vs Organizer), Razorpay API keys, and master department directory.
- **Journey 2 (Multi-Global-Event Orchestration):** Creates and publishes *Tech Fest '25* and *Spandana '25*. Monitors cross-fest registration numbers and server health.
- **Journey 3 (Terminal Actions):** Only Super Admin can initiate event **Cancellation**. Doing so generates an automated `RefundBatch` that queues full refunds for all online transactions.

### 4.2 Admin (Scoped to Global Event or Department)
- **Local Event Management:** Creates sub-events under assigned department (e.g. CSE → Blind Coding Challenge).
- **Seat Allocation & Rules:** Sets capacity quotas, registration fees, team size bounds (min 2, max 4), venue room numbers, and geo-fence check-in toggles.
- **Roster & Attendance:** Views attendee table, exports CSV rosters for faculty coordinators, and reviews manual check-in requests.

### 4.3 Finance Operator
- **Revenue Audits:** Monitors real-time payments across Razorpay online gateway and offline cash counters.
- **Offline Cash Reconciliation:** Verifies cash collected by scanner operators during physical door check-in before closing operator shifts.
- **GST Invoicing:** Downloads monthly GSTR-1 summaries broken down by 9% CGST + 9% SGST (or 18% IGST for out-of-state participants).

### 4.4 Scanner Operator (Door Check-in & Offline Cash)
- **Fast Event Selection:** Opens PWA at `/scan` → Selects active Global Event and assigned local event.
- **Camera Scanning:** Scans attendee's single-use dynamic QR code via rear camera.
- **Offline Payment Handling:** If attendee's ticket is `PAYMENT_PENDING` (opted to pay at venue), the scanner UI launches the **Collect Cash Modal**, confirms receipt of ₹200, updates order status to `PAID`, and admits the attendee in one step.
- **Offline Queue Sync:** Scans are queued in IndexedDB if campus Wi-Fi drops and auto-synced with the server upon reconnection.

### 4.5 Participant & Team Leader (8-Stage Lifecycle)
1. **Discovery:** Discovers events on public landing page filtered by Global Fest, Department, or Type (Technical/Non-Tech/Workshop).
2. **Registration & Hold:** Selects event → Enters attendee or teammate details → 10-minute seat hold lock acquired in Redis.
3. **Checkout:** Pays via Razorpay UPI/Cards or chooses "Pay at Venue" (if enabled for the event).
4. **Instant Ticketing:** Confirmation screen displays ticket code; Resend dispatches signed QR code email to all members.
5. **Team Leader Hub:** Team leader can invite members via email or share claim links; members claim tickets into their personal accounts.
6. **Venue Arrival:** Presents QR ticket on smartphone screen at the department venue door.
7. **Check-in Confirmation:** Scanner acknowledges green checkmark; ticket transitions to `USED`.
8. **Feedback & Certificate:** Following event conclusion, attendee downloads verified participation certificate.

---

## 5. State Machines & Lifecycle Rules

### 5.1 Global Event Lifecycle

```
            ┌──────────────┐
            │    DRAFT     │
            └──────┬───────┘
                   │ Admin clicks "Publish" (requires ≥1 dept + ≥1 local event)
                   ▼
            ┌──────────────┐ ◄─── Admin reactivates
            │  PUBLISHED   │ ───► Admin suspends (e.g. venue repair)
            └──────┬───────┘ ───► (No refunds issued; tickets remain valid)
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
  ┌─────────────┐     ┌──────────────┐
  │  COMPLETED  │     │  CANCELLED   │ ◄─── SUPER ADMIN ONLY (Terminal)
  └─────────────┘     └──────┬───────┘
                             │ Automatically triggers RefundBatch
                             ▼
                      All online registrations refunded
```

### 5.2 Local Event Lifecycle
- `DRAFT`: Authoring stage. Not visible to the public.
- `PUBLISHED`: Open for public browsing and registrations (subject to registration open/close timestamps).
- `SUSPENDED`: Temporarily hides register button; existing tickets remain valid.
- `CANCELLED`: Terminal state. Triggers auto-refund of all registrations for this specific local event.
- `COMPLETED`: Event time has passed; certificates unlocked.

### 5.3 Registration & Order Lifecycle

```
  [User clicks Register] ──► DRAFT (10-min Redis Seat Hold)
                                │
             ┌──────────────────┴──────────────────┐
             ▼ (Online Gateway)                    ▼ (Offline Pay-at-Venue)
      ORDER_CREATED                         PAYMENT_PENDING
             │                                     │
    (Payment Successful)                    (Cash Collected at Door)
             ▼                                     ▼
         CONFIRMED ◄───────────────────────────────┘
             │
      (Event Cancelled or Refund Approved)
             ▼
         REFUNDED
```

---

## 6. Payment, Fee & GST Engine (Paise Math)

> [!CRITICAL]
> All monetary calculations inside EMS are performed exclusively in **integer paise** to avoid IEEE-754 floating-point inaccuracies. Conversion to Rupee (₹) happens purely at the final UI rendering boundary.

### Fee Calculation Algorithm

```typescript
// Pure integer mathematics for fee & tax calculation
interface FeeInput {
  unitPricePaise: number;
  quantity: number;
  platformFeeBps: number; // e.g. 200 = 2%
  platformFeeFlatPaise: number;
  gstRateBps: number;     // e.g. 1800 = 18%
  feeBearer: 'PARTICIPANT' | 'ORGANIZER';
  isInterstate: boolean;
}

export function calculateOrderBreakdown(input: FeeInput) {
  const baseAmountPaise = input.unitPricePaise * input.quantity;
  
  if (baseAmountPaise === 0) {
    return { baseAmountPaise: 0, platformFeePaise: 0, gstPaise: 0, totalPaise: 0 };
  }

  // 1. Calculate Platform Fee
  const variableFeePaise = Math.round((baseAmountPaise * input.platformFeeBps) / 10000);
  const totalPlatformFeePaise = variableFeePaise + input.platformFeeFlatPaise;

  // 2. Calculate GST (Applied to Base + Platform Fee)
  const taxableAmountPaise = baseAmountPaise + totalPlatformFeePaise;
  const totalGstPaise = Math.round((taxableAmountPaise * input.gstRateBps) / 10000);

  // 3. Tax Breakdown
  const cgstPaise = input.isInterstate ? 0 : Math.round(totalGstPaise / 2);
  const sgstPaise = input.isInterstate ? 0 : (totalGstPaise - cgstPaise);
  const igstPaise = input.isInterstate ? totalGstPaise : 0;

  // 4. Final Total Paid by Participant
  const totalPayablePaise = input.feeBearer === 'PARTICIPANT'
    ? baseAmountPaise + totalPlatformFeePaise + totalGstPaise
    : baseAmountPaise;

  return {
    baseAmountPaise,
    platformFeePaise: totalPlatformFeePaise,
    gstPaise: totalGstPaise,
    gstBreakup: { cgstPaise, sgstPaise, igstPaise },
    totalPaise: totalPayablePaise
  };
}
```

### Worked Real-World Example (Registration of 1 Team = 4 Members @ ₹100/member)
- Base Amount: 4 × ₹100 = **40,000 paise** (₹400.00)
- Platform Fee (2%): **800 paise** (₹8.00)
- Taxable Subtotal: 40,800 paise
- GST (18%): **7,344 paise** (₹73.44) → CGST: 3,672 paise (₹36.72), SGST: 3,672 paise (₹36.72)
- **Total Paid by Student:** **48,144 paise** (₹481.44)

---

## 7. Refund & Cancellation System

### 1. Automatic Refund on Event Cancellation
- If a Super Admin cancels a Global Event or an Admin cancels a Local Event:
  - System creates a `RefundBatch` document.
  - A BullMQ worker iterates through all `CONFIRMED` orders paid via Razorpay.
  - Calls `razorpay.payments.refund(paymentId, { amount: refundablePaise })`.
  - Dispatches `TICKET_REFUNDED` notification emails.
  - Automatically invalidates (`VOID`) all corresponding tickets.

### 2. Manual Participant Refund Requests
- Participant submits request before the event's `refund_window_hours` deadline.
- Request appears in `/admin/refunds` queue for Finance/Super Admin approval.
- Upon approval, the gateway refund executes asynchronously with idempotency keys.

---

## 8. Ticketing & QR Code Engine

### QR Code Token Structure
Each ticket generates a digitally signed JWT token encoded into the QR code image:

```json
{
  "iss": "ems.nec.edu.in",
  "sub": "tck_65f8a12bc9e",
  "gid": "gev_techfest_2025",
  "lid": "lev_blind_coding",
  "jti": "550e8400-e29b-41d4-a716-446655440000",
  "exp": 1742054400
}
```

### Key Security Properties:
1. **HMAC SHA-256 Signature:** Prevents forgery. Scanner apps verify signature using public key or shared secret.
2. **Single-Use Check:** The `jti` and `tck_id` are checked in MongoDB using atomic conditional update:
   ```typescript
   const updated = await Ticket.findOneAndUpdate(
     { _id: ticketId, status: 'ACTIVE' },
     { $set: { status: 'USED', used_at: new Date() } }
   );
   if (!updated) throw new ConflictException('ALREADY_CHECKED_IN');
   ```
3. **Brightness Boost:** Mobile participant ticket screen automatically triggers full screen brightness when displaying QR.

---

## 9. Gate Check-in & Scanner System

### Scanner Operator Flow
1. **PWA Launch:** Scanner volunteer accesses `/scan` on mobile Chrome/Safari.
2. **Select Scope:** Selects current active Global Event (*NEC Tech Fest 2025*) and Department/Local Event (*CSE - Blind Coding*).
3. **Geo-Fence Validation:**
   - If event policy is `MANDATORY`, scanner device GPS must fall within `geo_radius_m` (default 150m) of venue coordinates.
   - If outside radius, scan rejects with `OUT_OF_GEOFENCE` error unless Super Admin override is granted.
4. **Scan Outcomes:**
   - 🟢 **SUCCESS:** Green flash, attendee name and college displayed.
   - 🟡 **PAYMENT DUE:** Attendee chosen "Pay at Venue" → Modal opens with exact cash due amount.
   - 🔴 **ALREADY USED:** Shows exact timestamp and scanner device where previously checked in.
   - 🔴 **WRONG EVENT:** Ticket belongs to a different symposium event or department.

---

## 10. Email & Notification System (24 Templates)

Powered by **Resend** with React email templates and WYSIWYG editing in Admin console.

### Key Templates:
1. `AUTH_INVITE_ADMIN`: Invitation to faculty with role and scope link.
2. `AUTH_FIRST_TIME_OTP`: 6-digit verification code for new staff/students.
3. `AUTH_PASSWORD_RESET`: Secure password reset link.
4. `TICKET_CONFIRMATION_INDIVIDUAL`: Ticket code, event timings, venue map, and signed QR code.
5. `TICKET_CONFIRMATION_TEAM_LEADER`: Summary order invoice + master ticket list.
6. `TICKET_TEAM_MEMBER_INVITE`: Link for teammate to claim individual ticket into their account.
7. `EVENT_TIME_CHANGED`: High-priority alert sent to all registered attendees.
8. `EVENT_CANCELLED_REFUND_INITIATED`: Notification detailing refund transaction ID and bank credit SLA.

---

## 11. Reports, Analytics & Live SSE

### Live Server-Sent Events (SSE) Channels
- `/api/v1/sse/dashboard`: Stream of registration counts, revenue totals, and seat utilization percentages.
- `/api/v1/sse/checkins/:eventId`: Real-time entrance gate scan feed with attendee names and entrance speeds.
- `/api/v1/sse/refund-batch/:batchId`: Live progress bar of automated Razorpay refunds.

### Year-over-Year Comparative Analytics
- Compares *Tech Fest '25* against *Tech Fest '24* and *Tech Fest '23*.
- Identifies highest-grossing events, top participating external colleges, and peak registration hours.

---

## 12. MongoDB Data Model (All 30 Collections)

```
1.  organizations               - Master college tenant configuration & branding
2.  fee_settings                - Org-level GST %, platform fee %, and bearer rules
3.  users                       - Identity, password hashes, profile, first_login_otp_done
4.  user_roles                  - Multi-role bindings (user_id × role × scope_type × scope_id)
5.  admin_invites               - Pending administrative onboarding invites
6.  refresh_tokens              - Rotating JWT session tokens with IP/Device fingerprint
7.  otp_codes                   - 6-digit hashes with 10-minute expiry & rate limit counters
8.  department_masters          - Reusable college department catalog (CSE, IT, ECE, MECH...)
9.  global_events               - Annual editions (Tech Fest '25, Spandana '25) [Supports concurrent]
10. global_event_departments    - Global event to Department association bridge
11. local_event_templates       - Reusable sub-event blueprints (e.g. Paper Presentation)
12. local_events                - Registerable units (Blind Coding, Hackathon, Robot Sumo...)
13. registrations               - Header record for individual or team booking
14. registration_members        - Per-attendee details (name, roll no, college, ticket link)
15. tickets                     - Signed QR code references, status (ACTIVE, USED, VOID)
16. check_ins                   - Audit record of physical gate scan with GPS coords
17. orders                      - Financial ledger (base, fee, GST, Razorpay order id)
18. payment_transactions        - Gateway payment receipts & webhook payload captures
19. refund_batches              - Mass refund orchestration jobs on event cancellation
20. refund_requests             - Participant-submitted refund applications
21. refund_transactions         - Outbound gateway refund execution records
22. webhook_events              - Razorpay idempotency log preventing duplicate webhook processing
23. email_templates             - Customizable templates with HTML & subject line
24. email_template_versions     - History of edits made to email templates
25. email_logs                  - Dispatch audit with delivery status from Resend
26. audit_logs                  - Append-only security audit log of all administrative actions
27. export_jobs                 - Background CSV export generation tracker
28. media_assets                - Cloudinary image metadata & CDN URLs
29. notifications               - In-app notification alerts for users
30. seat_holds                  - Ephemeral 10-minute inventory locks during checkout
```

---

## 13. Default Seed Data & TechFest 2025 Scraping Prompt

### 13.1 Real Data Source: NEC Tech Fest '25
The seed data for the initial deployment is extracted directly from NEC's official technical symposium website:  
**URL:** `https://techfestnec.vercel.app/`

#### Key Facts to Ingest:
- **Global Event:** NEC TECH FEST '25 (A National Level Technical Symposium)
- **Institution:** National Engineering College, K.R. Nagar, Kovilpatti - 628503
- **Dates:** 14th & 15th March 2025
- **Official Contact:** techfest@nec.edu.in
- **Departments (Associations):**
  - CSE: Computer Science & Engineering Association
  - IT: Information Technology Association
  - ECE: Electronics & Communication Engineering Association
  - EEE: Electrical & Electronics Engineering Association
  - MECH: Mechanical Engineering Association
  - CIVIL: Civil Engineering Association
  - AIDS: Artificial Intelligence & Data Science Association
  - MBA: Management Studies Association
  - S&H: Science & Humanities Association

---

### 13.2 Executable Scraping Prompt (Attach to LLM/Scraper)

To regenerate or enrich the database with exact live sub-events, feed this prompt to an automated web browser or AI scraping agent:

```markdown
You are a web scraping specialist. Your task is to scrape all event and department data from the NEC Tech Fest website: https://techfestnec.vercel.app/

Target Routes:
1. https://techfestnec.vercel.app/events/technical (All pages of technical events)
2. https://techfestnec.vercel.app/events/non-tech (All pages of non-technical events)
3. https://techfestnec.vercel.app/events/workshops (All pages of workshops)
4. https://techfestnec.vercel.app/ideathon (Special flagship event)
5. Detail pages: https://techfestnec.vercel.app/associations/event/[EVENT_ID]

For every event discovered, extract the following schema and output a clean JSON array:
{
  "name": string,              // e.g., "Blind Coding Challenge", "SQL Treasure Hunt"
  "department_code": string,    // "CSE", "IT", "ECE", "EEE", "MECH", "CIVIL", "AIDS", "MBA", "COMMON"
  "category": string,           // "TECHNICAL", "NON_TECHNICAL", "WORKSHOP", "HACKATHON"
  "participation_type": string, // "INDIVIDUAL" or "TEAM"
  "team_min_size": number,      // default 1 for individual, 2+ for team
  "team_max_size": number,      // default 1 for individual, max team size
  "pricing_type": string,       // "FREE" or "PAID"
  "price_paise": number,        // e.g. 15000 for ₹150 (0 if free)
  "payment_modes": string[],    // ["ONLINE", "OFFLINE"] or ["FREE"]
  "venue_name": string,         // e.g., "IT Lab 3", "Auditorium", "Mechanical Seminar Hall"
  "description": string,        // Full event rules and overview text
  "coordinators": [
    { "name": string, "phone": string, "role": "STUDENT" | "FACULTY" }
  ]
}

Format output directly into a Mongoose seed script `seed-events.json` compatible with the EMS MongoDB schema.
```

---

## 14. Complete Environment Variables Setup

### Backend `.env`
```bash
# ── Core Server ───────────────────────────────────────────
NODE_ENV=production
PORT=4000
API_BASE_URL=https://ems-backend-production.up.railway.app
WEB_BASE_URL=https://ems-frontend-production.up.railway.app
CORS_ORIGINS=https://ems-frontend-production.up.railway.app,http://localhost:5173
LOG_LEVEL=info

# ── Database (MongoDB Atlas) ─────────────────────────────
MONGODB_URI=<set-in-railway>

# ── Cache & Queues (Redis) ───────────────────────────────
REDIS_URL=<set-in-railway>
REDIS_PREFIX=ems:prod
BULLMQ_PREFIX=ems:queue

# ── Security & Authentication ────────────────────────────
JWT_ACCESS_SECRET=<set-in-railway>
JWT_ACCESS_TTL=15m
JWT_REFRESH_SECRET=<set-in-railway>
JWT_REFRESH_TTL=30d
PASSWORD_PEPPER=<set-in-railway>
OTP_LENGTH=6
OTP_TTL_MINUTES=10
OTP_MAX_ATTEMPTS=5
OTP_RESEND_COOLDOWN_SECONDS=60
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCK_MINUTES=15
INVITE_TTL_HOURS=72
CLAIM_TOKEN_TTL_DAYS=30

# ── QR & Ticket Security ─────────────────────────────────
QR_SIGNING_SECRET=<set-in-railway>
QR_SIGNING_KID=k1
TICKET_CODE_PREFIX=TCK

# ── Payments (Razorpay) ──────────────────────────────────
PAYMENT_PROVIDER=razorpay
RAZORPAY_KEY_ID=<set-in-railway>
RAZORPAY_KEY_SECRET=<set-in-railway>
RAZORPAY_WEBHOOK_SECRET=<set-in-railway>
CHECKOUT_HOLD_MINUTES=10
REFUND_SPEED=normal

# ── Default Fee Engine ───────────────────────────────────
DEFAULT_GST_BPS=1800                  # 18.00%
DEFAULT_PLATFORM_FEE_BPS=200          # 2.00%
DEFAULT_PLATFORM_FEE_FLAT_PAISE=0
DEFAULT_FEE_BEARER=PARTICIPANT

# ── Email Service (Resend) ───────────────────────────────
EMAIL_PROVIDER=resend
RESEND_API_KEY=<set-in-railway>
EMAIL_FROM_ADDRESS=events@nec.edu.in
EMAIL_FROM_NAME=NEC Events Desk
EMAIL_REPLY_TO=techfest@nec.edu.in

# ── Cloud Media Storage (Cloudinary) ─────────────────────
STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=<set-in-railway>
CLOUDINARY_API_KEY=<set-in-railway>
CLOUDINARY_API_SECRET=<set-in-railway>

# ── Check-in & Gate Security ─────────────────────────────
DEFAULT_GEOFENCE_RADIUS_M=150
CHECKIN_OPEN_BEFORE_MINUTES=120

# ── Initial Seed Credentials ─────────────────────────────
SEED_ORG_NAME=National Engineering College
SEED_ORG_SLUG=nec
SEED_SUPER_ADMIN_EMAIL=admin@nec.edu.in
SEED_SUPER_ADMIN_PASSWORD=<set-in-railway>
SEED_SUPER_ADMIN_NAME=Super Admin
SEED_TIMEZONE=Asia/Kolkata
```

### Frontend `.env`
```bash
VITE_API_BASE_URL=https://ems-backend-production.up.railway.app
VITE_RAZORPAY_KEY_ID=<set-in-railway>
VITE_DEFAULT_TIMEZONE=Asia/Kolkata
VITE_CURRENCY_SYMBOL=₹
VITE_ORG_NAME=National Engineering College
```

---

## 15. Complete API Endpoints Inventory

### Authentication & Profiles (`/api/v1/auth/`)
- `POST /signup`: Participant account registration with email & college info
- `POST /login`: Credentials verification; returns tokens or triggers `FIRST_LOGIN_OTP`
- `POST /verify-otp`: Consumes 6-digit code; marks `first_login_otp_done: true`
- `POST /refresh`: Issues fresh access token using HTTP-only refresh cookie
- `POST /switch-role`: Validates assigned roles and returns new JWT with requested active role context
- `POST /logout`: Revokes active refresh token family
- `POST /forgot-password`: Dispatches rate-limited password reset email
- `POST /reset-password`: Sets new password via cryptographic token
- `GET /me`: Returns profile, permissions matrix, and all authorized role contexts

### Global Events (`/api/v1/global-events/`)
- `GET /`: Lists all global events (supports query filtering by `status=PUBLISHED`, `edition_year`)
- `POST /`: Creates draft global event (Super Admin / Admin)
- `GET /:id`: Retrieves global event detail with aggregated stats
- `PATCH /:id`: Updates event details, schedule, or media banners
- `POST /:id/publish`: Transitions event from `DRAFT` to `PUBLISHED` (requires validation checks)
- `POST /:id/suspend`: Temporarily halts ticket sales with a public notice reason
- `POST /:id/reactivate`: Restores suspended event back to `PUBLISHED`
- `POST /:id/cancel`: **(Super Admin only)** Cancels event and queues automatic bulk refund batch
- `POST /:id/clone`: Duplicates past year's event structure (e.g. 2024 → 2025)

### Local Events (`/api/v1/local-events/`)
- `GET /`: Searchable local events catalog (filters: `global_event_id`, `department_id`, `category`, `price`)
- `POST /`: Creates local sub-event under a department
- `GET /:id`: Detailed event view (rules, seat availability, venue, geo coordinates)
- `PATCH /:id`: Modifies sub-event attributes
- `POST /:id/publish`: Opens sub-event for registration
- `POST /:id/cancel`: Cancels local event and triggers sub-event refund batch

### Registrations & Checkout (`/api/v1/registrations/`)
- `POST /`: Initializes registration; acquires 10-minute Redis seat lock; returns `registration_code`
- `GET /my`: Retrieves participant's past and upcoming registrations
- `GET /:id`: Full details of registration, team members, and order invoice
- `POST /:id/claim-member`: Teammate claims member seat using token received via email

### Orders & Payments (`/api/v1/orders/`)
- `POST /`: Creates payment order with paise calculations and initializes Razorpay order ID
- `POST /:id/verify`: Verifies Razorpay HMAC SHA-256 signature and issues signed tickets
- `POST /:id/collect-offline`: Records venue cash payment collected by scanner operator
- `POST /webhooks/razorpay`: Idempotent webhook receiver for asynchronous payment settlement

### Check-in & Scanner (`/api/v1/checkins/`)
- `POST /scan`: Validates signed QR code, checks single-use status, evaluates GPS geo-fence
- `POST /lookup`: Manual attendee lookup by phone/roll number when QR is unreadable
- `POST /sync`: Batch synchronizes offline scans recorded in IndexedDB

---

## 16. Module-by-Module Deployment Strategy (Railway First)

To minimize deployment risk and eliminate configuration mismatches, the application follows a **strict modular rollout sequence**.

```
  ┌──────────────────────────────────────────────────────────────┐
  │ PHASE 1: Deploy Module 1 (Auth FE + BE) to Railway           │
  │ • Real Railway URLs generated:                               │
  │   - Backend: https://ems-backend-production.up.railway.app   │
  │   - Frontend: https://ems-frontend-production.up.railway.app │
  │ • Verify CORS, Cookies, Resend Emails, and JWT on live web   │
  └──────────────────────────────┬───────────────────────────────┘
                                 │
                                 ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ PHASE 2: Module 2 — Global Events & Multi-Role Contexts      │
  │ • Support concurrent active global events                    │
  │ • Role Switcher UI & Department Master Catalog               │
  └──────────────────────────────┬───────────────────────────────┘
                                 │
                                 ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ PHASE 3: Module 3 — Local Event Catalog & Seed Data          │
  │ • Populate real TechFest 2025 sub-events from scraper        │
  │ • Rules, team sizes, venues, and geo-fence settings          │
  └──────────────────────────────┬───────────────────────────────┘
                                 │
                                 ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ PHASE 4: Module 4 — Registrations & Seat Hold Engine         │
  │ • Redis 10-minute hold mutexes & team member invites         │
  └──────────────────────────────┬───────────────────────────────┘
                                 │
                                 ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ PHASE 5: Module 5 — Payments (Razorpay + Offline Venue Cash) │
  │ • Integer paise math, GST calculation, webhook idempotency   │
  └──────────────────────────────┬───────────────────────────────┘
                                 │
                                 ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ PHASE 6: Module 6 — Ticketing & Signed QR Generation         │
  │ • Single-use HMAC signed QR codes & Resend email delivery    │
  └──────────────────────────────┬───────────────────────────────┘
                                 │
                                 ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ PHASE 7: Module 7 — Scanner PWA & Gate Check-in              │
  │ • Offline IndexedDB sync, cash collection modal, GPS check   │
  └──────────────────────────────┬───────────────────────────────┘
                                 │
                                 ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ PHASE 8: Module 8 — Refunds & Event Cancellation Batches     │
  │ • Automated mass refund worker & manual refund approval queue│
  └──────────────────────────────┬───────────────────────────────┘
                                 │
                                 ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ PHASE 9: Module 9 — Analytics, Reports & Live SSE            │
  │ • Real-time event streaming & Year-over-Year CSV exports     │
  └──────────────────────────────────────────────────────────────┘
```

---

## 17. Module-by-Module Edge Cases & Mitigations Matrix

| Module | Edge Case Scenario | Impact | System Mitigation / Solution |
|---|---|---|---|
| **1. Auth & Roles** | User has roles across multiple departments (e.g. CSE Admin + Scanner at MECH) | Confusion over permissions and active views | User top-nav displays **Role Switcher**. JWT carries role scopes; backend verifies requested action against scoped permissions. |
| **1. Auth & Roles** | User resets password on one device while logged in on 3 other devices | Stale sessions remain open | Increment `session_version` in User document. All existing refresh tokens become instantly invalid. |
| **1. Auth & Roles** | First-time staff member enters invalid OTP 5 times | Account brute-force risk | Locks OTP code verification for 15 minutes; logs audit record. |
| **2. Global Events** | 2 Global Events (*Tech Fest* and *Cultural Fest*) are active simultaneously | Registrations or analytics getting cross-contaminated | Strict scoping: every entity has mandatory `global_event_id`. Public UI presents explicit Global Fest switcher tabs. |
| **2. Global Events** | Admin attempts to publish a Global Event with zero departments attached | Public sees empty broken shell | Validation guard blocks publishing: requires ≥1 attached department and ≥1 published local event. |
| **3. Local Events** | Admin reduces total seat capacity from 100 to 50 when 70 tickets are already confirmed | Overbooking discrepancy | Database validation rejects capacity reduction below `seats_confirmed + seats_held`. |
| **3. Local Events** | Free event is edited to become a Paid event after participants have registered | Inconsistent financial records | System creates a versioned pricing snapshot. Existing free registrations remain valid; subsequent registrations incur fee. |
| **4. Registrations** | Two participants click "Register" on the last remaining seat at the exact same millisecond | Double-booking race condition | Handled via atomic MongoDB `findOneAndUpdate` with condition `{ seats_available: { $gte: seatsRequested } }` + Redis lock. |
| **4. Registrations** | Team leader registers a team member whose email is already registered in another competing team | Duplicate participant conflict | Unique partial index on `(local_event_id, member_email)` where status ≠ `CANCELLED`. API rejects with clear error message. |
| **4. Registrations** | Participant abandons browser tab during payment step | Seats held indefinitely | Redis TTL releases held seat after exactly 10 minutes; status reverts to available inventory. |
| **5. Payments** | Razorpay webhook arrives *before* the user's browser redirects back to the success page | Race condition on order finalization | Webhook handler uses idempotency log (`webhook_events`). If order is already updated by webhook, browser verify endpoint safely returns existing `CONFIRMED` order. |
| **5. Payments** | Student initiates payment twice due to bank app lag | Double debit risk | Order code acts as unique Razorpay receipt ID. Second attempt detects existing pending transaction and prevents dual order creation. |
| **6. Ticketing** | Attendee shares a screenshot of their QR code with a friend | Unauthorized dual entry | Ticket status transitions to `USED` on first successful scan. The second scan triggers loud red alert: `ALREADY_CHECKED_IN` with timestamp and gate info. |
| **7. Scanner PWA** | Campus Wi-Fi drops completely during morning rush hour at the college gate | Check-in halted | Scanner PWA stores scans in IndexedDB offline queue. Scans are bulk-synced via `POST /api/v1/checkins/sync` as soon as connection restores. |
| **7. Scanner PWA** | Attendee with "Pay at Venue" ticket arrives at gate | Unpaid participant entering event | Scanner UI intercepts `PAYMENT_PENDING` ticket; opens **Collect Cash Modal** showing exact fee; marks order `PAID` upon cash confirmation. |
| **7. Scanner PWA** | Volunteer attempts to scan tickets from their hostel room (GPS spoofing) | Fraudulent check-in | Device location checked against venue GPS coordinates. If distance > 150m and policy is `MANDATORY`, scan is rejected as `OUT_OF_GEOFENCE`. |
| **8. Refunds** | Super Admin cancels event with 500 paid registrations; Razorpay API rate limit hit | Mass refund failure | Refund batch processed via BullMQ queue with rate limiting (5 requests/sec) and exponential backoff retry. |
| **8. Refunds** | College Razorpay account has insufficient balance to cover batch refund | Refunds fail midway | Failed items marked `GATEWAY_INSUFFICIENT_FUNDS`; admin alerted via email; batch pauses and resumes automatically once funds replenished. |

---

## 18. Screen Inventory (68 Screens across 4 Surfaces)

### Public Surface (9 screens)
1. `/`: College Fest Portal Home (Hero, Active Global Events, Highlights, Countdown)
2. `/events`: All Events Directory (Filters by Fest, Department, Category)
3. `/events/:globalSlug`: Global Event Landing Page (Theme banner, schedule, depts)
4. `/events/:globalSlug/:deptSlug`: Department Events Catalog
5. `/events/:globalSlug/:deptSlug/:localEventSlug`: Local Event Detail & Register Modal
6. `/schedule`: Fest Timetable & Venue Map
7. `/gallery`: Previous Editions Photo Gallery
8. `/contact`: Helpdesk, Student Coordinators & FAQ
9. `/verify/:ticketCode`: Public Ticket Authenticity Verification Page

### Authentication Surface (7 screens)
10. `/login`: Unified Login (Email + Password)
11. `/signup`: Participant Registration & Profile Setup
12. `/verify-otp`: First-Time Login OTP Verification (Staff & Students)
13. `/forgot-password`: Password Recovery Request
14. `/reset-password`: Set New Password
15. `/claim/:token`: Team Member Ticket Claim Screen
16. `/accept-invite/:token`: Staff / Admin Role Invitation Acceptance

### Participant Portal (13 screens)
17. `/my/dashboard`: Active Registrations & Schedule Overview
18. `/my/registrations`: All Bookings (Confirmed, Pending, Cancelled)
19. `/my/tickets/:code`: High-Brightness Single-Use Signed QR Code Screen
20. `/my/orders`: Payment History & Tax Invoices (PDF Download)
21. `/my/teams`: Managed Teams & Member Invitation Status
22. `/my/teams/:id/invite`: Invite Teammates via Email / Share Link
23. `/my/refunds`: Submitted Refund Requests & Tracking Status
24. `/my/certificates`: Download Verified Participation Certificates
25. `/my/profile`: Edit Contact Info, College, Department & Roll Number
26. `/my/security`: Change Password & Active Session Revocation
27. `/my/notifications`: System Alerts & Schedule Change Notices
28. `/checkout/:regCode`: Order Review & Fee Breakdown Screen
29. `/checkout/:regCode/status`: Payment Confirmation & Ticket Download

### Admin & Staff Console (31 screens)
30. `/admin`: Global Analytics Dashboard (Revenue, Footfall, Registrations)
31. `/admin/events`: Global Events Management (Draft, Published, Suspended)
32. `/admin/events/new`: 5-Step Global Event Creation Wizard
33. `/admin/events/:id`: Global Event Control Center (Overview, Depts, Local Events)
34. `/admin/events/:id/departments`: Manage Department Associations
35. `/admin/events/:id/local/new`: 7-Tab Local Event Authoring Studio
36. `/admin/events/:id/local/:localId`: Sub-Event Editor & Real-time Roster
37. `/admin/registrations`: Master Cross-Event Registration Table
38. `/admin/registrations/:id`: Detailed Registration & Attendee Record
39. `/admin/orders`: Master Financial Ledger & Gateway Transaction Logs
40. `/admin/orders/:id`: Order Inspection & Offline Payment Receipt
41. `/admin/refunds`: Refund Management Queue (Pending Approvals & Gateway Status)
42. `/admin/refunds/batches`: Event Cancellation Auto-Refund Batch Monitor
43. `/admin/checkins`: Live Gate Attendance Monitor (SSE Feed)
44. `/admin/checkins/manual`: Manual Attendee Search & Override Check-in
45. `/admin/users`: User Directory & Multi-Role Assignment Console
46. `/admin/users/invite`: Send Staff / Coordinator Role Invitations
47. `/admin/email-templates`: 24 Notification Email Templates Directory
48. `/admin/email-templates/:key`: WYSIWYG Email Template Editor & Test Dispatch
49. `/admin/analytics/overview`: Fest Conversion Funnel & Daily Registration Pace
50. `/admin/analytics/colleges`: Top Participating External Colleges Roster
51. `/admin/analytics/revenue`: GST & Platform Fee Reconciliation Breakdown
52. `/admin/exports`: CSV & Excel Data Export Center
53. `/admin/audit`: Append-Only Administrative Security Audit Log
54. `/admin/settings/organization`: College Profile, GSTIN & Branding Logo
55. `/admin/settings/fees`: Platform Fee Bearer, GST %, and Rounding Policies
56. `/admin/settings/payments`: Razorpay Key Configuration & Webhook Health
57. `/admin/settings/departments`: Master Department Directory Editor
58. `/admin/settings/security`: Session TTL & Password Policy Controls
59. `/admin/settings/notifications`: Resend API Keys & Sender Address
60. `/admin/help`: System Documentation & Operational Cheatsheet

### Scanner PWA Surface (8 screens)
61. `/scan`: Event Selection & Camera Permission Check
62. `/scan/:localEventId`: Full-Screen High-Speed Camera Scanner
63. `/scan/:localEventId/result`: Scan Outcome Flash (Success / Warning / Error)
64. `/scan/:localEventId/lookup`: Manual Search by Phone, Email, or Ticket Code
65. `/scan/:localEventId/collect/:ticketId`: Collect Venue Cash Payment Modal
66. `/scan/offline-queue`: Review Unsynchronized Scans Stored in IndexedDB
67. `/scan/shift`: Shift Summary Report (Tickets Checked In, Total Cash Collected)
68. `/scan/help`: Scanner Device Troubleshooting & FAQ

---

## 19. Deployment Verification & End-to-End Checklist

To verify that the complete system functions flawlessly in production, run through this 12-point smoke test:

1. **Deploy Module 1 to Railway:** Backend starts with zero MongoDB connection errors; Frontend serves on live HTTPS URL.
2. **First Login & OTP:** Log in with the seeded Super Admin credentials → Receive & verify 6-digit OTP code → Dashboard opens.
3. **Multi-Role Test:** Grant an admin user a secondary `SCANNER` role → Verify the UI Role Switcher allows instant toggling between Admin and Scanner modes.
4. **Concurrent Global Events:** Verify that *NEC Tech Fest '25* and a second test fest (e.g. *Spandana Cultural Fest*) can both be set to `PUBLISHED` simultaneously.
5. **Seeded Events Check:** Confirm real departments (CSE, IT, ECE, MECH...) and sub-events (Blind Coding, SQL Hunt) are visible on the public portal.
6. **Individual Registration & Razorpay:** Register as a student → Complete test payment on Razorpay → Receive signed QR code email via Resend.
7. **Team Registration:** Register a team of 3 → Confirm team leader and all 2 invited teammates receive distinct, individual single-use ticket codes.
8. **Door Check-in:** Open `/scan` on mobile → Scan attendee QR → Green confirmation flash appears; re-scan immediately rejects with `ALREADY_CHECKED_IN`.
9. **Offline Cash Payment:** Register for an event with "Pay at Venue" → Scanner opens Collect Cash Modal → Confirms ₹150 cash → Ticket transitions to `USED`.
10. **Cancellation & Auto-Refund:** Super Admin cancels a test sub-event → Verify `RefundBatch` executes and marks order `REFUNDED`.
11. **Live Analytics & SSE:** Confirm live attendance counter increments in real-time on Admin Dashboard when scanner checks in tickets.
12. **CSV Export:** Generate and download attendee roster CSV from `/admin/exports` → Verify all columns match database records.
