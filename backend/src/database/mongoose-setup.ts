import mongoose from 'mongoose';
import { env } from '../config/env';

/**
 * Must run before any model is compiled.
 * - strictQuery: drop unknown filter keys (blocks query-injection via extra fields)
 * - maxTimeMS on every query so a slow query can't pin a pool connection forever
 */
let done = false;

export function setupMongoose() {
  if (done) return; // idempotent: the test harness boots several apps in one process
  done = true;
  mongoose.set('strictQuery', true);
  mongoose.plugin((schema) => {
    schema.pre(
      ['find', 'findOne', 'findOneAndUpdate', 'countDocuments', 'updateOne', 'updateMany', 'deleteMany'],
      function () {
        if (this.getOptions().maxTimeMS == null) this.maxTimeMS(env.DB_STATEMENT_TIMEOUT_MS);
      },
    );
  });
}
