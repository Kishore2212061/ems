import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { env } from '../config/env';
import { Job, JOB_MODEL } from './job.schema';

export type JobHandler<P = any> = (payload: P, job: Job<P>) => Promise<void>;

interface Registration {
  handler: JobHandler;
  /** Shrinks the stored payload once the job finishes (e.g. drop an email body that contains an OTP). */
  sanitize?: (payload: any) => Record<string, unknown>;
}

export interface EnqueueOptions {
  runAt?: Date;
  maxAttempts?: number;
  /** Same key twice → one job (safe retries of the request that enqueues). */
  idempotencyKey?: string;
  /** Enqueue inside the caller's transaction: the job exists only if the change commits. */
  session?: ClientSession;
}

const DONE_RETENTION_MS = 7 * 24 * 3600_000;
const MAX_BACKOFF_MS = 10 * 60_000;
const RECOVERY_EVERY_MS = 30_000;

/**
 * Durable background jobs on MongoDB (no Redis).
 *
 * - Claim = one atomic findOneAndUpdate on the {status, run_at} index → a job runs on one worker.
 * - Lease (locked_until): if a worker dies mid-job, recovery hands the job back after the lease.
 *   Handlers must therefore be idempotent.
 * - Failures retry with exponential back-off (2^attempts s, max 10 min), then FAILED.
 * - Polling backs off when idle; enqueue() wakes the worker immediately, so latency is ~0.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private readonly handlers = new Map<string, Registration>();
  private readonly inFlight = new Set<Promise<void>>();
  /** Claims whose DB round trip is in progress (claimed jobs are invisible until tracked). */
  private readonly claiming = new Set<Promise<boolean>>();
  private running = false;
  private timer?: NodeJS.Timeout;
  private recoveryTimer?: NodeJS.Timeout;

  constructor(@InjectModel(JOB_MODEL) private readonly jobs: Model<Job>) {}

  register<P>(type: string, handler: JobHandler<P>, opts: { sanitize?: Registration['sanitize'] } = {}) {
    if (this.handlers.has(type)) throw new Error(`Job handler already registered: ${type}`);
    this.handlers.set(type, { handler, sanitize: opts.sanitize });
  }

  async enqueue<P extends object>(type: string, payload: P, o: EnqueueOptions = {}): Promise<void> {
    try {
      await this.jobs.create(
        [
          {
            type,
            payload,
            run_at: o.runAt ?? new Date(),
            max_attempts: o.maxAttempts ?? 5,
            ...(o.idempotencyKey && { idempotency_key: o.idempotencyKey }),
          },
        ],
        { session: o.session },
      );
    } catch (e: any) {
      if (e?.code === 11000 && o.idempotencyKey) return; // already queued
      throw e;
    }
    if (!o.session && !o.runAt) this.wake(); // in a transaction the job isn't visible until commit
  }

  // ── worker ────────────────────────────────────────────────────────────────

  onApplicationBootstrap() {
    if (!env.JOBS_ENABLED) return;
    this.running = true;
    void this.recoverStuck();
    this.recoveryTimer = setInterval(() => void this.recoverStuck(), RECOVERY_EVERY_MS);
    this.schedule(0);
  }

  async onApplicationShutdown() {
    this.running = false;
    clearTimeout(this.timer);
    clearInterval(this.recoveryTimer);
    await Promise.allSettled([...this.inFlight]); // let running jobs finish
  }

  private schedule(ms: number) {
    if (!this.running) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private wake() {
    if (this.running && this.inFlight.size < env.JOBS_CONCURRENCY) this.schedule(0);
  }

  private async tick() {
    try {
      // Fill free slots; stop as soon as there's nothing due.
      while (this.running && this.inFlight.size < env.JOBS_CONCURRENCY) {
        if (!(await this.claimAndRun())) {
          this.schedule(env.JOBS_IDLE_POLL_MS);
          return;
        }
      }
      // All slots busy: the next finishing job re-ticks.
    } catch (e) {
      this.logger.error(`poll failed: ${(e as Error).message}`);
      this.schedule(env.JOBS_IDLE_POLL_MS);
    }
  }

  /** Claims one due job and starts it. Returns false when nothing is due. */
  private claimAndRun(): Promise<boolean> {
    const p = this.claimOne();
    this.claiming.add(p);
    return p.finally(() => this.claiming.delete(p));
  }

  private async claimOne(): Promise<boolean> {
    const types = [...this.handlers.keys()];
    if (types.length === 0) return false;
    const now = new Date();
    const job = await this.jobs
      .findOneAndUpdate(
        { status: 'PENDING', run_at: { $lte: now }, type: { $in: types } },
        { $set: { status: 'RUNNING', locked_until: new Date(now.getTime() + env.JOBS_LEASE_SECONDS * 1000) }, $inc: { attempts: 1 } },
        { sort: { run_at: 1 }, new: true },
      )
      .lean<Job>();
    if (!job) return false;

    const p = this.execute(job).finally(() => {
      this.inFlight.delete(p);
      if (this.running) this.schedule(0);
    });
    this.inFlight.add(p);
    return true;
  }

  private async execute(job: Job) {
    const reg = this.handlers.get(job.type)!;
    const done = (payload: unknown) => (reg.sanitize ? reg.sanitize(payload) : payload);
    try {
      await reg.handler(job.payload, job);
      const now = new Date();
      await this.jobs.updateOne(
        { _id: job._id, status: 'RUNNING' },
        {
          $set: {
            status: 'DONE',
            locked_until: null,
            last_error: null,
            finished_at: now,
            purge_at: new Date(now.getTime() + DONE_RETENTION_MS),
            payload: done(job.payload),
          },
        },
      );
    } catch (e) {
      const error = (e as Error)?.message?.slice(0, 1000) ?? String(e);
      if (job.attempts >= job.max_attempts) {
        this.logger.error(`job ${job.type} ${job._id} FAILED after ${job.attempts} attempts: ${error}`);
        await this.jobs.updateOne(
          { _id: job._id },
          { $set: { status: 'FAILED', locked_until: null, last_error: error, finished_at: new Date(), payload: done(job.payload) } },
        );
      } else {
        const backoff = Math.min(2 ** job.attempts * 1000, MAX_BACKOFF_MS);
        this.logger.warn(`job ${job.type} ${job._id} attempt ${job.attempts} failed, retry in ${backoff / 1000}s: ${error}`);
        await this.jobs.updateOne(
          { _id: job._id },
          { $set: { status: 'PENDING', locked_until: null, last_error: error, run_at: new Date(Date.now() + backoff) } },
        );
      }
    }
  }

  /** Jobs whose worker died mid-run go back to the queue once their lease expires. */
  async recoverStuck(): Promise<number> {
    try {
      const r = await this.jobs.updateMany(
        { status: 'RUNNING', locked_until: { $lt: new Date() } },
        { $set: { status: 'PENDING', locked_until: null, run_at: new Date() } },
      );
      if (r.modifiedCount) this.logger.warn(`recovered ${r.modifiedCount} stuck job(s)`);
      return r.modifiedCount;
    } catch (e) {
      this.logger.error(`recovery failed: ${(e as Error).message}`);
      return 0;
    }
  }

  /**
   * Run everything that's due right now and wait for it (tests, scripts, graceful drains).
   * Safe with concurrent drains and the background worker: after our own claim comes back empty we
   * only *wait* for claims already in progress (a claimed job is invisible until it's tracked) and
   * never start new ones because of them, so drains can't keep re-waking each other (livelock).
   */
  async drain(): Promise<void> {
    for (;;) {
      while (this.inFlight.size < env.JOBS_CONCURRENCY && (await this.claimAndRun()));
      while (this.claiming.size) await Promise.allSettled([...this.claiming]);
      if (this.inFlight.size === 0) return;
      await Promise.race([...this.inFlight]);
    }
  }
}
