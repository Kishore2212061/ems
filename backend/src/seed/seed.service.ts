import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { hashPassword } from '../auth/password';
import { AuditService } from '../audit/audit.service';
import { env } from '../config/env';
import { User, USER_MODEL } from '../users/user.schema';

/** Every account can take part in events; staff roles are added on top (same as signup/invite). */
const PARTICIPANT = { role: 'PARTICIPANT', scope_type: 'ORG', scope_id: null, scope_label: null, granted_by: null } as const;
import { Organization, ORGANIZATION_MODEL } from './organization.schema';

/**
 * Idempotent boot seed: ensures the org and the first Super Admin exist.
 * Never overwrites an existing account (so changing SEED_SUPER_ADMIN_PASSWORD later is a no-op).
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Seed');

  constructor(
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @InjectModel(ORGANIZATION_MODEL) private readonly orgs: Model<Organization>,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap() {
    await this.orgs.updateOne(
      { slug: env.SEED_ORG_SLUG },
      { $setOnInsert: { name: env.SEED_ORG_NAME, slug: env.SEED_ORG_SLUG, timezone: env.SEED_TIMEZONE } },
      { upsert: true },
    );

    // One-off backfill for users created before full_name_lc existed (no-op afterwards; uses no index scan once done).
    await this.users.updateMany({ full_name_lc: { $exists: false } }, [{ $set: { full_name_lc: { $toLower: '$full_name' } } }]);

    const email = env.SEED_SUPER_ADMIN_EMAIL?.toLowerCase();
    if (!email || !env.SEED_SUPER_ADMIN_PASSWORD) return;
    // Accounts seeded before this fix had no Participant role (so no participant view to switch to).
    // Unique-index lookup; a no-op once applied.
    const fixed = await this.users.updateOne({ email, 'roles.role': { $ne: 'PARTICIPANT' } }, { $push: { roles: { $each: [{ ...PARTICIPANT, granted_at: new Date() }], $position: 0 } } });
    if (fixed.matchedCount || (await this.users.exists({ email }))) return;

    try {
      const admin = await this.users.create({
        email,
        full_name: env.SEED_SUPER_ADMIN_NAME,
        password_hash: await hashPassword(env.SEED_SUPER_ADMIN_PASSWORD),
        status: 'ACTIVE',
        first_login_otp_done: false, // first login still requires email OTP
        roles: [PARTICIPANT, { role: 'SUPER_ADMIN', scope_type: 'ORG', scope_id: null, granted_by: null }],
      });
      await this.audit.recordSafe({ action: 'system.super_admin_seeded', entity: 'user', entityId: admin._id, after: { email } });
      this.logger.log(`Super Admin created: ${email}`);
    } catch (e: any) {
      if (e?.code !== 11000) throw e; // another replica seeded it first
    }
  }
}
