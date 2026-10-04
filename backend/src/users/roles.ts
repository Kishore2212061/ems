import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { z } from 'zod';
import { Errors } from '../common/app-exception';
import type { AuthUser } from '../common/decorators';
import { objectId } from '../common/util';
import { DEPARTMENT_MODEL, Department } from '../departments/department.schema';
import { GLOBAL_EVENT_MODEL, GlobalEvent } from '../global-events/global-event.schema';
import { RbacService, ResourceScope } from '../rbac/rbac.service';
import { ROLES, Role, SCOPE_TYPES, ScopeType } from './user.schema';

/** Which scopes make sense for each role. LOCAL_EVENT scopes arrive with Module 3. */
export const VALID_SCOPES: Record<Role, ScopeType[]> = {
  SUPER_ADMIN: ['ORG'],
  ADMIN: ['ORG', 'GLOBAL_EVENT', 'DEPARTMENT'],
  FINANCE: ['ORG', 'GLOBAL_EVENT'],
  SCANNER: ['GLOBAL_EVENT', 'LOCAL_EVENT'],
  PARTICIPANT: ['ORG'],
};

export const RoleGrantDto = z
  .object({
    role: z.enum(ROLES),
    scopeType: z.enum(SCOPE_TYPES),
    scopeId: objectId.nullish(),
  })
  .refine((v) => VALID_SCOPES[v.role].includes(v.scopeType), { message: 'This role cannot have that scope', path: ['scopeType'] })
  .refine((v) => (v.scopeType === 'ORG') === !v.scopeId, { message: 'Choose a fest or department', path: ['scopeId'] });
export type RoleGrantDto = z.infer<typeof RoleGrantDto>;

@Injectable()
export class RoleScopes {
  constructor(
    @InjectModel(GLOBAL_EVENT_MODEL) private readonly fests: Model<GlobalEvent>,
    @InjectModel(DEPARTMENT_MODEL) private readonly depts: Model<Department>,
    private readonly rbac: RbacService,
  ) {}

  /** Validates the scope exists and returns the denormalised label stored on the role. */
  async resolve(scopeType: ScopeType, scopeId?: Types.ObjectId | null) {
    if (scopeType === 'ORG') return { scope_id: null, scope_label: null };
    if (scopeType === 'GLOBAL_EVENT') {
      const f = await this.fests.findById(scopeId).select('name').lean();
      if (!f) throw Errors.badRequest('UNKNOWN_SCOPE', 'That fest does not exist');
      return { scope_id: f._id, scope_label: f.name };
    }
    if (scopeType === 'DEPARTMENT') {
      const d = await this.depts.findById(scopeId).select('code').lean();
      if (!d) throw Errors.badRequest('UNKNOWN_SCOPE', 'That department does not exist');
      return { scope_id: d._id, scope_label: d.code };
    }
    throw Errors.badRequest('SCOPE_NOT_SUPPORTED_YET', 'Event-level roles become available with local events (Module 3)');
  }

  /**
   * "A user cannot grant what they don't hold":
   * - SUPER_ADMIN may grant any staff role.
   * - Other inviters may grant only ADMIN or SCANNER, and only inside a scope they themselves
   *   administer (an ORG-wide admin anywhere; a fest admin within that fest; a CSE admin within CSE).
   */
  assertCanGrant(inviter: AuthUser, g: RoleGrantDto) {
    if (g.role === 'PARTICIPANT') throw Errors.badRequest('INVALID_ROLE', 'Participant access is automatic');
    if (inviter.roles.some((r) => r.r === 'SUPER_ADMIN')) return;
    if (g.role !== 'ADMIN' && g.role !== 'SCANNER') {
      throw Errors.forbidden('CANNOT_GRANT_ROLE', 'Only a Super Admin can grant that role');
    }
    const target: ResourceScope =
      g.scopeType === 'GLOBAL_EVENT' ? { globalEventId: g.scopeId } : g.scopeType === 'DEPARTMENT' ? { departmentId: g.scopeId } : g.scopeType === 'LOCAL_EVENT' ? { localEventId: g.scopeId } : {};
    if (!this.rbac.can(inviter, 'user.invite', target)) {
      throw Errors.forbidden('CANNOT_GRANT_ROLE', 'You can only invite people into your own fest or department');
    }
  }
}
