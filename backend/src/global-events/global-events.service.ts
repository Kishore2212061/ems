import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/app-exception';
import type { AuthUser } from '../common/decorators';
import { slugify } from '../common/util';
import { DepartmentsService } from '../departments/departments.service';
import { LOCAL_EVENT_MODEL, LocalEvent } from '../local-events/local-event.schema';
import { MediaService } from '../media/media.service';
import { RbacService } from '../rbac/rbac.service';
import { User, USER_MODEL } from '../users/user.schema';
import {
  FEST_LIST_FIELDS,
  FestStatus,
  GLOBAL_EVENT_MODEL,
  GlobalEvent,
  PUBLIC_STATUSES,
  toFestDetail,
  toFestSummary,
} from './global-event.schema';
import type { CloneDto, CreateFestDto, SetDepartmentsDto, UpdateFestDto } from './global-events.dto';

interface Ctx {
  user: AuthUser;
  ip: string;
}

/**
 * Reading: fest admins see their fest; department admins see every fest their department takes
 * part in (multikey index on departments.department_id). Writing: fest-scoped (or org) only — a
 * department admin can't edit the whole fest.
 */
const SCOPE_READ = { globalEventId: '_id', departmentId: 'departments.department_id' } as const;
const SCOPE_WRITE = { globalEventId: '_id' } as const;

const yy = (y: number) => String(y).slice(-2);
/** Slug includes the edition unless the name already does ("Tech Fest 2025" / "Tech Fest '25"). */
const festSlug = (name: string, year: number) =>
  slugify(name.includes(String(year)) || name.includes(`'${yy(year)}`) ? name : `${name} ${year}`);

@Injectable()
export class GlobalEventsService {
  constructor(
    @InjectModel(GLOBAL_EVENT_MODEL) private readonly fests: Model<GlobalEvent>,
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @InjectModel(LOCAL_EVENT_MODEL) private readonly events: Model<LocalEvent>,
    @InjectConnection() private readonly conn: Connection,
    private readonly depts: DepartmentsService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  // ── public ────────────────────────────────────────────────────────────────

  /** Every live fest at once (multi-fest by design). One indexed query, small projection. */
  async listPublic() {
    const rows = await this.fests
      .find({ status: { $in: PUBLIC_STATUSES } })
      .sort({ status: 1, starts_at: 1 })
      .select(FEST_LIST_FIELDS)
      .limit(100)
      .lean();
    // Live first, then suspended, then past editions.
    const rank: Record<string, number> = { PUBLISHED: 0, SUSPENDED: 1, COMPLETED: 2 };
    return rows.sort((a, b) => rank[a.status] - rank[b.status]).map(toFestSummary);
  }

  async getPublic(slug: string) {
    const f = await this.fests.findOne({ slug, status: { $in: PUBLIC_STATUSES } }).lean();
    if (!f) throw Errors.notFound('Fest');
    return toFestDetail(f);
  }

  // ── admin reads (scope-filtered: out-of-scope looks like "not found") ─────

  async listAdmin(user: AuthUser, status?: FestStatus) {
    const scope = this.rbac.scopeFilter(user, 'global_event.read', SCOPE_READ);
    const [rows, counts] = await Promise.all([
      this.fests
        .find(this.rbac.withScope(status ? { status } : {}, scope))
        .sort({ starts_at: -1, _id: -1 })
        .select(FEST_LIST_FIELDS + ' edition_year')
        .limit(200)
        .lean(),
      this.fests.aggregate<{ _id: FestStatus; n: number }>([{ $match: scope }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    return {
      items: rows.map(toFestSummary),
      counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) as Partial<Record<FestStatus, number>>,
    };
  }

  private async loadScoped(id: Types.ObjectId, user: AuthUser, perm: 'global_event.read' | 'global_event.update' | 'global_event.publish') {
    const f = await this.fests.findOne(this.rbac.withScope({ _id: id }, this.rbac.scopeFilter(user, perm, perm === 'global_event.read' ? SCOPE_READ : SCOPE_WRITE))).lean();
    if (!f) throw Errors.notFound('Fest');
    return f;
  }

  async getAdmin(id: Types.ObjectId, user: AuthUser) {
    return toFestDetail(await this.loadScoped(id, user, 'global_event.read'), true);
  }

  // ── writes ────────────────────────────────────────────────────────────────

  async create(dto: CreateFestDto, { user, ip }: Ctx) {
    const departments = await this.depts.resolveForFest(dto.departmentIds ?? []);
    const slug = dto.slug ?? festSlug(dto.name, dto.editionYear);
    dto.bannerUrl = await this.media.ensureHosted(dto.bannerUrl);
    try {
      const f = await this.fests.create({
        slug,
        name: dto.name,
        edition_year: dto.editionYear,
        type: dto.type,
        tagline: dto.tagline,
        description: dto.description,
        starts_at: dto.startsAt ?? null,
        ends_at: dto.endsAt ?? null,
        venue: dto.venue,
        banner_url: dto.bannerUrl ?? null,
        contact_email: dto.contactEmail ?? null,
        departments,
        created_by: new Types.ObjectId(user.id),
      });
      await this.audit.record({ actorId: user.id, action: 'global_event.created', entity: 'global_event', entityId: f._id, after: { name: f.name, slug }, ip });
      return toFestDetail(f.toObject(), true);
    } catch (e: any) {
      if (e?.code === 11000) throw Errors.conflict('SLUG_TAKEN', `The address "${slug}" is already used by another fest`, { slug });
      throw e;
    }
  }

  /** Optimistic update: the write only applies if nobody saved since `version` was read. */
  private async applyVersioned(id: Types.ObjectId, user: AuthUser, version: number, set: Record<string, unknown>) {
    await this.loadScoped(id, user, 'global_event.update'); // scope check (404 if outside)
    const after = await this.fests.findOneAndUpdate({ _id: id, version }, { $set: set, $inc: { version: 1 } }, { new: true }).lean();
    if (!after) throw Errors.conflict('STALE_VERSION', 'Someone else saved this fest in the meantime. Reload to see the latest version.');
    return after;
  }

  async update(id: Types.ObjectId, dto: UpdateFestDto, { user, ip }: Ctx) {
    await this.loadScoped(id, user, 'global_event.update'); // before fetching anything on the user's behalf
    if (dto.bannerUrl) dto.bannerUrl = await this.media.ensureHosted(dto.bannerUrl);
    const set: Record<string, unknown> = {};
    const map: [keyof UpdateFestDto, string][] = [
      ['name', 'name'], ['editionYear', 'edition_year'], ['type', 'type'], ['tagline', 'tagline'], ['description', 'description'],
      ['startsAt', 'starts_at'], ['endsAt', 'ends_at'], ['venue', 'venue'], ['bannerUrl', 'banner_url'], ['contactEmail', 'contact_email'], ['slug', 'slug'],
    ];
    for (const [k, field] of map) if (dto[k] !== undefined) set[field] = dto[k];
    if (dto.departmentIds) {
      set.departments = await this.depts.resolveForFest(dto.departmentIds);
      await this.assertNoOrphanedEvents(id, set.departments as GlobalEvent['departments']);
    }

    let after;
    try {
      after = await this.applyVersioned(id, user, dto.version, set);
    } catch (e: any) {
      if (e?.code === 11000) throw Errors.conflict('SLUG_TAKEN', `The address "${dto.slug}" is already used by another fest`);
      throw e;
    }
    if (dto.name) await this.syncRoleLabels(id, after.name);
    await this.audit.record({ actorId: user.id, action: 'global_event.updated', entity: 'global_event', entityId: id, after: set, ip });
    return toFestDetail(after, true);
  }

  async setDepartments(id: Types.ObjectId, dto: SetDepartmentsDto, { user, ip }: Ctx) {
    const departments = await this.depts.resolveForFest(dto.departmentIds);
    await this.assertNoOrphanedEvents(id, departments);
    const after = await this.applyVersioned(id, user, dto.version, { departments });
    await this.audit.record({
      actorId: user.id,
      action: 'global_event.departments_set',
      entity: 'global_event',
      entityId: id,
      after: { departments: departments.map((d) => d.code) },
      ip,
    });
    return toFestDetail(after, true);
  }

  /** A department can leave a fest only once it has no (non-cancelled) events there. */
  private async assertNoOrphanedEvents(id: Types.ObjectId, departments: GlobalEvent['departments']) {
    const keep = departments.map((d) => d.department_id);
    const orphan = await this.events
      .findOne({ global_event_id: id, department_id: { $nin: [...keep, null] }, status: { $ne: 'CANCELLED' } })
      .select('department_code')
      .lean();
    if (orphan) {
      throw Errors.conflict('DEPARTMENT_HAS_EVENTS', `${orphan.department_code} still has events in this fest. Delete, cancel or move them first.`, {
        department: orphan.department_code,
      });
    }
  }

  /** Keep "Admin · NEC Tech Fest '25" labels on users in sync with a renamed fest. */
  private syncRoleLabels(id: Types.ObjectId, name: string) {
    return this.users.updateMany(
      { 'roles.scope_id': id },
      { $set: { 'roles.$[r].scope_label': name } },
      { arrayFilters: [{ 'r.scope_id': id, 'r.scope_type': 'GLOBAL_EVENT' }] },
    );
  }

  // ── lifecycle (conditional updates: a transition can only happen once) ───

  private async transition(
    id: Types.ObjectId,
    { user, ip }: Ctx,
    from: FestStatus[],
    to: FestStatus,
    extra: Record<string, unknown> = {},
  ) {
    const current = await this.loadScoped(id, user, 'global_event.publish');
    const after = await this.fests
      .findOneAndUpdate({ _id: id, status: { $in: from } }, { $set: { status: to, ...extra }, $inc: { version: 1 } }, { new: true })
      .lean();
    if (!after) {
      throw Errors.conflict('INVALID_TRANSITION', `A ${current.status.toLowerCase()} fest can't be moved to ${to.toLowerCase()}`, {
        status: current.status,
      });
    }
    await this.audit.record({
      actorId: user.id,
      action: `global_event.${to.toLowerCase()}`,
      entity: 'global_event',
      entityId: id,
      before: { status: current.status },
      after: { status: to, ...extra },
      ip,
    });
    return toFestDetail(after, true);
  }

  async publish(id: Types.ObjectId, ctx: Ctx) {
    const f = await this.loadScoped(id, ctx.user, 'global_event.publish');
    const missing: string[] = [];
    if (f.departments.length === 0) missing.push('departments');
    if (!f.starts_at) missing.push('startsAt');
    if (!f.ends_at) missing.push('endsAt');
    if (!(await this.events.exists({ global_event_id: id, status: 'PUBLISHED' }))) missing.push('events');
    if (missing.length) {
      throw Errors.unprocessable('PUBLISH_REQUIREMENTS', 'Add the missing details before publishing', { missing });
    }
    return this.transition(id, ctx, ['DRAFT'], 'PUBLISHED', { published_at: new Date(), suspend_reason: null });
  }

  suspend(id: Types.ObjectId, reason: string, ctx: Ctx) {
    return this.transition(id, ctx, ['PUBLISHED'], 'SUSPENDED', { suspend_reason: reason });
  }

  reactivate(id: Types.ObjectId, ctx: Ctx) {
    return this.transition(id, ctx, ['SUSPENDED'], 'PUBLISHED', { suspend_reason: null });
  }

  async complete(id: Types.ObjectId, ctx: Ctx) {
    const f = await this.loadScoped(id, ctx.user, 'global_event.publish');
    if (f.ends_at && f.ends_at > new Date()) {
      throw Errors.conflict('EVENT_NOT_OVER', 'A fest can be marked completed only after it ends');
    }
    return this.transition(id, ctx, ['PUBLISHED', 'SUSPENDED'], 'COMPLETED');
  }

  /** Next year's edition as a DRAFT: same structure, dates shifted by the year difference. */
  async clone(id: Types.ObjectId, dto: CloneDto, { user, ip }: Ctx) {
    const src = await this.loadScoped(id, user, 'global_event.read');
    const years = dto.editionYear - src.edition_year;
    const shift = (d?: Date | null) => (d ? new Date(new Date(d).setFullYear(new Date(d).getFullYear() + years)) : null);
    const name =
      dto.name ??
      (src.name.includes(String(src.edition_year))
        ? src.name.replace(String(src.edition_year), String(dto.editionYear))
        : src.name.includes(`'${yy(src.edition_year)}`)
          ? src.name.replace(`'${yy(src.edition_year)}`, `'${yy(dto.editionYear)}`)
          : `${src.name} ${dto.editionYear}`);

    // Events come along as drafts with the same year shift (cancelled ones stay behind).
    const srcEvents = await this.events.find({ global_event_id: src._id, status: { $ne: 'CANCELLED' } }).lean();
    const actor = new Types.ObjectId(user.id);

    const base = festSlug(name, dto.editionYear);
    for (let i = 0; i < 5; i++) {
      const slug = i === 0 ? base : `${base}-${i + 1}`;
      const session = await this.conn.startSession();
      try {
        let created!: GlobalEvent;
        // One transaction: the new edition never exists with only some of its events.
        await session.withTransaction(async () => {
          const [f] = await this.fests.create(
            [
              {
                slug,
                name,
                edition_year: dto.editionYear,
                type: src.type,
                tagline: src.tagline,
                description: src.description,
                starts_at: shift(src.starts_at),
                ends_at: shift(src.ends_at),
                venue: src.venue,
                banner_url: src.banner_url,
                contact_email: src.contact_email,
                departments: src.departments,
                created_by: actor,
              },
            ],
            { session },
          );
          if (srcEvents.length) {
            await this.events.insertMany(
              srcEvents.map(({ _id, created_at: _c, updated_at: _u, ...e }) => ({
                ...e,
                global_event_id: f._id,
                status: 'DRAFT',
                status_reason: null,
                published_at: null,
                starts_at: shift(e.starts_at),
                ends_at: shift(e.ends_at),
                registration_opens_at: shift(e.registration_opens_at),
                registration_closes_at: shift(e.registration_closes_at),
                seats_confirmed: 0,
                seats_held: 0,
                price_version: 0,
                version: 0,
                created_by: actor,
              })),
              { session },
            );
          }
          await this.audit.record(
            { actorId: user.id, action: 'global_event.cloned', entity: 'global_event', entityId: f._id, meta: { from: String(src._id), events: srcEvents.length }, ip },
            session,
          );
          created = f.toObject();
        });
        return toFestDetail(created, true);
      } catch (e: any) {
        if (e?.code !== 11000) throw e;
      } finally {
        await session.endSession();
      }
    }
    throw Errors.conflict('SLUG_TAKEN', 'Could not find a free address for the new edition; pass a different name');
  }
}
