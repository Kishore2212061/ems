/**
 * npm run stats:rebuild
 * Recomputes the dashboard counters (daily_stats) of every fest from the source collections.
 * Only derived data is written. Use it once after upgrading, or to repair counters; run it while
 * the fests are quiet (live registrations during the rebuild may be missed until the next run).
 */
async function main() {
  process.env.JOBS_ENABLED = 'false';
  const { NestFactory } = await import('@nestjs/core');
  const { getModelToken } = await import('@nestjs/mongoose');
  const { setupMongoose } = await import('../database/mongoose-setup');
  setupMongoose();
  const { AppModule } = await import('../app.module');
  const { ReportsService } = await import('../reports/reports.service');
  const { GLOBAL_EVENT_MODEL } = await import('../global-events/global-event.schema');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const fests = await app.get(getModelToken(GLOBAL_EVENT_MODEL)).find().select('_id name').lean();
    const reports = app.get(ReportsService);
    for (const f of fests as { _id: never; name: string }[]) {
      const r = await reports.rebuild(f._id);
      console.log(`✓ ${f.name}: ${r.days} event-day counters`);
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
