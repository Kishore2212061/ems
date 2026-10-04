import { Controller, Get, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { z } from 'zod';
import { PageQuery, pageFilter, pageResult } from '../common/util';
import { ZodPipe } from '../common/zod.pipe';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { AUDIT_LOG_MODEL, AuditLog } from './audit-log.schema';

const AuditQuery = PageQuery.extend({
  entity: z.string().max(40).optional(),
  entityId: z.string().max(40).optional(),
});

@Controller('admin/audit')
export class AuditController {
  constructor(@InjectModel(AUDIT_LOG_MODEL) private readonly logs: Model<AuditLog>) {}

  /** Activity feed; filtered by record when entity+entityId are given (index: entity, entity_id, at). */
  @RequirePermission('audit.read')
  @Get()
  async list(@Query(new ZodPipe(AuditQuery)) q: z.infer<typeof AuditQuery>) {
    const filter = { ...pageFilter(q), ...(q.entity && { entity: q.entity }), ...(q.entityId && { entity_id: q.entityId }) };
    const rows = await this.logs.find(filter).sort({ at: -1, _id: -1 }).limit(q.limit + 1).lean();
    // Resolve actor names in one query (no N+1).
    const ids = rows.map((r) => r.actor_id).filter((id): id is NonNullable<typeof id> => !!id);
    const actors = ids.length
      ? await this.logs.db.collection('users').find({ _id: { $in: ids } }, { projection: { full_name: 1 } }).toArray()
      : [];
    const names = new Map(actors.map((a) => [String(a._id), a.full_name as string]));
    return pageResult(rows, q.limit, (r) => ({
      id: String(r._id),
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      actorName: r.actor_id ? (names.get(String(r.actor_id)) ?? 'Unknown') : 'System',
      before: r.before ?? null,
      after: r.after ?? null,
      meta: r.meta ?? null,
      at: r.at,
    }));
  }
}
