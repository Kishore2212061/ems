/**
 * npm run media:ingest
 * Finds fest and event posters that still point at other websites and replaces each with our
 * resized, self-hosted copy (same as saving the event again). Safe to run any time.
 */
async function main() {
  process.env.JOBS_ENABLED = 'false';
  const { NestFactory } = await import('@nestjs/core');
  const { getModelToken } = await import('@nestjs/mongoose');
  const { setupMongoose } = await import('../database/mongoose-setup');
  setupMongoose();
  const { AppModule } = await import('../app.module');
  const { MediaService } = await import('../media/media.service');
  const { LOCAL_EVENT_MODEL } = await import('../local-events/local-event.schema');
  const { GLOBAL_EVENT_MODEL } = await import('../global-events/global-event.schema');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const media = app.get(MediaService);
    let done = 0;
    let failed = 0;
    for (const token of [LOCAL_EVENT_MODEL, GLOBAL_EVENT_MODEL]) {
      const model = app.get(getModelToken(token));
      const rows: { _id: unknown; name: string; banner_url: string }[] = await model.find({ banner_url: /^https:\/\// }).select('name banner_url').lean();
      for (const r of rows) {
        try {
          const url = await media.ensureHosted(r.banner_url);
          // Only if nobody changed it meanwhile.
          await model.updateOne({ _id: r._id, banner_url: r.banner_url }, { $set: { banner_url: url } }, { timestamps: false });
          done++;
          console.log(`✓ ${r.name}`);
        } catch (e: any) {
          failed++;
          console.log(`✗ ${r.name}: ${e?.details?.fields?.bannerUrl ?? e?.message}`);
        }
      }
    }
    console.log(`Posters now self-hosted: ${done}${failed ? ` · could not import: ${failed}` : ''}.`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
