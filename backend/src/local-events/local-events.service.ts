import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/app-exception';
import type { AuthUser } from '../common/decorators';
import { slugify } from '../common/util';
import { GLOBAL_EVENT_MODEL, GlobalEvent, PUBLIC_STATUSES } from '../global-events/global-event.schema';
import { MediaService } from '../media/media.service';
import { RbacService } from '../rbac/rbac.service';
import { REGISTRATION_MODEL, type Registration } from '../registrations/registration.schema';
import { effectiveEnd, istDayRange } from '../registrations/schedule';
import { eventRuleErrors, type CreateEventDto, type PublicEventQuery, type UpdateEventDto } from './local-events.dto';
import {
  ADMIN_ROW_FIELDS,
  CARD_FIELDS,
  CLOSED_STATUSES,
  EventStatus,
  LISTED_STATUSES,
  LOCAL_EVENT_MODEL,
  LocalEvent,
  toEventCard,
  toEventDetail,
  VISIBLE_STATUSES,
} from './local-event.schema';

interface Ctx {
  user: AuthUser;
  ip: string;
}
type Perm = 'local_event.read' | 'local_event.manage' | 'local_event.publish' | 'local_event.cancel';

/** A local event sits inside a fest and (usually) a department; roles at either level reach it. */
const SCOPE = { globalEventId: 'global_event_id', departmentId: 'department_id', localEventId: '_id' } as const;
const FEST_CLOSED = ['COMPLETED', 'CANCELLED'];

/** Keyset cursor over the catalogue order (starts_at, _id): stable under inserts, no skip(). */
const cursorOf = (e: Pick<LocalEvent, '_id' | 'starts_at'>) => `${e.starts_at?.getTime() ?? 0}.${e._id}`;

const FIELD_MAP: [keyof CreateEventDto, keyof LocalEvent][] = [
  ['name', 'name'], ['slug', 'slug'], ['tagline', 'tagline'], ['category', 'category'], ['organizer', 'organizer'], ['tags', 'tags'],
  ['description', 'description'], ['rules', 'rules'], ['participation', 'participation'], ['teamMin', 'team_min'], ['teamMax', 'team_max'],
  ['online', 'online'], ['seatsTotal', 'seats_total'], ['registrationOpensAt', 'registration_opens_at'],
  ['registrationClosesAt', 'registration_closes_at'], ['startsAt', 'starts_at'], ['endsAt', 'ends_at'], ['venue', 'venue'],
  ['coordinators', 'coordinators'], ['resourcePerson', 'resource_person'], ['bannerUrl', 'banner_url'],
];

/** DTO (camelCase, partial) → document fields. Only keys that were sent. */
export function toEventFields(d: Partial<CreateEventDto>): Partial<LocalEvent> {
  const set: Record<string, unknown> = {};
  for (const [k, field] of FIELD_MAP) if (d[k] !== undefined) set[field] = d[k];
  if (d.pricing) {
    const paid = d.pricing.type === 'PAID';
    set.pricing = { type: d.pricing.type, amount_paise: paid ? d.pricing.amountPaise : 0, per: d.pricing.per, modes: paid ? [...new Set(d.pricing.modes)] : [] };
  }
  if (set.participation === 'INDIVIDUAL') Object.assign(set, { team_min: 1, team_max: 1 });
  return set as Partial<LocalEvent>;
}

/** What a live event must have. */
export function publishGaps(e: Partial<LocalEvent>) {
  const missing: string[] = [];
  if (!e.starts_at) missing.push('startsAt');
  if (!e.venue && !e.online) missing.push('venue');
  if (!e.description?.trim()) missing.push('description');
  return missing;
}

@Injectable()
export class LocalEventsService {
  constructor(
    @InjectModel(LOCAL_EVENT_MODEL) private readonly events: Model<LocalEvent>,
    @InjectModel(GLOBAL_EVENT_MODEL) private readonly fests: Model<GlobalEvent>,
    @InjectModel(REGISTRATION_MODEL) private readonly regs: Model<Registration>,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  // ── public ────────────────────────────────────────────────────────────────

  private async publicFest(slug: string) {
    const f = await this.fests.findOne({ slug, status: { $in: PUBLIC_STATUSES } }).select('_id slug name status departments').lean();
    if (!f) throw Errors.notFound('Fest');
    return f;
  }

  /**
   * Catalogue page. Browsing walks an index in (starts_at, _id) order with a keyset cursor; search
   * uses the weighted $text index (never a regex, so no ReDoS) and returns the 20 best matches.
   */
  async listPublic(festSlug: string, q: PublicEventQuery) {
    const fest = await this.publicFest(festSlug);
    const base = { global_event_id: fest._id, status: { $in: LISTED_STATUSES } };
    // Chip counts for the whole fest, only with the first page (they don't change while scrolling).
    const facets = q.cursor ? undefined : this.facets(base);

    const filter: Record<string, unknown> = { ...base };
    if (q.dept) {
      const d = fest.departments.find((x) => x.code === q.dept);
      if (!d) return { items: [], nextCursor: null, ...(facets && { facets: await facets }) };
      filter.department_id = d.department_id;
    }
    if (q.category) filter.category = q.category;
    if (q.free) filter['pricing.type'] = 'FREE';

    if (q.q) {
      const rows = await this.events
        .find({ ...filter, $text: { $search: q.q } })
        .sort({ score: { $meta: 'textScore' }, starts_at: 1 })
        .limit(20)
        .select(CARD_FIELDS)
        .lean();
      return { items: rows.map(toEventCard), nextCursor: null, ...(facets && { facets: await facets }) };
    }

    if (q.day) {
      // One fest day: a range on starts_at, which every list index already has right after its equality fields.
      const { start, end } = istDayRange(q.day);
      filter.starts_at = { $gte: start, $lt: end };
    }
    if (q.cursor) {
      const [ms, id] = q.cursor.split('.');
      const at = new Date(Number(ms));
      filter.$or = [{ starts_at: { $gt: at } }, { starts_at: at, _id: { $gt: new Types.ObjectId(id) } }];
    }
    const page = await this.events.find(filter).sort({ starts_at: 1, _id: 1 }).limit(q.limit + 1).select(CARD_FIELDS).lean();
    const rows = page.slice(0, q.limit);
    return {
      items: rows.map(toEventCard),
      nextCursor: page.length > q.limit ? cursorOf(rows[rows.length - 1]) : null,
      ...(facets && { facets: await facets }),
    };
  }

  private async facets(base: Record<string, unknown>) {
    const [r] = await this.events.aggregate<{
      departments: { _id: string | null; n: number }[];
      categories: { _id: string; n: number }[];
      paid: { n: number }[];
      days: { _id: string | null; n: number }[];
    }>([
      { $match: base },
      {
        $facet: {
          departments: [{ $group: { _id: '$department_code', n: { $sum: 1 } } }],
          categories: [{ $group: { _id: '$category', n: { $sum: 1 } } }],
          paid: [{ $match: { 'pricing.type': 'PAID' } }, { $count: 'n' }],
          // Day tabs: events per calendar day in college time.
          days: [{ $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$starts_at', timezone: 'Asia/Kolkata' } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }],
        },
      },
    ]);
    return {
      total: r.categories.reduce((s, c) => s + c.n, 0),
      departments: Object.fromEntries(r.departments.filter((d) => d._id).map((d) => [d._id, d.n])) as Record<string, number>,
      categories: Object.fromEntries(r.categories.map((c) => [c._id, c.n])) as Record<string, number>,
      paid: r.paid[0]?.n ?? 0,
      days: r.days.filter((d) => d._id).map((d) => ({ day: d._id!, n: d.n })),
    };
  }

  async getPublic(festSlug: string, eventSlug: string) {
    const fest = await this.publicFest(festSlug);
    const e = await this.events.findOne({ global_event_id: fest._id, slug: eventSlug, status: { $in: VISIBLE_STATUSES } }).lean();
    if (!e) throw Errors.notFound('Event');
    return { ...toEventDetail(e), fest: { slug: fest.slug, name: fest.name, status: fest.status } };
  }

  // ── admin reads (scope-filtered: out of scope looks like "not found") ─────

  async listForFest(festId: Types.ObjectId, user: AuthUser, status?: EventStatus) {
    const scope = this.rbac.scopeFilter(user, 'local_event.read', SCOPE);
    const all = this.rbac.withScope({ global_event_id: festId }, scope);
    const [rows, counts] = await Promise.all([
      this.events
        .find(status ? this.rbac.withScope({ global_event_id: festId, status }, scope) : all)
        .sort({ starts_at: 1, _id: 1 })
        .select(ADMIN_ROW_FIELDS)
        .limit(500)
        .lean(),
      this.events.aggregate<{ _id: EventStatus; n: number }>([{ $match: all }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    return {
      // `taken` = registrations holding a seat (confirmed + pending payment), also for events without a cap.
      items: rows.map((e) => ({ ...toEventCard(e), updatedAt: e.updated_at, taken: (e.seats_confirmed ?? 0) + (e.seats_held ?? 0) })),
      counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) as Partial<Record<EventStatus, number>>,
    };
  }

  private async loadScoped(id: Types.ObjectId, user: AuthUser, perm: Perm) {
    const e = await this.events.findOne(this.rbac.withScope({ _id: id }, this.rbac.scopeFilter(user, perm, SCOPE))).lean();
    if (!e) throw Errors.notFound('Event');
    return e;
  }

  async getAdmin(id: Types.ObjectId, user: AuthUser) {
    return toEventDetail(await this.loadScoped(id, user, 'local_event.read'), true);
  }

  // ── writes ────────────────────────────────────────────────────────────────

  /** The department must take part in the fest; its code/name come from the fest's own list (no lookup). */
  private festDepartment(fest: Pick<GlobalEvent, 'departments'>, departmentId: Types.ObjectId | null | undefined) {
    if (!departmentId) return { department_id: null, department_code: null, department_name: null };
    const d = fest.departments.find((x) => x.department_id.equals(departmentId));
    if (!d) throw Errors.badRequest('DEPARTMENT_NOT_IN_FEST', 'That department is not part of this fest. Add it to the fest first.');
    return { department_id: d.department_id, department_code: d.code, department_name: d.name };
  }

  private async openFest(festId: Types.ObjectId) {
    const fest = await this.fests.findById(festId).select('_id status departments').lean();
    if (!fest) throw Errors.notFound('Fest');
    if (FEST_CLOSED.includes(fest.status)) throw Errors.conflict('FEST_CLOSED', `This fest is ${fest.status.toLowerCase()}, so its events can't change`);
    return fest;
  }

  /** Insert with a readable, unique-per-fest address: "paper-presentation", then "-cse", then "-2"… */
  private async insertWithSlug(doc: Record<string, unknown>, explicit: string | undefined, deptCode: string | null) {
    const base = slugify(String(doc.name)) || `event-${Date.now().toString(36)}`;
    const candidates = explicit ? [explicit] : [...new Set([base, deptCode && `${base}-${deptCode.toLowerCase()}`, `${base}-2`, `${base}-3`, `${base}-4`].filter(Boolean) as string[])];
    for (const slug of candidates) {
      try {
        return (await this.events.create({ ...doc, slug })).toObject();
      } catch (e: any) {
        if (e?.code !== 11000) throw e;
      }
    }
    throw Errors.conflict('SLUG_TAKEN', explicit ? `The address "${explicit}" is already used in this fest` : 'Could not find a free address; set one manually');
  }

  async create(festId: Types.ObjectId, dto: CreateEventDto, { user, ip }: Ctx) {
    this.rbac.assertCan(user, 'local_event.manage', { globalEventId: festId, departmentId: dto.departmentId });
    const fest = await this.openFest(festId);
    const dept = this.festDepartment(fest, dto.departmentId);
    const { slug, departmentId: _d, ...rest } = dto;
    rest.bannerUrl = await this.media.ensureHosted(rest.bannerUrl); // a link elsewhere → our resized copy
    const e = await this.insertWithSlug(
      { global_event_id: festId, ...dept, ...toEventFields(rest), status: 'DRAFT', created_by: new Types.ObjectId(user.id) },
      slug,
      dept.department_code,
    );
    await this.audit.record({ actorId: user.id, action: 'local_event.created', entity: 'local_event', entityId: e._id, after: { name: e.name, slug: e.slug, festId: String(festId) }, ip });
    return toEventDetail(e, true);
  }

  /**
   * Optimistic update (`version`). Capacity can't drop below seats already taken: checked inside
   * the same atomic update with $expr, so it also holds against registrations racing the edit.
   */
  async update(id: Types.ObjectId, dto: UpdateEventDto, { user, ip }: Ctx) {
    const cur = await this.loadScoped(id, user, 'local_event.manage');
    if (CLOSED_STATUSES.includes(cur.status)) throw Errors.conflict('EVENT_CLOSED', `A ${cur.status.toLowerCase()} event can't be edited`);
    const { version, departmentId, ...rest } = dto;
    if (rest.bannerUrl && rest.bannerUrl !== cur.banner_url) rest.bannerUrl = await this.media.ensureHosted(rest.bannerUrl);
    const set = toEventFields(rest);

    if (departmentId !== undefined && String(departmentId ?? '') !== String(cur.department_id ?? '')) {
      // Moving an event is only allowed within your own reach (a CSE admin can't hand it to IT).
      this.rbac.assertCan(user, 'local_event.manage', { globalEventId: cur.global_event_id, departmentId });
      Object.assign(set, this.festDepartment(await this.openFest(cur.global_event_id), departmentId));
    }

    const merged = { ...cur, ...set } as LocalEvent;
    const errors = eventRuleErrors({
      participation: merged.participation,
      teamMin: merged.team_min,
      teamMax: merged.team_max,
      pricing: { type: merged.pricing.type, amountPaise: merged.pricing.amount_paise, modes: merged.pricing.modes },
      startsAt: merged.starts_at,
      endsAt: merged.ends_at,
      registrationOpensAt: merged.registration_opens_at,
      registrationClosesAt: merged.registration_closes_at,
    });
    if (Object.keys(errors).length) throw Errors.validation({ fields: errors });
    if (cur.status !== 'DRAFT') {
      const missing = publishGaps(merged);
      if (missing.length) throw Errors.unprocessable('PUBLISH_REQUIREMENTS', 'A published event needs these details', { missing });
    }

    const inc: Record<string, number> = { version: 1 };
    const p = set.pricing;
    if (p && (p.type !== cur.pricing.type || p.amount_paise !== cur.pricing.amount_paise || p.per !== cur.pricing.per)) inc.price_version = 1;

    const filter: Record<string, unknown> = { _id: id, version };
    if (typeof set.seats_total === 'number') filter.$expr = { $gte: [set.seats_total, { $add: ['$seats_confirmed', '$seats_held'] }] };

    let after: LocalEvent | null;
    try {
      after = await this.events.findOneAndUpdate(filter, { $set: set, $inc: inc }, { new: true }).lean();
    } catch (e: any) {
      if (e?.code === 11000) throw Errors.conflict('SLUG_TAKEN', `The address "${String(set.slug)}" is already used in this fest`);
      throw e;
    }
    if (!after) {
      const now = await this.events.findById(id).select('version seats_confirmed seats_held').lean();
      if (now && now.version === version && typeof set.seats_total === 'number') {
        const taken = now.seats_confirmed + now.seats_held;
        throw Errors.conflict('CAPACITY_BELOW_BOOKED', `${taken} seats are already taken, so capacity can't go below ${taken}`, { taken });
      }
      throw Errors.conflict('STALE_VERSION', 'Someone else saved this event in the meantime. Reload to see the latest version.');
    }
    const ms = (d: Date | null) => d?.getTime() ?? null;
    if (after.starts_at && (ms(after.starts_at) !== ms(cur.starts_at) || ms(after.ends_at) !== ms(cur.ends_at))) {
      // Registrants' schedules follow the event, so clash checks use the new time from now on.
      await this.regs.updateMany({ local_event_id: id, active: true }, { $set: { starts_at: after.starts_at, ends_at: effectiveEnd(after.starts_at, after.ends_at) } });
    }
    await this.audit.record({
      actorId: user.id,
      action: 'local_event.updated',
      entity: 'local_event',
      entityId: id,
      after: set,
      ...(inc.price_version && { meta: { priceVersion: after.price_version } }),
      ip,
    });
    return toEventDetail(after, true);
  }

  // ── lifecycle (conditional updates: each transition happens once) ─────────

  private async transition(
    id: Types.ObjectId,
    { user, ip }: Ctx,
    perm: Perm,
    from: EventStatus[],
    to: EventStatus,
    extra: Record<string, unknown> = {},
    guard?: (e: LocalEvent) => Promise<void> | void,
  ) {
    const cur = await this.loadScoped(id, user, perm);
    await guard?.(cur);
    const after = await this.events
      .findOneAndUpdate({ _id: id, status: { $in: from } }, { $set: { status: to, ...extra }, $inc: { version: 1 } }, { new: true })
      .lean();
    if (!after) {
      throw Errors.conflict('INVALID_TRANSITION', `A ${cur.status.toLowerCase()} event can't be moved to ${to.toLowerCase()}`, { status: cur.status });
    }
    await this.audit.record({ actorId: user.id, action: `local_event.${to.toLowerCase()}`, entity: 'local_event', entityId: id, before: { status: cur.status }, after: { status: to, ...extra }, ip });
    return toEventDetail(after, true);
  }

  publish(id: Types.ObjectId, ctx: Ctx) {
    return this.transition(id, ctx, 'local_event.publish', ['DRAFT'], 'PUBLISHED', { published_at: new Date(), status_reason: null }, async (e) => {
      await this.openFest(e.global_event_id);
      const missing = publishGaps(e);
      if (missing.length) throw Errors.unprocessable('PUBLISH_REQUIREMENTS', 'Add the missing details before publishing', { missing });
    });
  }

  suspend(id: Types.ObjectId, reason: string, ctx: Ctx) {
    return this.transition(id, ctx, 'local_event.publish', ['PUBLISHED'], 'SUSPENDED', { status_reason: reason });
  }

  reactivate(id: Types.ObjectId, ctx: Ctx) {
    return this.transition(id, ctx, 'local_event.publish', ['SUSPENDED'], 'PUBLISHED', { status_reason: null }, (e) => this.openFest(e.global_event_id).then(() => {}));
  }

  /**
   * Registrants are freed: pending online holds end, and every registration stops blocking the
   * person's schedule (they can sign up for something else in that slot). Paid entries are
   * refunded by the refunds module when it lands.
   */
  async cancel(id: Types.ObjectId, reason: string, ctx: Ctx) {
    const out = await this.transition(id, ctx, 'local_event.cancel', ['DRAFT', 'PUBLISHED', 'SUSPENDED'], 'CANCELLED', { status_reason: reason });
    await this.regs.updateMany(
      { local_event_id: id, status: 'PAYMENT_PENDING' },
      { $set: { status: 'CANCELLED', active: false, hold_expires_at: null, cancel_reason: `Event cancelled: ${reason}`, cancelled_at: new Date() } },
    );
    await this.regs.updateMany({ local_event_id: id, active: true }, { $set: { active: false } });
    return out;
  }

  complete(id: Types.ObjectId, ctx: Ctx) {
    return this.transition(id, ctx, 'local_event.publish', ['PUBLISHED', 'SUSPENDED'], 'COMPLETED', {}, (e) => {
      const over = e.ends_at ?? e.starts_at;
      if (!over || over > new Date()) throw Errors.conflict('EVENT_NOT_OVER', 'An event can be marked completed only after it has taken place');
    });
  }

  /** Only never-published drafts can be deleted; anything that went live is cancelled instead (registrants keep a record). */
  async removeDraft(id: Types.ObjectId, { user, ip }: Ctx) {
    const cur = await this.loadScoped(id, user, 'local_event.manage');
    const r = await this.events.deleteOne({ _id: id, status: 'DRAFT', published_at: null });
    if (r.deletedCount !== 1) throw Errors.conflict('NOT_A_DRAFT', 'Only drafts that were never published can be deleted. Cancel the event instead.');
    await this.audit.record({ actorId: user.id, action: 'local_event.deleted', entity: 'local_event', entityId: id, before: { name: cur.name, slug: cur.slug }, ip });
  }

  /** Duplicate inside the same fest as a draft ("Paper Presentation (copy)"). */
  async clone(id: Types.ObjectId, { user, ip }: Ctx) {
    const src = await this.loadScoped(id, user, 'local_event.manage');
    await this.openFest(src.global_event_id);
    const { _id, slug: _s, created_at: _c, updated_at: _u, ...rest } = src;
    const e = await this.insertWithSlug(
      {
        ...rest,
        name: `${src.name} (copy)`.slice(0, 120),
        status: 'DRAFT',
        status_reason: null,
        published_at: null,
        seats_confirmed: 0,
        seats_held: 0,
        price_version: 0,
        version: 0,
        created_by: new Types.ObjectId(user.id),
      },
      undefined,
      src.department_code,
    );
    await this.audit.record({ actorId: user.id, action: 'local_event.cloned', entity: 'local_event', entityId: e._id, meta: { from: String(_id) }, ip });
    return toEventDetail(e, true);
  }
}
