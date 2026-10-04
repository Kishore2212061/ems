import { Schema, Types } from 'mongoose';

export const EVENT_CATEGORIES = ['TECHNICAL', 'NON_TECHNICAL', 'WORKSHOP', 'HACKATHON'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export const EVENT_STATUS = ['DRAFT', 'PUBLISHED', 'SUSPENDED', 'CANCELLED', 'COMPLETED'] as const;
export type EventStatus = (typeof EVENT_STATUS)[number];
/** Shown in the public catalogue. */
export const LISTED_STATUSES: EventStatus[] = ['PUBLISHED', 'SUSPENDED', 'COMPLETED'];
/** Reachable by direct link (a cancelled event keeps its page so registrants see the notice). */
export const VISIBLE_STATUSES: EventStatus[] = [...LISTED_STATUSES, 'CANCELLED'];
/** No more edits once an event is over or called off. */
export const CLOSED_STATUSES: EventStatus[] = ['CANCELLED', 'COMPLETED'];

export interface Coordinator {
  name: string;
  phone: string | null;
  role: 'FACULTY' | 'STUDENT';
}

export interface ResourcePerson {
  name: string;
  designation: string | null;
  organization: string | null;
  bio: string | null;
}

export const PAYMENT_MODES = ['ONLINE', 'OFFLINE'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export interface Pricing {
  type: 'FREE' | 'PAID';
  amount_paise: number;
  per: 'MEMBER' | 'TEAM';
  /** How a paid entry can be settled: ONLINE = gateway at registration, OFFLINE = at the registration desk. Empty when free. */
  modes: PaymentMode[];
}

export interface LocalEvent {
  _id: Types.ObjectId;
  global_event_id: Types.ObjectId;
  /** null = fest-wide (e.g. the Ideathon), run by the fest team rather than one department. */
  department_id: Types.ObjectId | null;
  /** Denormalised from the fest's department list → cards need no lookup; kept in sync on rename. */
  department_code: string | null;
  department_name: string | null;
  slug: string;
  name: string;
  tagline: string | null;
  category: EventCategory;
  /** A club co-hosting the event ("IEEE CS"); the department is shown otherwise. */
  organizer: string | null;
  tags: string[];
  /** Plain text, rendered as text (never as HTML) → nothing to sanitise, no markdown renderer to ship. */
  description: string;
  rules: string[];
  status: EventStatus;
  status_reason: string | null;
  participation: 'INDIVIDUAL' | 'TEAM';
  team_min: number;
  team_max: number;
  pricing: Pricing;
  /** Bumps on every price change; registrations snapshot it (Module 4). */
  price_version: number;
  online: boolean;
  /** null = no cap. Counters are maintained by registrations (Module 4) → seats left needs no count(). */
  seats_total: number | null;
  seats_confirmed: number;
  seats_held: number;
  registration_opens_at: Date | null;
  registration_closes_at: Date | null;
  starts_at: Date | null;
  ends_at: Date | null;
  venue: string | null;
  coordinators: Coordinator[];
  resource_person: ResourcePerson | null;
  banner_url: string | null;
  published_at: Date | null;
  created_by: Types.ObjectId | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export const LOCAL_EVENT_MODEL = 'LocalEvent';

const CoordinatorSchema = new Schema<Coordinator>(
  { name: { type: String, required: true }, phone: { type: String, default: null }, role: { type: String, enum: ['FACULTY', 'STUDENT'], required: true } },
  { _id: false },
);
const ResourcePersonSchema = new Schema<ResourcePerson>(
  { name: { type: String, required: true }, designation: { type: String, default: null }, organization: { type: String, default: null }, bio: { type: String, default: null } },
  { _id: false },
);
const PricingSchema = new Schema<Pricing>(
  {
    type: { type: String, enum: ['FREE', 'PAID'], default: 'FREE' },
    amount_paise: { type: Number, default: 0 },
    per: { type: String, enum: ['MEMBER', 'TEAM'], default: 'TEAM' },
    modes: { type: [{ type: String, enum: PAYMENT_MODES }], default: [] },
  },
  { _id: false },
);

export const LocalEventSchema = new Schema<LocalEvent>(
  {
    global_event_id: { type: Schema.Types.ObjectId, required: true },
    department_id: { type: Schema.Types.ObjectId, default: null },
    department_code: { type: String, default: null },
    department_name: { type: String, default: null },
    slug: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    tagline: { type: String, default: null },
    category: { type: String, enum: EVENT_CATEGORIES, required: true },
    organizer: { type: String, default: null },
    tags: { type: [String], default: [] },
    description: { type: String, default: '' },
    rules: { type: [String], default: [] },
    status: { type: String, enum: EVENT_STATUS, default: 'DRAFT' },
    status_reason: { type: String, default: null },
    participation: { type: String, enum: ['INDIVIDUAL', 'TEAM'], default: 'INDIVIDUAL' },
    team_min: { type: Number, default: 1 },
    team_max: { type: Number, default: 1 },
    pricing: { type: PricingSchema, default: () => ({}) },
    price_version: { type: Number, default: 0 },
    online: { type: Boolean, default: false },
    seats_total: { type: Number, default: null },
    seats_confirmed: { type: Number, default: 0 },
    seats_held: { type: Number, default: 0 },
    registration_opens_at: { type: Date, default: null },
    registration_closes_at: { type: Date, default: null },
    starts_at: { type: Date, default: null },
    ends_at: { type: Date, default: null },
    venue: { type: String, default: null },
    coordinators: { type: [CoordinatorSchema], default: [] },
    resource_person: { type: ResourcePersonSchema, default: null },
    banner_url: { type: String, default: null },
    published_at: { type: Date, default: null },
    created_by: { type: Schema.Types.ObjectId, default: null },
    version: { type: Number, default: 0 },
  },
  { collection: 'local_events', versionKey: false, timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

// Each list shape has an index whose equality fields come first and whose order matches the sort
// (starts_at, _id) exactly, so a page is a bounded index walk with no in-memory sort.
LocalEventSchema.index({ global_event_id: 1, slug: 1 }, { unique: true });
LocalEventSchema.index({ global_event_id: 1, status: 1, starts_at: 1, _id: 1 }); // fest catalogue
LocalEventSchema.index({ global_event_id: 1, department_id: 1, status: 1, starts_at: 1, _id: 1 }); // department chip + dept-scoped admin
LocalEventSchema.index({ global_event_id: 1, status: 1, category: 1, starts_at: 1, _id: 1 }); // category chip
LocalEventSchema.index(
  { global_event_id: 1, name: 'text', tags: 'text', description: 'text' },
  { name: 'event_search', weights: { name: 10, tags: 5, description: 1 }, default_language: 'english' },
);

type EventDoc = Pick<LocalEvent, '_id'> & Partial<LocalEvent>;

/** Card projection: everything a list needs, nothing it doesn't (no description/rules/people). */
export const CARD_FIELDS =
  '_id slug name tagline category department_id department_code department_name organizer starts_at ends_at venue online participation team_min team_max pricing seats_total seats_confirmed seats_held registration_closes_at status banner_url';
export const ADMIN_ROW_FIELDS = `${CARD_FIELDS} updated_at`;

const seatsLeft = (e: EventDoc) =>
  e.seats_total == null ? null : Math.max(0, e.seats_total - (e.seats_confirmed ?? 0) - (e.seats_held ?? 0));

export function toEventCard(e: EventDoc) {
  return {
    id: String(e._id),
    slug: e.slug!,
    name: e.name!,
    tagline: e.tagline ?? null,
    category: e.category!,
    department: e.department_id ? { id: String(e.department_id), code: e.department_code!, name: e.department_name! } : null,
    organizer: e.organizer ?? null,
    startsAt: e.starts_at ?? null,
    endsAt: e.ends_at ?? null,
    venue: e.venue ?? null,
    online: !!e.online,
    participation: e.participation!,
    teamMin: e.team_min!,
    teamMax: e.team_max!,
    pricing: { type: e.pricing?.type ?? 'FREE', amountPaise: e.pricing?.amount_paise ?? 0, per: e.pricing?.per ?? 'TEAM', modes: e.pricing?.modes ?? [] },
    seatsTotal: e.seats_total ?? null,
    seatsLeft: seatsLeft(e),
    registrationClosesAt: e.registration_closes_at ?? null,
    status: e.status!,
    /** Cards derive their small variant from it (see frontend lib/media.ts). */
    bannerUrl: e.banner_url ?? null,
  };
}

export function toEventDetail(e: EventDoc, admin = false) {
  return {
    ...toEventCard(e),
    tags: e.tags ?? [],
    description: e.description ?? '',
    rules: e.rules ?? [],
    statusReason: e.status_reason ?? null,
    registrationOpensAt: e.registration_opens_at ?? null,
    coordinators: (e.coordinators ?? []).map((c) => ({ name: c.name, phone: c.phone ?? null, role: c.role })),
    resourcePerson: e.resource_person
      ? { name: e.resource_person.name, designation: e.resource_person.designation ?? null, organization: e.resource_person.organization ?? null, bio: e.resource_person.bio ?? null }
      : null,
    publishedAt: e.published_at ?? null,
    ...(admin && {
      festId: String(e.global_event_id),
      seatsConfirmed: e.seats_confirmed ?? 0,
      seatsHeld: e.seats_held ?? 0,
      priceVersion: e.price_version ?? 0,
      version: e.version!,
      createdAt: e.created_at,
      updatedAt: e.updated_at,
    }),
  };
}
