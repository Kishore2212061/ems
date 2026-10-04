import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AppException } from '../common/app-exception';
import type { AuthUser } from '../common/decorators';
import { env } from '../config/env';
import { Organization, ORGANIZATION_MODEL } from '../seed/organization.schema';
import { Role, User, USER_MODEL } from '../users/user.schema';
import { Permission, ROLE_PERMISSIONS } from './permissions';

/** Where a resource lives. Include every ancestor id you know (a local event has all three). */
export interface ResourceScope {
  globalEventId?: string | Types.ObjectId | null;
  departmentId?: string | Types.ObjectId | null;
  localEventId?: string | Types.ObjectId | null;
}

/** Which document fields hold each scope id, for building list filters. */
export interface ScopeFields {
  globalEventId?: string;
  departmentId?: string;
  localEventId?: string;
}

const SCOPE_KEY = { GLOBAL_EVENT: 'globalEventId', DEPARTMENT: 'departmentId', LOCAL_EVENT: 'localEventId' } as const;

/** Matches nothing, but still uses the _id index (an empty $in short-circuits). */
export const NO_ACCESS = Object.freeze({ _id: { $in: [] as Types.ObjectId[] } });

export const Forbidden = (permission: Permission) =>
  new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', "You don't have permission to do that", { permission });

@Injectable()
export class RbacService {
  constructor(
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @InjectModel(ORGANIZATION_MODEL) private readonly orgs: Model<Organization>,
  ) {}

  private rolesWith(user: AuthUser, perm: Permission) {
    return user.roles.filter((r) => ROLE_PERMISSIONS[r.r as Role]?.has(perm));
  }

  /** Has the permission through at least one role, in any scope. Cheap: JWT claims only. */
  hasAny(user: AuthUser, perm: Permission): boolean {
    return this.rolesWith(user, perm).length > 0;
  }

  /** Has the permission for this specific resource. */
  can(user: AuthUser, perm: Permission, resource: ResourceScope = {}): boolean {
    return this.rolesWith(user, perm).some((r) => {
      if (r.st === 'ORG') return true;
      const key = SCOPE_KEY[r.st as keyof typeof SCOPE_KEY];
      const id = key && resource[key];
      return !!id && String(id) === r.sid;
    });
  }

  assertCan(user: AuthUser, perm: Permission, resource: ResourceScope = {}): void {
    if (!this.can(user, perm, resource)) throw Forbidden(perm);
  }

  /**
   * Mongo filter limiting a list to what the user may see with `perm`.
   * {} = unrestricted (an ORG-wide role), NO_ACCESS = nothing; otherwise an $or of $in clauses
   * on the mapped fields, so each branch can use an index.
   */
  scopeFilter(user: AuthUser, perm: Permission, fields: ScopeFields): Record<string, unknown> {
    const roles = this.rolesWith(user, perm);
    if (roles.some((r) => r.st === 'ORG')) return {};

    const ids: Partial<Record<keyof ScopeFields, Types.ObjectId[]>> = {};
    for (const r of roles) {
      const key = SCOPE_KEY[r.st as keyof typeof SCOPE_KEY];
      if (key && fields[key] && r.sid && Types.ObjectId.isValid(r.sid)) (ids[key] ??= []).push(new Types.ObjectId(r.sid));
    }
    const or = (Object.keys(ids) as (keyof ScopeFields)[]).map((k) => ({ [fields[k]!]: { $in: ids[k] } }));
    if (or.length === 0) return NO_ACCESS;
    return or.length === 1 ? or[0] : { $or: or };
  }

  /**
   * Combine a query with a scope filter. ALWAYS use this instead of object spread: both can
   * contain the same key (e.g. `_id`), and `{ _id: id, ...scope }` silently replaces the requested
   * id with the scope's — returning a *different* record instead of "not found".
   */
  withScope<F extends Record<string, unknown>>(filter: F, scope: Record<string, unknown>): Record<string, unknown> {
    return Object.keys(scope).length ? { $and: [filter, scope] } : filter;
  }

  /**
   * Call inside a transaction that removes/suspends a Super Admin, AFTER making the change.
   * Throws 409 if no active Super Admin would remain.
   *
   * Why the $inc on the org document: two admins demoting each other concurrently would each
   * still "see" the other as active (snapshot isolation, different documents → no conflict),
   * leaving zero. Writing a shared guard document forces a write conflict, so one transaction
   * retries, re-counts, and is refused.
   */
  async ensureSuperAdminRemains(session: ClientSession): Promise<void> {
    await this.orgs.updateOne(
      { slug: env.SEED_ORG_SLUG },
      { $inc: { rbac_guard: 1 }, $setOnInsert: { name: env.SEED_ORG_NAME, timezone: env.SEED_TIMEZONE } },
      { upsert: true, session },
    );
    const remaining = await this.users.countDocuments(
      { status: 'ACTIVE', roles: { $elemMatch: { role: 'SUPER_ADMIN', scope_type: 'ORG' } } },
      { session },
    );
    if (remaining < 1) {
      throw new AppException(HttpStatus.CONFLICT, 'LAST_SUPER_ADMIN', 'At least one active Super Admin must remain');
    }
  }
}
