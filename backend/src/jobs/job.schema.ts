import { Schema, Types } from 'mongoose';

export const JOB_STATUS = ['PENDING', 'RUNNING', 'DONE', 'FAILED'] as const;
export type JobStatus = (typeof JOB_STATUS)[number];

export interface Job<P = Record<string, unknown>> {
  _id: Types.ObjectId;
  type: string;
  payload: P;
  status: JobStatus;
  run_at: Date;
  attempts: number;
  max_attempts: number;
  /** Lease: while RUNNING, no other worker may claim it until this passes. */
  locked_until: Date | null;
  last_error: string | null;
  idempotency_key?: string;
  finished_at?: Date | null;
  /** Set when DONE; TTL index deletes the row then. FAILED jobs are kept for inspection. */
  purge_at?: Date | null;
  created_at: Date;
}

export const JOB_MODEL = 'Job';

export const JobSchema = new Schema<Job>(
  {
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: JOB_STATUS, default: 'PENDING' },
    run_at: { type: Date, default: Date.now },
    attempts: { type: Number, default: 0 },
    max_attempts: { type: Number, default: 5 },
    locked_until: { type: Date, default: null },
    last_error: { type: String, default: null },
    idempotency_key: { type: String },
    finished_at: { type: Date, default: null },
    purge_at: { type: Date, default: null },
  },
  { collection: 'job_queue', versionKey: false, timestamps: { createdAt: 'created_at', updatedAt: false }, minimize: false },
);

JobSchema.index({ status: 1, run_at: 1 }); // claim: oldest due PENDING job
JobSchema.index({ status: 1, locked_until: 1 }); // stuck-lease recovery
JobSchema.index({ idempotency_key: 1 }, { unique: true, partialFilterExpression: { idempotency_key: { $type: 'string' } } });
JobSchema.index({ purge_at: 1 }, { expireAfterSeconds: 0 });
