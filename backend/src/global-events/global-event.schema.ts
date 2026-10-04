import { Schema, Types } from 'mongoose';

export const FEST_STATUS = ['DRAFT', 'PUBLISHED', 'SUSPENDED', 'COMPLETED', 'CANCELLED'] as const;
export type FestStatus = (typeof FEST_STATUS)[number];
export const FEST_TYPES = ['TECHNICAL', 'CULTURAL', 'HACKATHON', 'OTHER'] as const;
/** Visible on the public site. */
export const PUBLIC_STATUSES: FestStatus[] = ['PUBLISHED', 'SUSPENDED', 'COMPLETED'];

export interface FestDepartment {
  department_id: Types.ObjectId;
  /** Denormalised from department_masters (kept in sync on rename) → fest pages need one query. */
  code: string;
  name: string;
}

export interface GlobalEvent {
  _id: Types.ObjectId;
  slug: string;
  name: string;
  edition_year: number;
  type: (typeof FEST_TYPES)[number];
  tagline?: string | null;
  description?: string | null;
  starts_at?: Date | null;
  ends_at?: Date | null;
  venue?: string | null;
  banner_url?: string | null;
  contact_email?: string | null;
  status: FestStatus;
  suspend_reason?: string | null;
  published_at?: Date | null;
  departments: FestDepartment[];
  created_by: Types.ObjectId | null;
  /** Optimistic concurrency: every update must send the version it read. */
  version: number;
  created_at: Date;
  updated_at: Date;
}

export const GLOBAL_EVENT_MODEL = 'GlobalEvent';

const FestDepartmentSchema = new Schema<FestDepartment>(
  { department_id: { type: Schema.Types.ObjectId, required: true }, code: String, name: String },
  { _id: false },
);

export const GlobalEventSchema = new Schema<GlobalEvent>(
  {
    slug: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    edition_year: { type: Number, required: true },
    type: { type: String, enum: FEST_TYPES, default: 'TECHNICAL' },
    tagline: { type: String, default: null },
    description: { type: String, default: null },
    starts_at: { type: Date, default: null },
    ends_at: { type: Date, default: null },
    venue: { type: String, default: null },
    banner_url: { type: String, default: null },
    contact_email: { type: String, default: null },
    status: { type: String, enum: FEST_STATUS, default: 'DRAFT' },
    suspend_reason: { type: String, default: null },
    published_at: { type: Date, default: null },
    departments: { type: [FestDepartmentSchema], default: [] },
    created_by: { type: Schema.Types.ObjectId, default: null },
    version: { type: Number, default: 0 },
  },
  { collection: 'global_events', versionKey: false, timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

GlobalEventSchema.index({ slug: 1 }, { unique: true });
GlobalEventSchema.index({ status: 1, starts_at: 1 }); // public list + admin tabs
GlobalEventSchema.index({ 'departments.department_id': 1 }); // rename propagation, "fests using CSE"

type FestDoc = Pick<GlobalEvent, '_id'> & Partial<GlobalEvent>;

/** Small card shape for lists. */
export const FEST_LIST_FIELDS = '_id slug name edition_year type tagline starts_at ends_at venue banner_url status suspend_reason departments';

export function toFestSummary(f: FestDoc) {
  return {
    id: String(f._id),
    slug: f.slug!,
    name: f.name!,
    editionYear: f.edition_year!,
    type: f.type!,
    tagline: f.tagline ?? null,
    startsAt: f.starts_at ?? null,
    endsAt: f.ends_at ?? null,
    venue: f.venue ?? null,
    bannerUrl: f.banner_url ?? null,
    status: f.status!,
    suspendReason: f.suspend_reason ?? null,
    departments: (f.departments ?? []).map((d) => ({ id: String(d.department_id), code: d.code, name: d.name })),
  };
}

export function toFestDetail(f: FestDoc, admin = false) {
  return {
    ...toFestSummary(f),
    description: f.description ?? null,
    contactEmail: f.contact_email ?? null,
    publishedAt: f.published_at ?? null,
    ...(admin && { version: f.version!, createdAt: f.created_at, updatedAt: f.updated_at }),
  };
}
