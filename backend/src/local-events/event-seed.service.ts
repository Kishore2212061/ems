import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { prefixRegex } from '../common/util';
import { DepartmentsService } from '../departments/departments.service';
import { GLOBAL_EVENT_MODEL, GlobalEvent } from '../global-events/global-event.schema';
import { SeedFileDto } from './local-events.dto';
import { EventStatus, LOCAL_EVENT_MODEL, LocalEvent } from './local-event.schema';
import { publishGaps, toEventFields } from './local-events.service';

/**
 * Imports a fest and its events from `backend/seed/*.json` (e.g. NEC Tech Fest '25).
 * Idempotent and non-destructive: records are matched by slug and only ever *inserted* — re-running
 * never overwrites what organisers edited since.
 */
@Injectable()
export class EventSeedService {
  constructor(
    @InjectModel(LOCAL_EVENT_MODEL) private readonly events: Model<LocalEvent>,
    @InjectModel(GLOBAL_EVENT_MODEL) private readonly fests: Model<GlobalEvent>,
    private readonly depts: DepartmentsService,
    private readonly audit: AuditService,
  ) {}

  async importFile(data: unknown) {
    const parsed = SeedFileDto.safeParse(data);
    if (!parsed.success) {
      const first = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new Error(`Seed file is invalid:\n  ${first.join('\n  ')}`);
    }
    const { fest: f, events } = parsed.data;

    // Departments by code, in catalogue order.
    const all = await this.depts.listAll();
    const byCode = new Map(all.map((d) => [d.code, d]));
    const codes = [...new Set(events.map((e) => e.department).filter((c): c is string => !!c))];
    const unknown = codes.filter((c) => !byCode.has(c));
    if (unknown.length) throw new Error(`Unknown department codes: ${unknown.join(', ')}`);
    const embed = all.filter((d) => codes.includes(d.code)).map((d) => ({ department_id: new Types.ObjectId(d.id), code: d.code, name: d.name }));

    const now = new Date();
    const res = (await this.fests
      .findOneAndUpdate(
        { slug: f.slug },
        {
          $setOnInsert: {
            slug: f.slug,
            name: f.name,
            edition_year: f.editionYear,
            type: f.type,
            tagline: f.tagline,
            description: f.description,
            starts_at: f.startsAt,
            ends_at: f.endsAt,
            venue: f.venue,
            banner_url: f.bannerUrl ?? null,
            status: f.status,
            published_at: f.status === 'PUBLISHED' ? now : f.status === 'COMPLETED' ? f.startsAt : null,
            departments: embed,
            created_by: null,
            version: 0,
          },
        },
        { upsert: true, new: true, includeResultMetadata: true },
      )
      .lean()) as unknown as { value: GlobalEvent; lastErrorObject?: { updatedExisting?: boolean } };
    const fest = res.value;
    const festCreated = !res.lastErrorObject?.updatedExisting;

    // An existing fest (e.g. created by hand) gets any department its events need.
    const have = new Set(fest.departments.map((d) => String(d.department_id)));
    const add = embed.filter((d) => !have.has(String(d.department_id)));
    if (add.length) await this.fests.updateOne({ _id: fest._id }, { $push: { departments: { $each: add } }, $inc: { version: 1 } });

    // Events follow the fest: past edition → completed; otherwise live (drafts if incomplete).
    const statusFor = (e: Partial<LocalEvent>): EventStatus =>
      fest.status === 'COMPLETED' ? 'COMPLETED' : fest.status === 'CANCELLED' ? 'CANCELLED' : publishGaps(e).length ? 'DRAFT' : 'PUBLISHED';

    const ops = events.map(({ department, slug, ...rest }) => {
      const d = department ? byCode.get(department)! : null;
      const fields = toEventFields(rest);
      const status = statusFor(fields);
      return {
        updateOne: {
          filter: { global_event_id: fest._id, slug },
          update: {
            $setOnInsert: {
              global_event_id: fest._id,
              slug,
              department_id: d ? new Types.ObjectId(d.id) : null,
              department_code: d?.code ?? null,
              department_name: d?.name ?? null,
              ...fields,
              status,
              status_reason: null,
              published_at: status === 'DRAFT' ? null : (fest.published_at ?? now),
              seats_confirmed: 0,
              seats_held: 0,
              price_version: 0,
              created_by: null,
              version: 0,
              created_at: now,
              updated_at: now,
            } as Partial<LocalEvent>,
          },
          upsert: true,
          timestamps: false, // re-runs must not touch updated_at of existing events
        },
      };
    });
    const r = ops.length ? await this.events.bulkWrite(ops, { ordered: false }) : { upsertedCount: 0, matchedCount: 0 };

    // Posters that still point at the old hotlinked copies → the file's (self-hosted) ones.
    // Matched on the old prefix, so an image an organiser changed since is never touched.
    let imagesUpdated = 0;
    if (parsed.data.replaceImagesFrom) {
      const prefix = prefixRegex(parsed.data.replaceImagesFrom);
      const swaps = events.map((e) => ({
        updateOne: {
          filter: { global_event_id: fest._id, slug: e.slug, banner_url: prefix },
          update: { $set: { banner_url: e.bannerUrl ?? null } },
          timestamps: false,
        },
      }));
      if (swaps.length) imagesUpdated = (await this.events.bulkWrite(swaps, { ordered: false })).modifiedCount;
    }

    const summary = { festId: String(fest._id), festSlug: fest.slug, festCreated, departmentsAdded: add.length, inserted: r.upsertedCount, existing: r.matchedCount, imagesUpdated };
    await this.audit.recordSafe({ action: 'local_event.imported', entity: 'global_event', entityId: fest._id, after: summary });
    return summary;
  }
}
