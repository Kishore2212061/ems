import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CHECK_IN_MODEL, CheckIn } from '../checkins/checkins.service';
import { Errors } from '../common/app-exception';
import type { AuthUser } from '../common/decorators';
import { GLOBAL_EVENT_MODEL, GlobalEvent } from '../global-events/global-event.schema';
import { LOCAL_EVENT_MODEL, LocalEvent } from '../local-events/local-event.schema';
import { ORDER_MODEL, Order } from '../payments/order.schema';
import { REFUND_MODEL, Refund } from '../payments/refund.schema';
import { RbacService } from '../rbac/rbac.service';
import { REGISTRATION_MODEL, Registration } from '../registrations/registration.schema';
import { DAILY_STAT_MODEL, DailyStat, STAT_FIELDS } from '../stats/stats.service';

type Id = Types.ObjectId;
export const REPORT_SCOPE = { globalEventId: 'global_event_id', departmentId: 'department_id', localEventId: 'local_event_id' } as const;
const TZ = 'Asia/Kolkata';
const CACHE_MS = 5 * 60_000;

type Totals = Record<(typeof STAT_FIELDS)[number], number>;
const sumFields = Object.fromEntries(STAT_FIELDS.map((f) => [f, { $sum: `$${f}` }]));

/**
 * Dashboards read the pre-aggregated `daily_stats` (a few small documents per event); only the
 * "top colleges" report touches raw registrations, and it is cached for 5 minutes.
 */
@Injectable()
export class ReportsService {
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    @InjectModel(DAILY_STAT_MODEL) private readonly stats: Model<DailyStat>,
    @InjectModel(GLOBAL_EVENT_MODEL) private readonly fests: Model<GlobalEvent>,
    @InjectModel(LOCAL_EVENT_MODEL) private readonly events: Model<LocalEvent>,
    @InjectModel(REGISTRATION_MODEL) private readonly regs: Model<Registration>,
    @InjectModel(ORDER_MODEL) private readonly orders: Model<Order>,
    @InjectModel(REFUND_MODEL) private readonly refunds: Model<Refund>,
    @InjectModel(CHECK_IN_MODEL) private readonly checkins: Model<CheckIn>,
    private readonly rbac: RbacService,
  ) {}

  private scope(user: AuthUser) {
    return this.rbac.scopeFilter(user, 'report.read', REPORT_SCOPE);
  }

  private async fest(festId: Id) {
    const f = await this.fests.findById(festId).select('_id name slug edition_year departments status starts_at ends_at').lean();
    if (!f) throw Errors.notFound('Fest');
    return f;
  }

  private async totals(match: Record<string, unknown>): Promise<Totals> {
    const [t] = await this.stats.aggregate<Totals>([{ $match: match }, { $group: { _id: null, ...sumFields } }]);
    return Object.fromEntries(STAT_FIELDS.map((f) => [f, t?.[f] ?? 0])) as Totals;
  }

  /** KPI totals, a per-day series, per-department and top events, and the previous edition's totals. */
  async overview(user: AuthUser, festId: Id) {
    const fest = await this.fest(festId);
    const match = this.rbac.withScope({ global_event_id: festId }, this.scope(user));
    const money = this.rbac.can(user, 'report.finance', { globalEventId: festId });
    const [r] = await this.stats.aggregate<{ days: (Totals & { _id: string })[]; depts: (Totals & { _id: Id | null })[]; top: (Totals & { _id: Id })[] }>([
      { $match: match },
      {
        $facet: {
          days: [{ $group: { _id: '$day', ...sumFields } }, { $sort: { _id: 1 } }],
          depts: [{ $group: { _id: '$department_id', ...sumFields } }],
          top: [{ $group: { _id: '$local_event_id', ...sumFields } }, { $sort: { people: -1, registrations: -1 } }, { $limit: 8 }],
        },
      },
    ]);
    const totals = Object.fromEntries(STAT_FIELDS.map((f) => [f, r.days.reduce((s, d) => s + d[f], 0)])) as Totals;
    const names = new Map((await this.events.find({ _id: { $in: r.top.map((t) => t._id) } }).select('name').lean()).map((e) => [String(e._id), e.name]));
    const deptName = new Map(fest.departments.map((d) => [String(d.department_id), d.code]));
    const previous = await this.previousEdition(fest, user);
    const view = (t: Totals) => ({
      registrations: t.registrations,
      people: t.people,
      cancellations: t.cancellations,
      checkins: t.checkins,
      revenuePaise: money ? t.revenue_paise : null,
      refundsPaise: money ? t.refunds_paise : null,
      netPaise: money ? t.revenue_paise - t.refunds_paise : null,
    });
    return {
      fest: { id: String(fest._id), name: fest.name, slug: fest.slug, status: fest.status },
      totals: view(totals),
      daily: r.days.slice(-45).map((d) => ({ day: d._id, registrations: d.registrations, people: d.people, checkins: d.checkins, revenuePaise: money ? d.revenue_paise : null })),
      departments: r.depts
        .map((d) => ({ code: d._id ? (deptName.get(String(d._id)) ?? '—') : 'Fest-wide', registrations: d.registrations, people: d.people, checkins: d.checkins }))
        .sort((a, b) => b.people - a.people),
      topEvents: r.top.map((t) => ({ id: String(t._id), name: names.get(String(t._id)) ?? 'Event', registrations: t.registrations, people: t.people, checkins: t.checkins })),
      previous: previous && { fest: previous.fest, totals: view(previous.totals) },
    };
  }

  /** The latest earlier edition of the same fest ("NEC Tech Fest '25" for '27). */
  private async previousEdition(fest: Pick<GlobalEvent, '_id' | 'name' | 'edition_year'>, user: AuthUser) {
    const base = fest.name.replace(/\s*['’]?\d{2,4}\s*$/, '').trim();
    if (!base) return null;
    const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prev = await this.fests
      .findOne({ _id: { $ne: fest._id }, edition_year: { $lt: fest.edition_year }, name: new RegExp(`^${esc}\\b`, 'i') })
      .sort({ edition_year: -1 })
      .select('_id name edition_year')
      .lean();
    if (!prev) return null;
    return { fest: { id: String(prev._id), name: prev.name, editionYear: prev.edition_year }, totals: await this.totals(this.rbac.withScope({ global_event_id: prev._id }, this.scope(user))) };
  }

  /** Where participants come from (by the team leader's college). Raw aggregation, cached 5 min. */
  async colleges(user: AuthUser, festId: Id) {
    const key = `colleges:${festId}:${JSON.stringify(this.scope(user))}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const rows = await this.regs.aggregate<{ _id: string; registrations: number; people: number }>([
      { $match: this.rbac.withScope({ global_event_id: festId, status: 'CONFIRMED' }, this.scope(user)) },
      { $project: { people: { $size: '$members' }, leader: { $first: { $filter: { input: '$members', as: 'm', cond: '$$m.leader' } } } } },
      { $group: { _id: { $toLower: { $trim: { input: { $ifNull: ['$leader.college', 'Not given'] } } } }, registrations: { $sum: 1 }, people: { $sum: '$people' } } },
      { $sort: { people: -1 } },
      { $limit: 10 },
    ]);
    const value = { items: rows.map((r) => ({ college: r._id.replace(/\b\w/g, (c) => c.toUpperCase()), registrations: r.registrations, people: r.people })) };
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  /**
   * Recompute a fest's daily_stats from the source collections (backfill, or repair after a crash
   * between a write and its $inc). Super Admin; run when the fest is quiet.
   */
  async rebuild(festId: Id) {
    await this.fest(festId);
    const day = (field: string) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: TZ } });
    const counted = { $in: ['NOT_REQUIRED', 'DUE', 'PAID', 'REFUNDED'] };
    // Money that arrived with no seat to give was refunded and never counted as revenue.
    const lateOrders = (await this.refunds.find({ global_event_id: festId, source: 'LATE_PAYMENT' }).select('order_id').lean()).map((r) => r.order_id);
    const evs = new Map((await this.events.find({ global_event_id: festId }).select('_id department_id').lean()).map((e) => [String(e._id), e]));
    const eventIds = [...evs.values()].map((e) => e._id);
    type Row = { _id: { e: Id; d: string; dep: Id | null }; v: number };
    const group = (v: unknown) => ({ $group: { _id: { e: '$local_event_id', d: '$day', dep: '$department_id' }, v: { $sum: v } } });
    const [regs, people, cancels, revenue, refunds, checks] = await Promise.all([
      this.regs.aggregate<Row>([{ $match: { global_event_id: festId, status: { $in: ['CONFIRMED', 'CANCELLED'] }, 'payment.status': counted } }, { $addFields: { day: day('$created_at') } }, group(1)]),
      this.regs.aggregate<Row>([{ $match: { global_event_id: festId, status: { $in: ['CONFIRMED', 'CANCELLED'] }, 'payment.status': counted } }, { $addFields: { day: day('$created_at') } }, group({ $size: '$members' })]),
      this.regs.aggregate<Row>([{ $match: { global_event_id: festId, status: 'CANCELLED', 'payment.status': counted, cancelled_at: { $ne: null } } }, { $addFields: { day: day('$cancelled_at') } }, group(1)]),
      this.orders.aggregate<Row>([{ $match: { global_event_id: festId, status: 'PAID', _id: { $nin: lateOrders } } }, { $addFields: { day: day('$paid_at') } }, group('$amount_paise')]),
      this.refunds.aggregate<Row>([{ $match: { global_event_id: festId, status: { $in: ['SUCCEEDED', 'MANUAL_DONE'] }, source: { $in: ['REQUEST', 'EVENT_CANCELLED'] } } }, { $addFields: { day: day('$updated_at') } }, group('$amount_paise')]),
      this.checkins.aggregate<{ _id: { e: Id; d: string }; v: number }>([{ $match: { local_event_id: { $in: eventIds }, result: 'OK' } }, { $addFields: { day: day('$scanned_at') } }, { $group: { _id: { e: '$local_event_id', d: '$day' }, v: { $sum: 1 } } }]),
    ]);
    const docs = new Map<string, DailyStat>();
    const put = (e: Id, d: string, field: (typeof STAT_FIELDS)[number], v: number) => {
      const ev = evs.get(String(e));
      if (!ev) return;
      const id = `${e}:${d}`;
      const doc = docs.get(id) ?? ({ _id: id, global_event_id: festId, local_event_id: ev._id, department_id: ev.department_id, day: d, ...Object.fromEntries(STAT_FIELDS.map((f) => [f, 0])) } as DailyStat);
      doc[field] += v;
      docs.set(id, doc);
    };
    for (const [rows, field] of [[regs, 'registrations'], [people, 'people'], [cancels, 'cancellations'], [revenue, 'revenue_paise'], [refunds, 'refunds_paise']] as const) {
      for (const r of rows) put(r._id.e, r._id.d, field, r.v);
    }
    for (const r of checks) put(r._id.e, r._id.d, 'checkins', r.v);
    await this.stats.deleteMany({ global_event_id: festId });
    if (docs.size) await this.stats.insertMany([...docs.values()]);
    return { days: docs.size };
  }
}
