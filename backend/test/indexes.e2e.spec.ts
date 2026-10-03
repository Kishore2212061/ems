import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { expectIndexed } from './helpers/explain';

// Every hot-path query from the auth module must hit an index (Quality bar B1).
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

const id = new Types.ObjectId();
const now = new Date();

describe('auth query plans', () => {
  it('users by email (login, signup, forgot-password)', async () => {
    await expectIndexed(t.conn.model('User').findOne({ email: 'a@b.c' }), 'email_1');
  });

  it('users by role (super-admin invariant, role lookups)', async () => {
    await expectIndexed(t.conn.model('User').find({ 'roles.role': 'SUPER_ADMIN' }));
  });

  it('refresh token by hash (every refresh)', async () => {
    await expectIndexed(t.conn.model('RefreshToken').findOne({ token_hash: 'x' }), 'token_hash_1');
  });

  it('refresh tokens by family (logout, reuse detection)', async () => {
    await expectIndexed(t.conn.model('RefreshToken').find({ family_id: 'f', revoked_at: null }), 'family_id_1');
  });

  it('refresh tokens by user (password reset, sessions list)', async () => {
    await expectIndexed(t.conn.model('RefreshToken').find({ user_id: id, revoked_at: null }), 'user_id_1');
  });

  it('latest OTP for a user + purpose (verify)', async () => {
    await expectIndexed(
      t.conn.model('OtpCode').findOne({ user_id: id, purpose: 'FIRST_LOGIN', consumed_at: null }).sort({ created_at: -1 }),
      'user_id_1_purpose_1_created_at_-1',
    );
  });

  it('recent OTPs in the resend window (cooldown + window count)', async () => {
    await expectIndexed(
      t.conn.model('OtpCode').find({ user_id: id, purpose: 'FIRST_LOGIN', created_at: { $gte: now } }).sort({ created_at: -1 }),
      'user_id_1_purpose_1_created_at_-1',
    );
  });
});
