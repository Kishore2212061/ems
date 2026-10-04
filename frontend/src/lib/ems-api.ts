import type { Role, ScopeType, User, UserRole } from '@/store/auth';
import { api } from './api';
import type { Breakdown, FeeSettings } from './fees';

// ── types (mirror the backend's public shapes) ──────────────────────────────
export type FestStatus = 'DRAFT' | 'PUBLISHED' | 'SUSPENDED' | 'COMPLETED' | 'CANCELLED';
export type FestType = 'TECHNICAL' | 'CULTURAL' | 'HACKATHON' | 'OTHER';

export interface Department {
  id: string;
  code: string;
  name: string;
  associationName: string | null;
  active: boolean;
  sortOrder: number;
}

export interface FestSummary {
  id: string;
  slug: string;
  name: string;
  editionYear: number;
  type: FestType;
  tagline: string | null;
  startsAt: string | null;
  endsAt: string | null;
  venue: string | null;
  bannerUrl: string | null;
  status: FestStatus;
  suspendReason: string | null;
  departments: { id: string; code: string; name: string }[];
}

export interface FestDetail extends FestSummary {
  description: string | null;
  contactEmail: string | null;
  publishedAt: string | null;
  version?: number;
}

// ── department events (Module 3) ──
export type EventCategory = 'TECHNICAL' | 'NON_TECHNICAL' | 'WORKSHOP' | 'HACKATHON';
export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'SUSPENDED' | 'CANCELLED' | 'COMPLETED';

export type PaymentMode = 'ONLINE' | 'OFFLINE';

export interface Pricing {
  type: 'FREE' | 'PAID';
  amountPaise: number;
  per: 'MEMBER' | 'TEAM';
  /** ONLINE = pay while registering, OFFLINE = pay at the registration desk. Empty when free. */
  modes: PaymentMode[];
}

export interface EventCard {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  category: EventCategory;
  department: { id: string; code: string; name: string } | null;
  organizer: string | null;
  startsAt: string | null;
  endsAt: string | null;
  venue: string | null;
  online: boolean;
  participation: 'INDIVIDUAL' | 'TEAM';
  teamMin: number;
  teamMax: number;
  pricing: Pricing;
  seatsTotal: number | null;
  seatsLeft: number | null;
  registrationClosesAt: string | null;
  status: EventStatus;
  bannerUrl: string | null;
}

export interface Coordinator {
  name: string;
  phone: string | null;
  role: 'FACULTY' | 'STUDENT';
}

export interface EventDetail extends EventCard {
  tags: string[];
  description: string;
  rules: string[];
  statusReason: string | null;
  registrationOpensAt: string | null;
  coordinators: Coordinator[];
  resourcePerson: { name: string; designation: string | null; organization: string | null; bio: string | null } | null;
  publishedAt: string | null;
  /** public page only */
  fest?: { slug: string; name: string; status: FestStatus };
  /** admin only */
  festId?: string;
  seatsConfirmed?: number;
  seatsHeld?: number;
  priceVersion?: number;
  version?: number;
}

export interface EventFacets {
  total: number;
  departments: Record<string, number>;
  categories: Partial<Record<EventCategory, number>>;
  paid: number;
  /** Events per fest day (college time), in date order. */
  days: { day: string; n: number }[];
}

export interface EventPage {
  items: EventCard[];
  nextCursor: string | null;
  facets?: EventFacets;
}

export interface EventQuery {
  dept?: string;
  category?: EventCategory;
  free?: boolean;
  q?: string;
  /** YYYY-MM-DD (college time); ignored by the API while searching. */
  day?: string;
  cursor?: string;
}

// ── registrations (Module 4) ──
export type RegistrationStatus = 'PAYMENT_PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';
/** NOT_REQUIRED = free · PENDING = online, not paid yet · DUE = pay at the desk · PAID */
export type PaymentStatus = 'NOT_REQUIRED' | 'PENDING' | 'DUE' | 'PAID';

export interface RegistrationPayment {
  mode: 'NONE' | PaymentMode;
  status: PaymentStatus;
  amountPaise: number;
  /** Base / platform fee / GST as priced when registering (null for free entries made before fees existed). */
  breakdown?: Breakdown | null;
}

// ── payments (Module 5) ──
export interface CheckoutOrder {
  orderCode: string;
  /** "mock" = the local simulated gateway (development only). */
  gateway: 'razorpay' | 'mock';
  keyId: string;
  gatewayOrderId: string;
  amountPaise: number;
  currency: 'INR';
  description: string;
  holdExpiresAt: string;
  prefill: { name: string; email: string; contact: string };
}

export interface OrderView {
  code: string;
  registrationCode: string;
  mode: PaymentMode;
  status: 'CREATED' | 'PAID';
  amountPaise: number;
  breakdown: Breakdown;
  paidAt: string | null;
  refundStatus: 'NONE' | 'PENDING' | 'DONE' | 'FAILED';
  createdAt: string;
  registrationStatus?: RegistrationStatus | null;
  eventName?: string | null;
}

export interface OrderPage extends Page<OrderView> {
  totals?: { onlinePaise: number; onlineCount: number; deskPaise: number; deskCount: number; refunds: number };
}

// ── tickets (Module 6) ──
export type TicketStatus = 'ACTIVE' | 'PAYMENT_PENDING' | 'USED' | 'VOID';
export interface TicketView {
  code: string;
  status: TicketStatus;
  registrationCode: string;
  holder: string;
  leader: boolean;
  issuedAt: string;
  usedAt: string | null;
  /** Signed QR payload (owner views only, absent when void). */
  qr?: string;
}
export interface TicketDetail extends TicketView {
  event: { name: string; slug: string; startsAt: string | null; endsAt: string | null; venue: string | null; online: boolean } | null;
  fest: { name: string; slug: string } | null;
}
export interface TicketCheck {
  code: string;
  status: TicketStatus;
  holder: string;
  event: string | null;
  startsAt: string | null;
  fest: string | null;
  usedAt: string | null;
}

export interface Registration {
  /** The viewer's own ticket (single-registration views only). */
  ticket?: TicketView | null;
  code: string;
  status: RegistrationStatus;
  role: 'LEADER' | 'MEMBER';
  eventId: string;
  /** The window used for clash checks: an event without an end time counts as 2 hours. */
  startsAt: string;
  endsAt: string;
  teamName: string | null;
  members: { name: string; email: string; leader: boolean }[];
  payment: RegistrationPayment;
  holdExpiresAt: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  event: {
    id: string;
    slug: string;
    name: string;
    category: EventCategory;
    startsAt: string | null;
    endsAt: string | null;
    venue: string | null;
    online: boolean;
    status: EventStatus;
    departmentCode: string | null;
    bannerUrl: string | null;
  } | null;
  fest: { slug: string; name: string; status: FestStatus } | null;
}

export interface RegistrationInput {
  eventId: string;
  teamName?: string | null;
  teammates: { name: string; email: string }[];
  paymentMode?: PaymentMode;
}

export interface AdminRegistration {
  id: string;
  code: string;
  status: RegistrationStatus;
  eventId: string;
  teamName: string | null;
  members: { name: string; email: string; phone: string | null; college: string | null; leader: boolean }[];
  payment: RegistrationPayment;
  holdExpiresAt: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface AdminRegistrationPage extends Page<AdminRegistration> {
  counts?: Partial<Record<RegistrationStatus, number>>;
  people?: number;
  seats?: { total: number | null; confirmed: number; held: number };
  hint?: string;
}

export type EventInput = Partial<{
  name: string;
  slug: string;
  tagline: string | null;
  category: EventCategory;
  departmentId: string | null;
  organizer: string | null;
  tags: string[];
  description: string;
  rules: string[];
  participation: 'INDIVIDUAL' | 'TEAM';
  teamMin: number;
  teamMax: number;
  pricing: Pricing;
  online: boolean;
  seatsTotal: number | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  venue: string | null;
  coordinators: Coordinator[];
  resourcePerson: EventDetail['resourcePerson'];
  bannerUrl: string | null;
}>;

export interface AdminUser extends User {
  lastLoginAt: string | null;
}

export interface Invite {
  id: string;
  email: string;
  role: Role;
  scopeType: ScopeType;
  scopeId: string | null;
  scopeLabel: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED';
  expiresAt: string;
  expired: boolean;
  invitedByName: string;
  lastSentAt: string;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  actorName: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  at: string;
}

export interface Session {
  id: string;
  ip: string | null;
  userAgent: string | null;
  lastActiveAt: string;
  current: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type FestInput = Partial<{
  name: string;
  editionYear: number;
  type: FestType;
  tagline: string | null;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  venue: string | null;
  bannerUrl: string | null;
  contactEmail: string | null;
  departmentIds: string[];
}>;

export type RoleGrant = { role: Role; scopeType: ScopeType; scopeId?: string | null };

const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ── endpoints ───────────────────────────────────────────────────────────────
export const publicApi = {
  fests: () => api.get<FestSummary[]>('/global-events'),
  fest: (slug: string) => api.get<FestDetail>(`/global-events/${encodeURIComponent(slug)}`),
  departments: () => api.get<Department[]>('/departments'),
  events: (fest: string, q: EventQuery) =>
    api.get<EventPage>(`/global-events/${encodeURIComponent(fest)}/events${qs({ dept: q.dept, category: q.category, free: q.free ? 1 : undefined, q: q.q, day: q.day, cursor: q.cursor })}`),
  event: (fest: string, slug: string) => api.get<EventDetail>(`/global-events/${encodeURIComponent(fest)}/events/${encodeURIComponent(slug)}`),
};

export const eventApi = {
  list: (festId: string) => api.get<{ items: (EventCard & { updatedAt: string; taken: number })[]; counts: Partial<Record<EventStatus, number>> }>(`/admin/global-events/${festId}/events`),
  get: (id: string) => api.get<EventDetail>(`/admin/local-events/${id}`),
  create: (festId: string, body: EventInput) => api.post<EventDetail>(`/admin/global-events/${festId}/events`, body),
  update: (id: string, body: EventInput & { version: number }) => api.patch<EventDetail>(`/admin/local-events/${id}`, body),
  remove: (id: string) => api.del(`/admin/local-events/${id}`),
  publish: (id: string) => api.post<EventDetail>(`/admin/local-events/${id}/publish`),
  suspend: (id: string, reason: string) => api.post<EventDetail>(`/admin/local-events/${id}/suspend`, { reason }),
  reactivate: (id: string) => api.post<EventDetail>(`/admin/local-events/${id}/reactivate`),
  complete: (id: string) => api.post<EventDetail>(`/admin/local-events/${id}/complete`),
  cancel: (id: string, reason: string) => api.post<EventDetail>(`/admin/local-events/${id}/cancel`, { reason }),
  clone: (id: string) => api.post<EventDetail>(`/admin/local-events/${id}/clone`),
};

export const regApi = {
  /** `key` makes retries safe: the same key always returns the first result. */
  create: (body: RegistrationInput, key: string) => api.post<Registration>('/registrations', body, { headers: { 'Idempotency-Key': key } }),
  mine: () => api.get<{ items: Registration[] }>('/registrations/my'),
  get: (code: string) => api.get<Registration>(`/registrations/${encodeURIComponent(code)}`),
  cancel: (code: string, reason?: string) => api.post<Registration>(`/registrations/${encodeURIComponent(code)}/cancel`, reason ? { reason } : {}),
};

export const ticketApi = {
  get: (code: string) => api.get<TicketDetail>(`/tickets/${encodeURIComponent(code)}`),
  resend: (code: string) => api.post<{ sent: true }>(`/tickets/${encodeURIComponent(code)}/resend`),
  verify: (code: string) => api.get<TicketCheck>(`/verify/${encodeURIComponent(code)}`),
};

export const payApi = {
  fees: () => api.get<FeeSettings>('/fees'),
  start: (regCode: string) => api.post<CheckoutOrder>(`/registrations/${encodeURIComponent(regCode)}/order`),
  verify: (orderCode: string, b: { gatewayOrderId: string; paymentId: string; signature: string }) => api.post<OrderView>(`/orders/${orderCode}/verify`, b),
  status: (orderCode: string) => api.get<OrderView>(`/orders/${orderCode}`),
  /** Development only: the simulated gateway "pays". */
  simulate: (orderCode: string) => api.post<{ gatewayOrderId: string; paymentId: string; signature: string }>(`/orders/${orderCode}/simulate`),
};

export const adminPayApi = {
  collect: (regCode: string, amountPaise: number) => api.post<OrderView>(`/admin/registrations/${encodeURIComponent(regCode)}/collect`, { amountPaise }),
  orders: (q: { festId: string; status?: 'CREATED' | 'PAID'; mode?: PaymentMode; cursor?: string }) => api.get<OrderPage>(`/admin/orders${qs(q)}`),
  setFees: (s: FeeSettings) => api.put<FeeSettings>('/admin/settings/fees', s),
};

export const adminRegApi = {
  list: (eventId: string, q: { status?: RegistrationStatus; q?: string; cursor?: string } = {}) =>
    api.get<AdminRegistrationPage>(`/admin/local-events/${eventId}/registrations${qs(q)}`),
  cancel: (code: string, reason: string) => api.post<AdminRegistration>(`/admin/registrations/${encodeURIComponent(code)}/cancel`, { reason }),
};

export const festApi = {
  list: (status?: FestStatus) => api.get<{ items: FestSummary[]; counts: Partial<Record<FestStatus, number>> }>(`/admin/global-events${qs({ status })}`),
  get: (id: string) => api.get<FestDetail>(`/admin/global-events/${id}`),
  create: (body: FestInput & { name: string; editionYear: number }) => api.post<FestDetail>('/admin/global-events', body),
  update: (id: string, body: FestInput & { version: number }) => api.patch<FestDetail>(`/admin/global-events/${id}`, body),
  setDepartments: (id: string, departmentIds: string[], version: number) => api.put<FestDetail>(`/admin/global-events/${id}/departments`, { departmentIds, version }),
  publish: (id: string) => api.post<FestDetail>(`/admin/global-events/${id}/publish`),
  suspend: (id: string, reason: string) => api.post<FestDetail>(`/admin/global-events/${id}/suspend`, { reason }),
  reactivate: (id: string) => api.post<FestDetail>(`/admin/global-events/${id}/reactivate`),
  complete: (id: string) => api.post<FestDetail>(`/admin/global-events/${id}/complete`),
  clone: (id: string, editionYear: number) => api.post<FestDetail>(`/admin/global-events/${id}/clone`, { editionYear }),
};

export const mediaApi = {
  /** Raw image body (≤ 10 MB) → hosted, resized poster URL. */
  uploadPoster: (file: Blob) => api.upload<{ url: string }>('/admin/media/posters', file),
  /** A pasted link → downloaded once, compressed, our URL back. */
  importPoster: (url: string) => api.post<{ url: string }>('/admin/media/posters/import', { url }),
};

export const deptApi = {
  listAll: () => api.get<Department[]>('/admin/departments'),
  create: (b: Partial<Department>) => api.post<Department>('/admin/departments', b),
  update: (id: string, b: Partial<Department>) => api.patch<Department>(`/admin/departments/${id}`, b),
};

export const userApi = {
  list: (q: { q?: string; role?: Role; cursor?: string }) => api.get<Page<AdminUser>>(`/admin/users${qs({ ...q, limit: 30 })}`),
  get: (id: string) => api.get<AdminUser>(`/admin/users/${id}`),
  grant: (id: string, g: RoleGrant) => api.post<AdminUser>(`/admin/users/${id}/roles`, g),
  revoke: (id: string, g: Pick<UserRole, 'role' | 'scopeType' | 'scopeId'>) => api.post<AdminUser>(`/admin/users/${id}/roles/revoke`, g),
  suspend: (id: string) => api.post<AdminUser>(`/admin/users/${id}/suspend`),
  reactivate: (id: string) => api.post<AdminUser>(`/admin/users/${id}/reactivate`),
};

export const inviteApi = {
  list: (status: Invite['status'] = 'PENDING') => api.get<Invite[]>(`/admin/invites${qs({ status })}`),
  create: (b: { email: string } & RoleGrant) => api.post<Invite>('/admin/invites', b),
  revoke: (id: string) => api.del(`/admin/invites/${id}`),
  resend: (id: string) => api.post<Invite>(`/admin/invites/${id}/resend`),
  preview: (token: string) =>
    api.get<{ email: string; role: Role; scopeLabel: string | null; invitedByName: string; expiresAt: string; accountExists: boolean }>(`/auth/invites/${token}`),
};

export const auditApi = {
  forEntity: (entity: string, entityId: string) => api.get<Page<AuditEntry>>(`/admin/audit${qs({ entity, entityId, limit: 30 })}`),
};

export const meApi = {
  updateProfile: (b: Partial<Pick<User, 'fullName' | 'phone' | 'college'>>) => api.patch<User>('/me/profile', b),
  sessions: () => api.get<Session[]>('/auth/sessions'),
  revokeSession: (id: string) => api.del(`/auth/sessions/${id}`),
  revokeOthers: () => api.post<{ ended: number }>('/auth/sessions/revoke-others'),
};

/** Valid scopes per role (mirror of backend users/roles.ts). */
export const VALID_SCOPES: Record<Role, ScopeType[]> = {
  SUPER_ADMIN: ['ORG'],
  ADMIN: ['ORG', 'GLOBAL_EVENT', 'DEPARTMENT'],
  FINANCE: ['ORG', 'GLOBAL_EVENT'],
  SCANNER: ['GLOBAL_EVENT'],
  PARTICIPANT: ['ORG'],
};

export const SCOPE_LABEL: Record<ScopeType, string> = {
  ORG: 'Whole college',
  GLOBAL_EVENT: 'One fest',
  DEPARTMENT: 'One department',
  LOCAL_EVENT: 'One event',
};

export const FEST_STATUS_TONE = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  SUSPENDED: 'warning',
  COMPLETED: 'info',
  CANCELLED: 'danger',
} as const;

export const FEST_STATUS_LABEL: Record<FestStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Live',
  SUSPENDED: 'Suspended',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const FEST_TYPE_LABEL: Record<FestType, string> = {
  TECHNICAL: 'Technical',
  CULTURAL: 'Cultural',
  HACKATHON: 'Hackathon',
  OTHER: 'Other',
};

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  TECHNICAL: 'Technical',
  NON_TECHNICAL: 'Non-technical',
  WORKSHOP: 'Workshop',
  HACKATHON: 'Hackathon',
};

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Live',
  SUSPENDED: 'Paused',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};

export const EVENT_STATUS_TONE = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  SUSPENDED: 'warning',
  CANCELLED: 'danger',
  COMPLETED: 'info',
} as const;

/** "Solo", "Teams of 2", "Teams of 2–4" */
export const teamLabel = (e: Pick<EventCard, 'participation' | 'teamMin' | 'teamMax'>) =>
  e.participation === 'INDIVIDUAL' ? 'Solo' : e.teamMin === e.teamMax ? `Teams of ${e.teamMax}` : `Teams of ${e.teamMin}–${e.teamMax}`;

export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
/** "Pay online", "Pay at the desk", "Pay online or at the desk" */
export const payLabel = (p: Pricing) =>
  p.type === 'FREE' ? null : p.modes.length > 1 ? 'Pay online or at the desk' : p.modes[0] === 'OFFLINE' ? 'Pay at the desk' : 'Pay online';

/** "Free", "₹150 per team" */
export const priceLabel = (p: Pricing, participation: EventCard['participation'] = 'TEAM') =>
  p.type === 'FREE' ? 'Free' : participation === 'INDIVIDUAL' ? rupees(p.amountPaise) : `${rupees(p.amountPaise)} per ${p.per === 'TEAM' ? 'team' : 'member'}`;
