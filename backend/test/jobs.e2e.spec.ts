import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service';
import { createTestApp, type TestApp } from './helpers/app';
import { client } from './helpers/client';
import { expectIndexed } from './helpers/explain';

let t: TestApp;
let jobs: JobsService;
const calls: Record<string, number> = {};
let failUntilAttempt = 0;

beforeAll(async () => {
  t = await createTestApp();
  jobs = t.app.get(JobsService);
  jobs.register<{ id: string }>('test.count', async (p) => {
    calls[p.id] = (calls[p.id] ?? 0) + 1;
    await new Promise((r) => setTimeout(r, 5));
  });
  jobs.register<{ id: string }>('test.flaky', async (p, job) => {
    calls[p.id] = (calls[p.id] ?? 0) + 1;
    if (job.attempts <= failUntilAttempt) throw new Error(`boom #${job.attempts}`);
  });
  jobs.register('test.secret', async () => {}, { sanitize: () => ({ kept: 'only this' }) });
});
afterAll(async () => {
  await t?.close();
});
beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  failUntilAttempt = 0;
});

const q = () => t.conn.collection('job_queue');
/** Pretend the back-off delay has elapsed. */
const makeDue = (filter: object) => q().updateMany(filter, { $set: { run_at: new Date(0) } });

describe('job queue', () => {
  it('runs a job once and marks it DONE with a purge date', async () => {
    await jobs.enqueue('test.count', { id: 'a' });
    await jobs.drain();
    expect(calls.a).toBe(1);
    const job = await q().findOne({ 'payload.id': 'a' });
    expect(job).toMatchObject({ status: 'DONE', attempts: 1, locked_until: null });
    expect(job!.purge_at.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600_000);
  });

  it('retries with back-off, then succeeds', async () => {
    failUntilAttempt = 2;
    await jobs.enqueue('test.flaky', { id: 'b' }, { maxAttempts: 5 });
    await jobs.drain();
    let job = await q().findOne({ 'payload.id': 'b' });
    expect(job).toMatchObject({ status: 'PENDING', attempts: 1, last_error: 'boom #1' });
    expect(job!.run_at.getTime()).toBeGreaterThan(Date.now()); // backed off, not re-run immediately

    await makeDue({ 'payload.id': 'b' });
    await jobs.drain();
    await makeDue({ 'payload.id': 'b' });
    await jobs.drain();
    job = await q().findOne({ 'payload.id': 'b' });
    expect(job).toMatchObject({ status: 'DONE', attempts: 3, last_error: null });
    expect(calls.b).toBe(3);
  });

  it('gives up after max attempts and keeps the job as FAILED', async () => {
    failUntilAttempt = 99;
    await jobs.enqueue('test.flaky', { id: 'c' }, { maxAttempts: 2 });
    await jobs.drain();
    await makeDue({ 'payload.id': 'c' });
    await jobs.drain();
    const job = await q().findOne({ 'payload.id': 'c' });
    expect(job).toMatchObject({ status: 'FAILED', attempts: 2, last_error: 'boom #2', purge_at: null });
  });

  it('does not run jobs scheduled for later', async () => {
    await jobs.enqueue('test.count', { id: 'later' }, { runAt: new Date(Date.now() + 60_000) });
    await jobs.drain();
    expect(calls.later).toBeUndefined();
  });

  it('dedupes by idempotency key', async () => {
    await jobs.enqueue('test.count', { id: 'once' }, { idempotencyKey: 'order-42-confirm' });
    await jobs.enqueue('test.count', { id: 'once' }, { idempotencyKey: 'order-42-confirm' });
    await jobs.drain();
    expect(await q().countDocuments({ idempotency_key: 'order-42-confirm' })).toBe(1);
    expect(calls.once).toBe(1);
  });

  it('never runs a job twice when several workers race for the queue', async () => {
    for (let i = 0; i < 40; i++) await jobs.enqueue('test.count', { id: `race-${i}` });
    await Promise.all([jobs.drain(), jobs.drain(), jobs.drain()]); // three "workers"
    const counts = Array.from({ length: 40 }, (_, i) => calls[`race-${i}`]);
    expect(counts.every((n) => n === 1)).toBe(true);
  });

  it('recovers a job whose worker died mid-run (lease expired)', async () => {
    await q().insertOne({
      type: 'test.count',
      payload: { id: 'orphan' },
      status: 'RUNNING',
      run_at: new Date(),
      attempts: 1,
      max_attempts: 5,
      locked_until: new Date(Date.now() - 1000),
      last_error: null,
      created_at: new Date(),
    });
    expect(await jobs.recoverStuck()).toBeGreaterThanOrEqual(1);
    await jobs.drain();
    expect(calls.orphan).toBe(1);
  });

  it('enqueues inside a transaction only if it commits', async () => {
    const session = await t.conn.startSession();
    await expect(
      session.withTransaction(async () => {
        await jobs.enqueue('test.count', { id: 'tx' }, { session });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await session.endSession();
    expect(await q().countDocuments({ 'payload.id': 'tx' })).toBe(0);
  });

  it('shrinks the stored payload after finishing (sanitize)', async () => {
    await jobs.enqueue('test.secret', { otp: '123456', to: 'x@y.z' });
    await jobs.drain();
    expect((await q().findOne({ type: 'test.secret' }))!.payload).toEqual({ kept: 'only this' });
  });

  it('serves claim and recovery from indexes', async () => {
    const m = t.conn.model('Job');
    await expectIndexed(m.findOne({ status: 'PENDING', run_at: { $lte: new Date() }, type: { $in: ['x'] } }).sort({ run_at: 1 }), 'status_1_run_at_1');
    await expectIndexed(m.find({ status: 'RUNNING', locked_until: { $lt: new Date() } }), 'status_1_locked_until_1');
  });
});

describe('emails go through the queue', () => {
  it('OTP email is durably queued, delivered, and its code is not kept in the job', async () => {
    const email = `queue-${Date.now()}@test.local`;
    await client(t.app).post('/auth/signup', { fullName: 'Q User', email, phone: '9876543210', college: 'NEC', password: 'Passw0rd123' });

    // Queued before the API answered:
    const queued = await q().findOne({ type: 'email.send', 'payload.to': email });
    expect(queued).not.toBeNull();

    const code = await t.lastOtp(email); // drains → delivered to the outbox
    expect(code).toMatch(/^\d{6}$/);
    const delivered = await q().findOne({ _id: queued!._id });
    expect(delivered).toMatchObject({ status: 'DONE', payload: { to: email } });
    expect(JSON.stringify(delivered)).not.toContain(code);
  });
});
