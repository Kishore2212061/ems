import { Global, Injectable, Module } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { EventEmitter } from 'node:events';
import { ClientSession, Model, Schema, Types } from 'mongoose';

type Id = Types.ObjectId;

/**
 * Pre-aggregated counters: one small document per event per day (college time), bumped with $inc
 * when something happens. Dashboards read these instead of aggregating raw collections.
 */
export interface DailyStat {
  _id: string; // `${local_event_id}:${YYYY-MM-DD}`
  global_event_id: Id;
  local_event_id: Id;
  department_id: Id | null;
  day: string;
  registrations: number;
  people: number;
  cancellations: number;
  revenue_paise: number;
  refunds_paise: number;
  checkins: number;
}
export type StatField = 'registrations' | 'people' | 'cancellations' | 'revenue_paise' | 'refunds_paise' | 'checkins';
export const STAT_FIELDS: StatField[] = ['registrations', 'people', 'cancellations', 'revenue_paise', 'refunds_paise', 'checkins'];

export const DAILY_STAT_MODEL = 'DailyStat';
export const DailyStatSchema = new Schema<DailyStat>(
  {
    _id: { type: String },
    global_event_id: { type: Schema.Types.ObjectId, required: true },
    local_event_id: { type: Schema.Types.ObjectId, required: true },
    department_id: { type: Schema.Types.ObjectId, default: null },
    day: { type: String, required: true },
    ...Object.fromEntries(STAT_FIELDS.map((f) => [f, { type: Number, default: 0 }])),
  },
  { collection: 'daily_stats', versionKey: false },
);
// Dashboard reads: a fest's days, or one event's days.
DailyStatSchema.index({ global_event_id: 1, day: 1 });
DailyStatSchema.index({ local_event_id: 1, day: 1 });

const IST = 5.5 * 3_600_000;
export const istDay = (d: Date = new Date()) => new Date(d.getTime() + IST).toISOString().slice(0, 10);

export interface Where {
  global_event_id: Id;
  local_event_id: Id;
  department_id: Id | null;
}

/** A change on a fest, for live dashboards (SSE). */
export interface StatTick {
  festId: string;
  eventId: string;
  inc: Partial<Record<StatField, number>>;
}

@Injectable()
export class StatsService {
  /** In-process bus: one listener per open dashboard channel (fan-out), never a DB poll per client. */
  readonly bus = new EventEmitter();

  constructor(@InjectModel(DAILY_STAT_MODEL) private readonly stats: Model<DailyStat>) {
    this.bus.setMaxListeners(0);
  }

  /** $inc today's counters for an event (inside the caller's transaction when given). */
  async bump(w: Where, inc: Partial<Record<StatField, number>>, session?: ClientSession, at = new Date()) {
    const day = istDay(at);
    await this.stats.updateOne(
      { _id: `${w.local_event_id}:${day}` },
      { $inc: inc, $setOnInsert: { global_event_id: w.global_event_id, local_event_id: w.local_event_id, department_id: w.department_id, day } },
      { upsert: true, session },
    );
    this.bus.emit(`fest:${w.global_event_id}`, { festId: String(w.global_event_id), eventId: String(w.local_event_id), inc } satisfies StatTick);
  }
}

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: DAILY_STAT_MODEL, schema: DailyStatSchema }])],
  providers: [StatsService],
  exports: [StatsService, MongooseModule],
})
export class StatsModule {}
