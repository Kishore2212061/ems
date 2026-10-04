import { z } from 'zod';
import { objectId } from '../common/util';
import { EVENT_CATEGORIES, EVENT_STATUS, PAYMENT_MODES } from './local-event.schema';

const date = z.iso.datetime({ offset: true, message: 'Invalid date' }).transform((v) => new Date(v));
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens')
  .max(60);

/**
 * Poster/banner: an https URL, or a file shipped with the frontend under /media/ (web-sized copies
 * of seeded posters). Nothing else: no other relative paths, schemes or query tricks.
 */
const imageUrl = z.union(
  [
    z.url({ protocol: /^https$/ }).max(500),
    z
      .string()
      .max(200)
      .regex(/^\/(media|api\/v1\/media)\/[a-z0-9][a-z0-9/_-]*\.(webp|png|jpe?g|avif)$/i),
  ],
  { message: 'Use an https:// image URL' },
);

const Coordinator = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(120),
  phone: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number')
    .nullish()
    .transform((v) => v ?? null),
  role: z.enum(['FACULTY', 'STUDENT']),
});

const ResourcePerson = z.object({
  name: z.string().trim().min(2).max(80),
  designation: optText(120),
  organization: optText(120),
  bio: optText(1500),
});

const Pricing = z.object({
  type: z.enum(['FREE', 'PAID']),
  amountPaise: z.number().int().min(0).max(10_000_000).default(0),
  per: z.enum(['MEMBER', 'TEAM']).default('TEAM'),
  modes: z.array(z.enum(PAYMENT_MODES)).max(2).default([]),
});

/** Field shapes shared by create, update and the seed import. No defaults here: see `defaults`. */
const fields = {
  name: z.string().trim().min(3, 'Enter the event name').max(120),
  slug: slug.optional(),
  tagline: optText(160),
  category: z.enum(EVENT_CATEGORIES),
  organizer: optText(80),
  tags: z.array(z.string().trim().min(1).max(40)).max(8),
  description: z.string().trim().max(5000),
  rules: z.array(z.string().trim().min(1).max(600)).max(30),
  participation: z.enum(['INDIVIDUAL', 'TEAM']),
  teamMin: z.number().int().min(1).max(20),
  teamMax: z.number().int().min(1).max(20),
  pricing: Pricing,
  online: z.boolean(),
  seatsTotal: z.number().int().min(1).max(100_000).nullable(),
  registrationOpensAt: date.nullish(),
  registrationClosesAt: date.nullish(),
  startsAt: date.nullish(),
  endsAt: date.nullish(),
  venue: optText(160),
  coordinators: z.array(Coordinator).max(10),
  resourcePerson: ResourcePerson.nullish(),
  bannerUrl: imageUrl.nullish(),
};

/**
 * Defaults for a *new* event only. Kept out of `fields` on purpose: a PATCH must never fill in
 * defaults for keys it didn't send (that would silently reset tags, rules, pricing…).
 */
const defaults = {
  tags: fields.tags.default([]),
  description: fields.description.default(''),
  rules: fields.rules.default([]),
  participation: fields.participation.default('INDIVIDUAL'),
  teamMin: fields.teamMin.default(1),
  teamMax: fields.teamMax.default(1),
  pricing: fields.pricing.default({ type: 'FREE', amountPaise: 0, per: 'TEAM', modes: [] }),
  online: fields.online.default(false),
  seatsTotal: fields.seatsTotal.default(null),
  coordinators: fields.coordinators.default([]),
};

export interface RuleInput {
  participation?: 'INDIVIDUAL' | 'TEAM';
  teamMin?: number;
  teamMax?: number;
  pricing?: { type: 'FREE' | 'PAID'; amountPaise: number; modes?: readonly string[] };
  startsAt?: Date | null;
  endsAt?: Date | null;
  registrationOpensAt?: Date | null;
  registrationClosesAt?: Date | null;
}

/**
 * Cross-field rules. Run on the *merged* event for updates, because a partial patch can break an
 * invariant together with values already stored (e.g. only `teamMin` sent, above the saved max).
 */
export function eventRuleErrors(v: RuleInput): Record<string, string> {
  const e: Record<string, string> = {};
  if (v.participation === 'INDIVIDUAL' && (v.teamMin !== 1 || v.teamMax !== 1)) e.teamMax = 'Individual events have exactly one participant';
  if (v.participation === 'TEAM' && v.teamMin !== undefined && v.teamMax !== undefined && v.teamMin > v.teamMax) e.teamMax = 'Maximum team size must be at least the minimum';
  if (v.pricing?.type === 'PAID' && v.pricing.amountPaise < 100) e['pricing.amountPaise'] = 'Enter a price of at least ₹1';
  if (v.pricing?.type === 'PAID' && !v.pricing.modes?.length) e['pricing.modes'] = 'Choose how people can pay: online, at the desk, or both';
  if (v.startsAt && v.endsAt && v.endsAt < v.startsAt) e.endsAt = 'End must be after start';
  if (v.registrationOpensAt && v.registrationClosesAt && v.registrationClosesAt <= v.registrationOpensAt) e.registrationClosesAt = 'Registration must close after it opens';
  if (v.registrationClosesAt && v.startsAt && v.registrationClosesAt > v.startsAt) e.registrationClosesAt = 'Registration must close before the event starts';
  return e;
}

const withRules = <T extends RuleInput>(v: T, ctx: z.RefinementCtx) => {
  for (const [path, message] of Object.entries(eventRuleErrors(v))) ctx.addIssue({ code: 'custom', message, path: path.split('.') });
};

export const CreateEventDto = z.object({ ...fields, ...defaults, departmentId: objectId.nullable().default(null) }).superRefine(withRules);
export type CreateEventDto = z.infer<typeof CreateEventDto>;

/** Partial patch + the version that was read. Cross-field rules run in the service on the merged result. */
export const UpdateEventDto = z
  .object({ ...fields, departmentId: objectId.nullable() })
  .partial()
  .extend({ version: z.number().int().min(0) });
export type UpdateEventDto = z.infer<typeof UpdateEventDto>;

export const ReasonDto = z.object({ reason: z.string().trim().min(3, 'Give a short reason').max(300) });

export const AdminEventQuery = z.object({ status: z.enum(EVENT_STATUS).optional() });

export const PublicEventQuery = z.object({
  dept: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9&]{1,12}$/)
    .optional(),
  category: z.enum(EVENT_CATEGORIES).optional(),
  free: z
    .enum(['1', 'true'])
    .optional()
    .transform((v) => !!v),
  q: z.string().trim().max(60).optional(),
  /** One fest day (YYYY-MM-DD, college time). Ignored while searching: a search covers every day. */
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional(),
  cursor: z
    .string()
    .regex(/^\d{1,15}\.[a-f\d]{24}$/i, 'Invalid cursor')
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});
export type PublicEventQuery = z.infer<typeof PublicEventQuery>;

/** `backend/seed/*.json`: one fest + its events, departments by code. */
export const SeedFileDto = z.object({
  fest: z.object({
    slug,
    name: z.string().trim().min(3).max(120),
    editionYear: z.number().int().min(2000).max(2100),
    type: z.enum(['TECHNICAL', 'CULTURAL', 'HACKATHON', 'OTHER']).default('TECHNICAL'),
    tagline: optText(160),
    description: optText(5000),
    startsAt: date,
    endsAt: date,
    venue: optText(160),
    bannerUrl: imageUrl.nullish(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'COMPLETED']).default('DRAFT'),
  }),
  /** Re-running a seed swaps posters that still point here (an earlier hotlink) for the file's own. */
  replaceImagesFrom: z.url({ protocol: /^https$/ }).optional(),
  events: z
    .array(
      z
        .object({
          ...fields,
          ...defaults,
          slug,
          startsAt: date, // catalogue order needs a start time
          department: z
            .string()
            .trim()
            .toUpperCase()
            .nullable(),
        })
        .superRefine(withRules),
    )
    .max(1000),
});
export type SeedFileDto = z.infer<typeof SeedFileDto>;
