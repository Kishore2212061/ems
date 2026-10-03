import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AUDIT_LOG_MODEL, AuditLog } from './audit-log.schema';
import { redact } from './redact';

export interface AuditEntry {
  actorId?: Types.ObjectId | string | null;
  action: string;
  entity: string;
  entityId?: Types.ObjectId | string | null;
  before?: object;
  after?: object;
  meta?: object;
  ip?: string;
}

/**
 * Append-only audit trail. One insert per call; pass `session` to make the audit row part of the
 * same transaction as the change it describes (both commit or neither does).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(@InjectModel(AUDIT_LOG_MODEL) private readonly logs: Model<AuditLog>) {}

  async record(e: AuditEntry, session?: ClientSession): Promise<void> {
    const doc = {
      actor_id: e.actorId ? new Types.ObjectId(String(e.actorId)) : null,
      action: e.action,
      entity: e.entity,
      entity_id: e.entityId ? String(e.entityId) : null,
      before: e.before && redact(e.before),
      after: e.after && redact(e.after),
      meta: e.meta && redact(e.meta),
      ip: e.ip,
    };
    await this.logs.create([doc], { session });
  }

  /**
   * For security events on paths that are already failing (lockout, token reuse): never let an
   * audit write error replace the real response, but always surface it in the logs.
   */
  recordSafe(e: AuditEntry): Promise<void> {
    return this.record(e).catch((err) => this.logger.error(`audit write failed for ${e.action}: ${err.message}`));
  }
}
