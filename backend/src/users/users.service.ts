import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { Errors } from '../common/app-exception';
import type { AuthUser } from '../common/decorators';
import { pageFilter, pageResult, prefixRegex } from '../common/util';
import { RbacService } from '../rbac/rbac.service';
import { RoleGrantDto, RoleScopes } from './roles';
import { PUBLIC_USER_FIELDS, Role, toPublicUser, User, USER_MODEL } from './user.schema';
import type { ProfileDto, UserListQuery } from './users.dto';

const ADMIN_FIELDS = `${PUBLIC_USER_FIELDS} last_login_at`;

const toAdminUser = (u: any) => ({ ...toPublicUser(u), lastLoginAt: u.last_login_at ?? null });

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @InjectConnection() private readonly conn: Connection,
    private readonly rbac: RbacService,
    private readonly scopes: RoleScopes,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  // ── self-service ──────────────────────────────────────────────────────────

  async updateProfile(userId: string, dto: ProfileDto) {
    const set: Record<string, unknown> = {};
    if (dto.fullName !== undefined) set.full_name = dto.fullName;
    if (dto.phone !== undefined) set.phone = dto.phone;
    if (dto.college !== undefined) set.college = dto.college;
    const u = await this.users.findByIdAndUpdate(userId, { $set: set }, { new: true, projection: PUBLIC_USER_FIELDS }).lean();
    if (!u) throw Errors.notFound('User');
    return toPublicUser(u);
  }

  // ── admin: directory ──────────────────────────────────────────────────────

  /**
   * Org-wide directory (ORG-scoped user.read only; scoped admins manage people via invites).
   * Search is an anchored prefix on an indexed field: email if it looks like one, else name.
   */
  async list(user: AuthUser, q: UserListQuery) {
    const scope = this.rbac.scopeFilter(user, 'user.read', {});
    if (Object.keys(scope).length) return { items: [], nextCursor: null }; // not org-wide
    const filter: Record<string, unknown> = { ...pageFilter(q) };
    if (q.role) filter['roles.role'] = q.role;
    if (q.status) filter.status = q.status;
    if (q.q) {
      const term = q.q.trim().toLowerCase();
      if (term.includes('@') || /^[a-z0-9._-]+$/.test(term)) {
        filter.$or = [{ email: prefixRegex(term) }, { full_name_lc: prefixRegex(term) }];
      } else {
        filter.full_name_lc = prefixRegex(term);
      }
    }
    const rows = await this.users.find(filter).sort({ _id: -1 }).limit(q.limit + 1).select(ADMIN_FIELDS).lean();
    return pageResult(rows, q.limit, toAdminUser);
  }

  async get(user: AuthUser, id: Types.ObjectId) {
    if (Object.keys(this.rbac.scopeFilter(user, 'user.read', {})).length) throw Errors.notFound('User');
    const u = await this.users.findById(id).select(ADMIN_FIELDS).lean();
    if (!u) throw Errors.notFound('User');
    return toAdminUser(u);
  }

  // ── admin: roles & status (Super Admin) ───────────────────────────────────

  async grantRole(actor: AuthUser, id: Types.ObjectId, g: RoleGrantDto, ip: string) {
    if (g.role === 'PARTICIPANT') throw Errors.badRequest('INVALID_ROLE', 'Participant access is automatic');
    const { scope_id, scope_label } = await this.scopes.resolve(g.scopeType, g.scopeId);
    const role = { role: g.role, scope_type: g.scopeType, scope_id, scope_label, granted_at: new Date(), granted_by: new Types.ObjectId(actor.id) };

    // Atomic "add if not already present".
    const u = await this.users
      .findOneAndUpdate(
        { _id: id, roles: { $not: { $elemMatch: { role: g.role, scope_type: g.scopeType, scope_id } } } },
        { $push: { roles: role } },
        { new: true, projection: ADMIN_FIELDS },
      )
      .lean();
    if (!u) {
      if (await this.users.exists({ _id: id })) throw Errors.conflict('ROLE_EXISTS', 'This person already has that role');
      throw Errors.notFound('User');
    }
    // New roles reach the user's token on their next refresh (≤ 15 min) — no sign-out needed.
    await this.audit.record({ actorId: actor.id, action: 'user.role_granted', entity: 'user', entityId: id, after: { role: g.role, scope: g.scopeType, scope_label }, ip });
    return toAdminUser(u);
  }

  /** Removing access takes effect immediately: one transaction removes the role, checks the
   *  Super Admin invariant, signs the user out everywhere, and writes the audit row. */
  async revokeRole(actor: AuthUser, id: Types.ObjectId, g: RoleGrantDto, ip: string) {
    if (g.role === 'PARTICIPANT') throw Errors.badRequest('INVALID_ROLE', 'Participant access cannot be removed');
    const scope_id = g.scopeId ?? null;
    const session = await this.conn.startSession();
    try {
      await session.withTransaction(async () => {
        const r = await this.users.updateOne(
          { _id: id },
          { $pull: { roles: { role: g.role, scope_type: g.scopeType, scope_id } } },
          { session },
        );
        if (r.matchedCount === 0) throw Errors.notFound('User');
        if (r.modifiedCount === 0) throw Errors.notFound('Role');
        if (g.role === 'SUPER_ADMIN') await this.rbac.ensureSuperAdminRemains(session);
        await this.auth.revokeAllSessions(id, 'ROLE_CHANGED', session);
        await this.audit.record({ actorId: actor.id, action: 'user.role_revoked', entity: 'user', entityId: id, before: { role: g.role, scope: g.scopeType, scope_id }, ip }, session);
      });
    } finally {
      await session.endSession();
    }
    return this.get(actor, id);
  }

  async setStatus(actor: AuthUser, id: Types.ObjectId, suspend: boolean, ip: string) {
    if (suspend && String(id) === actor.id) throw Errors.badRequest('CANNOT_SUSPEND_SELF', "You can't suspend your own account");
    const session = await this.conn.startSession();
    try {
      await session.withTransaction(async () => {
        const u = await this.users
          .findOneAndUpdate(
            { _id: id, status: suspend ? { $ne: 'SUSPENDED' } : 'SUSPENDED' },
            [{ $set: { status: suspend ? 'SUSPENDED' : { $cond: ['$first_login_otp_done', 'ACTIVE', 'PENDING_VERIFICATION'] } } }],
            { session, new: true, projection: 'roles' },
          )
          .lean();
        if (!u) {
          if (!(await this.users.exists({ _id: id }).session(session))) throw Errors.notFound('User');
          throw Errors.conflict('NO_CHANGE', suspend ? 'Already suspended' : 'Not suspended');
        }
        if (suspend) {
          if (u.roles.some((r) => r.role === ('SUPER_ADMIN' as Role))) await this.rbac.ensureSuperAdminRemains(session);
          await this.auth.revokeAllSessions(id, 'SUSPENDED', session);
        }
        await this.audit.record({ actorId: actor.id, action: suspend ? 'user.suspended' : 'user.reactivated', entity: 'user', entityId: id, ip }, session);
      });
    } finally {
      await session.endSession();
    }
    return this.get(actor, id);
  }
}
