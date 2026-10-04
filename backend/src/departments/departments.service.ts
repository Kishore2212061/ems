import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/app-exception';
import { GLOBAL_EVENT_MODEL, GlobalEvent } from '../global-events/global-event.schema';
import { LOCAL_EVENT_MODEL, LocalEvent } from '../local-events/local-event.schema';
import { User, USER_MODEL } from '../users/user.schema';
import { DEPARTMENT_FIELDS, DEPARTMENT_MODEL, Department, SEED_DEPARTMENTS, toPublicDepartment } from './department.schema';
import type { DepartmentDto, UpdateDepartmentDto } from './departments.dto';

const CACHE_MS = 60_000;

@Injectable()
export class DepartmentsService implements OnApplicationBootstrap {
  /** Hot config (B7): the public list is read on every fest page; it changes rarely. */
  private cache?: { at: number; data: ReturnType<typeof toPublicDepartment>[] };

  constructor(
    @InjectModel(DEPARTMENT_MODEL) private readonly depts: Model<Department>,
    @InjectModel(GLOBAL_EVENT_MODEL) private readonly fests: Model<GlobalEvent>,
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @InjectModel(LOCAL_EVENT_MODEL) private readonly events: Model<LocalEvent>,
    private readonly audit: AuditService,
  ) {}

  /** Idempotent seed of the NEC associations (never overwrites edits). */
  async onApplicationBootstrap() {
    await this.depts.bulkWrite(
      SEED_DEPARTMENTS.map(([code, name, association_name], i) => ({
        updateOne: {
          filter: { code },
          update: { $setOnInsert: { code, name, association_name, active: true, sort_order: (i + 1) * 10 } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  async listActive() {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.data;
    const rows = await this.depts.find({ active: true }).sort({ active: 1, sort_order: 1 }).select(DEPARTMENT_FIELDS).lean();
    const data = rows.map(toPublicDepartment);
    this.cache = { at: Date.now(), data };
    return data;
  }

  async listAll() {
    const rows = await this.depts.find({}).sort({ sort_order: 1, code: 1 }).select(DEPARTMENT_FIELDS).lean();
    return rows.map(toPublicDepartment);
  }

  /** Resolve ids → embedded fest entries in ONE query; unknown or inactive ids are rejected. */
  async resolveForFest(ids: Types.ObjectId[]) {
    if (ids.length === 0) return [];
    const rows = await this.depts.find({ _id: { $in: ids }, active: true }).select('_id code name sort_order').sort({ sort_order: 1 }).lean();
    if (rows.length !== new Set(ids.map(String)).size) throw Errors.badRequest('UNKNOWN_DEPARTMENT', 'One or more departments do not exist or are inactive');
    return rows.map((d) => ({ department_id: d._id, code: d.code, name: d.name }));
  }

  async create(dto: DepartmentDto, actorId: string, ip: string) {
    try {
      const d = await this.depts.create({
        code: dto.code,
        name: dto.name,
        association_name: dto.associationName ?? null,
        active: dto.active ?? true,
        sort_order: dto.sortOrder ?? 100,
      });
      this.cache = undefined;
      await this.audit.record({ actorId, action: 'department.created', entity: 'department', entityId: d._id, after: { code: d.code, name: d.name }, ip });
      return toPublicDepartment(d);
    } catch (e: any) {
      if (e?.code === 11000) throw Errors.conflict('CODE_TAKEN', `Department code ${dto.code} already exists`);
      throw e;
    }
  }

  async update(id: Types.ObjectId, dto: UpdateDepartmentDto, actorId: string, ip: string) {
    const before = await this.depts.findById(id).select(DEPARTMENT_FIELDS).lean();
    if (!before) throw Errors.notFound('Department');
    const set: Record<string, unknown> = {};
    if (dto.code !== undefined) set.code = dto.code;
    if (dto.name !== undefined) set.name = dto.name;
    if (dto.associationName !== undefined) set.association_name = dto.associationName;
    if (dto.active !== undefined) set.active = dto.active;
    if (dto.sortOrder !== undefined) set.sort_order = dto.sortOrder;

    let after: Department | null;
    try {
      after = await this.depts.findByIdAndUpdate(id, { $set: set }, { new: true, projection: DEPARTMENT_FIELDS }).lean();
    } catch (e: any) {
      if (e?.code === 11000) throw Errors.conflict('CODE_TAKEN', `Department code ${dto.code} already exists`);
      throw e;
    }
    if (!after) throw Errors.notFound('Department');
    this.cache = undefined;

    // Keep denormalised copies in sync (indexed on departments.department_id / roles.scope_id).
    if (after.code !== before.code || after.name !== before.name) {
      await this.fests.updateMany(
        { 'departments.department_id': id },
        { $set: { 'departments.$[d].code': after.code, 'departments.$[d].name': after.name } },
        { arrayFilters: [{ 'd.department_id': id }] },
      );
      // Events carry the code/name too; reach them through the fests (indexed on global_event_id + department_id).
      const festIds = await this.fests.find({ 'departments.department_id': id }).distinct('_id');
      if (festIds.length) {
        await this.events.updateMany({ global_event_id: { $in: festIds }, department_id: id }, { $set: { department_code: after.code, department_name: after.name } });
      }
    }
    if (after.code !== before.code) {
      await this.users.updateMany(
        { 'roles.scope_id': id },
        { $set: { 'roles.$[r].scope_label': after.code } },
        { arrayFilters: [{ 'r.scope_id': id, 'r.scope_type': 'DEPARTMENT' }] },
      );
    }
    await this.audit.record({ actorId, action: 'department.updated', entity: 'department', entityId: id, before, after, ip });
    return toPublicDepartment(after);
  }
}
