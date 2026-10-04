import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { Connection, Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { hashPassword } from '../auth/password';
import { ClientCtx, hmac } from '../auth/token.service';
import { Errors } from '../common/app-exception';
import type { AuthUser } from '../common/decorators';
import { env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { inviteEmail } from '../mail/templates';
import { RbacService } from '../rbac/rbac.service';
import { RoleGrantDto, RoleScopes } from '../users/roles';
import { PUBLIC_USER_FIELDS, User, USER_MODEL } from '../users/user.schema';
import { INVITE_MODEL, Invite, toPublicInvite } from './invite.schema';
import type { AcceptInviteDto, CreateInviteDto } from './invites.dto';

const RESEND_COOLDOWN_MS = 60_000;
const hashToken = (raw: string) => hmac(env.JWT_REFRESH_SECRET, `invite:${raw}`);

@Injectable()
export class InvitesService {
  constructor(
    @InjectModel(INVITE_MODEL) private readonly invites: Model<Invite>,
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @InjectConnection() private readonly conn: Connection,
    private readonly scopes: RoleScopes,
    private readonly rbac: RbacService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  private newToken() {
    const raw = randomBytes(32).toString('base64url');
    return { raw, token_hash: hashToken(raw), expires_at: new Date(Date.now() + env.INVITE_TTL_HOURS * 3600_000) };
  }

  private send(i: Pick<Invite, 'email' | 'role' | 'scope_label' | 'invited_by_name'>, raw: string) {
    return this.mail.dispatch({
      to: i.email,
      ...inviteEmail({
        inviter: i.invited_by_name,
        role: i.role,
        scopeLabel: i.scope_label,
        link: `${env.WEB_BASE_URL}/accept-invite/${raw}`,
        ttlHours: env.INVITE_TTL_HOURS,
      }),
    });
  }

  private isOrgWide(user: AuthUser) {
    return Object.keys(this.rbac.scopeFilter(user, 'user.invite', {})).length === 0;
  }

  // ── staff side ────────────────────────────────────────────────────────────

  async create(actor: AuthUser, dto: CreateInviteDto, ip: string) {
    const grant: RoleGrantDto = { role: dto.role, scopeType: dto.scopeType, scopeId: dto.scopeId };
    this.scopes.assertCanGrant(actor, grant);
    const { scope_id, scope_label } = await this.scopes.resolve(dto.scopeType, dto.scopeId);

    const existing = await this.users
      .findOne({ email: dto.email, roles: { $elemMatch: { role: dto.role, scope_type: dto.scopeType, scope_id } } })
      .select('_id')
      .lean();
    if (existing) throw Errors.conflict('ROLE_EXISTS', 'This person already has that role');

    const inviter = await this.users.findById(actor.id).select('full_name').lean();
    const { raw, token_hash, expires_at } = this.newToken();
    // Re-inviting the same person to the same role replaces the pending invite (fresh link).
    const invite = await this.invites
      .findOneAndUpdate(
        { email: dto.email, role: dto.role, scope_id, status: 'PENDING' },
        {
          $set: { token_hash, expires_at, last_sent_at: new Date(), invited_by: new Types.ObjectId(actor.id), invited_by_name: inviter?.full_name ?? 'NEC Events' },
          $setOnInsert: { email: dto.email, role: dto.role, scope_type: dto.scopeType, scope_id, scope_label },
        },
        { upsert: true, new: true },
      )
      .lean();
    await this.send(invite, raw);
    await this.audit.record({ actorId: actor.id, action: 'invite.sent', entity: 'invite', entityId: invite._id, after: { email: dto.email, role: dto.role, scope_label }, ip });
    return toPublicInvite(invite);
  }

  /** Org-wide inviters see every invite; scoped admins see the ones they sent. */
  async list(actor: AuthUser, status: Invite['status'] = 'PENDING') {
    const filter = this.isOrgWide(actor) ? { status } : { invited_by: new Types.ObjectId(actor.id), status };
    const rows = await this.invites.find(filter).sort({ created_at: -1 }).limit(200).lean();
    return rows.map(toPublicInvite);
  }

  private async loadOwned(actor: AuthUser, id: Types.ObjectId) {
    const filter = this.isOrgWide(actor) ? { _id: id } : { _id: id, invited_by: new Types.ObjectId(actor.id) };
    const i = await this.invites.findOne(filter).lean();
    if (!i) throw Errors.notFound('Invite');
    if (i.status !== 'PENDING') throw Errors.conflict('INVITE_NOT_PENDING', `This invite was already ${i.status.toLowerCase()}`);
    return i;
  }

  async revoke(actor: AuthUser, id: Types.ObjectId, ip: string) {
    await this.loadOwned(actor, id);
    const r = await this.invites.updateOne({ _id: id, status: 'PENDING' }, { $set: { status: 'REVOKED' } });
    if (!r.modifiedCount) throw Errors.conflict('INVITE_NOT_PENDING', 'This invite is no longer pending');
    await this.audit.record({ actorId: actor.id, action: 'invite.revoked', entity: 'invite', entityId: id, ip });
  }

  async resend(actor: AuthUser, id: Types.ObjectId, ip: string) {
    const i = await this.loadOwned(actor, id);
    const wait = RESEND_COOLDOWN_MS - (Date.now() - i.last_sent_at.getTime());
    if (wait > 0) throw Errors.conflict('RESEND_COOLDOWN', 'Please wait a minute before resending', { retryAfterSec: Math.ceil(wait / 1000) });
    const { raw, token_hash, expires_at } = this.newToken(); // old link stops working
    const updated = await this.invites
      .findOneAndUpdate({ _id: id, status: 'PENDING' }, { $set: { token_hash, expires_at, last_sent_at: new Date() } }, { new: true })
      .lean();
    if (!updated) throw Errors.conflict('INVITE_NOT_PENDING', 'This invite is no longer pending');
    await this.send(updated, raw);
    await this.audit.record({ actorId: actor.id, action: 'invite.resent', entity: 'invite', entityId: id, ip });
    return toPublicInvite(updated);
  }

  // ── invitee side (public, token-authenticated) ────────────────────────────

  private async loadByToken(raw: string) {
    const i = await this.invites.findOne({ token_hash: hashToken(raw) }).lean();
    if (!i) throw Errors.notFound('Invitation');
    if (i.status === 'ACCEPTED') throw Errors.conflict('INVITE_USED', 'This invitation has already been accepted. Sign in instead.');
    if (i.status === 'REVOKED') throw Errors.gone('INVITE_REVOKED', 'This invitation was withdrawn');
    if (i.expires_at < new Date()) throw Errors.gone('INVITE_EXPIRED', 'This invitation has expired. Ask for a new one.');
    return i;
  }

  async preview(raw: string) {
    const i = await this.loadByToken(raw);
    // Only verified accounts count: an unverified one is taken over on accept (see accept()).
    const account = await this.users.exists({ email: i.email, first_login_otp_done: true });
    return { email: i.email, role: i.role, scopeLabel: i.scope_label, invitedByName: i.invited_by_name, expiresAt: i.expires_at, accountExists: !!account };
  }

  /**
   * The emailed link proves email ownership, so accepting also verifies the email (no OTP).
   * - Existing account → role added; they sign in as usual.
   * - New account → created with name + password and signed in immediately.
   * One transaction: invite consumed (single use) + user created/updated + audit.
   */
  async accept(raw: string, dto: AcceptInviteDto, ctx: ClientCtx) {
    const i = await this.loadByToken(raw);
    const role = { role: i.role, scope_type: i.scope_type, scope_id: i.scope_id, scope_label: i.scope_label, granted_at: new Date(), granted_by: i.invited_by };
    const existing = await this.users.findOne({ email: i.email }).select('_id status first_login_otp_done').lean();
    // Only a *verified* account keeps its password. An unverified one may have been created by
    // someone squatting this email, so the invitee (who just proved ownership) sets a new password.
    const verified = !!existing?.first_login_otp_done;
    if (!verified && !(dto.fullName && dto.password)) {
      throw Errors.validation({ fields: { ...(!dto.fullName && { fullName: 'Enter your full name' }), ...(!dto.password && { password: 'Create a password' }) } });
    }
    if (existing?.status === 'SUSPENDED') throw Errors.forbidden('ACCOUNT_SUSPENDED', 'This account has been suspended');
    const passwordHash = verified ? null : await hashPassword(dto.password!);

    const session = await this.conn.startSession();
    let userId: Types.ObjectId;
    try {
      userId = await session.withTransaction(async () => {
        const consumed = await this.invites.updateOne(
          { _id: i._id, status: 'PENDING', expires_at: { $gt: new Date() } },
          { $set: { status: 'ACCEPTED', accepted_at: new Date() } },
          { session },
        );
        if (!consumed.modifiedCount) throw Errors.conflict('INVITE_USED', 'This invitation has already been used');

        let id: Types.ObjectId;
        if (existing) {
          id = existing._id;
          const addRoleOnce = {
            $cond: [
              { $in: [{ role: i.role, scope_type: i.scope_type, scope_id: i.scope_id }, { $map: { input: '$roles', in: { role: '$$this.role', scope_type: '$$this.scope_type', scope_id: '$$this.scope_id' } } }] },
              '$roles',
              { $concatArrays: ['$roles', [role]] },
            ],
          };
          await this.users.updateOne(
            { _id: id },
            [
              {
                $set: {
                  roles: addRoleOnce,
                  first_login_otp_done: true,
                  email_verified_at: { $ifNull: ['$email_verified_at', '$$NOW'] },
                  status: 'ACTIVE',
                  // Unverified account → take it over with the invitee's own name + password.
                  ...(!verified && { password_hash: passwordHash, full_name: dto.fullName, full_name_lc: dto.fullName!.toLowerCase(), failed_login_count: 0, locked_until: null }),
                },
              },
            ],
            { session },
          );
        } else {
          const [u] = await this.users.create(
            [
              {
                email: i.email,
                full_name: dto.fullName,
                password_hash: passwordHash,
                status: 'ACTIVE',
                first_login_otp_done: true,
                email_verified_at: new Date(),
                roles: [{ role: 'PARTICIPANT', scope_type: 'ORG', scope_id: null, granted_by: null }, role],
              },
            ],
            { session },
          );
          id = u._id;
        }
        await this.invites.updateOne({ _id: i._id }, { $set: { accepted_user_id: id } }, { session });
        await this.audit.record({ actorId: id, action: 'invite.accepted', entity: 'invite', entityId: i._id, after: { role: i.role, scope_label: i.scope_label, newAccount: !verified }, ip: ctx.ip }, session);
        return id;
      });
    } finally {
      await session.endSession();
    }

    if (verified) return { status: 'ROLE_ADDED' as const, email: i.email };
    const user = await this.users.findById(userId).select(PUBLIC_USER_FIELDS).lean();
    return { status: 'SIGNED_IN' as const, session: await this.auth.issueSession(user!, ctx) };
  }
}
