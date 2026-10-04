import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * npm run seed:techfest [file]
 * Imports a fest and its events (default: seed/techfest-2025.json) into the database in .env.
 * Safe to run again: existing records are matched by slug and never overwritten.
 */
async function main() {
  process.env.JOBS_ENABLED = 'false'; // a one-off command must not start working the email queue
  const file = resolve(process.argv[2] ?? resolve(__dirname, '../../seed/techfest-2025.json'));
  const data = JSON.parse(readFileSync(file, 'utf8'));

  // Imported after the env tweak above, so config sees it.
  const { NestFactory } = await import('@nestjs/core');
  const { setupMongoose } = await import('../database/mongoose-setup');
  setupMongoose();
  const { AppModule } = await import('../app.module');
  const { EventSeedService } = await import('../local-events/event-seed.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const r = await app.get(EventSeedService).importFile(data);
    console.log(
      `${r.festCreated ? 'Created' : 'Found'} fest "${r.festSlug}": ${r.inserted} events added, ${r.existing} already present` +
        (r.departmentsAdded ? `, ${r.departmentsAdded} departments attached` : '') +
        (r.imagesUpdated ? `, ${r.imagesUpdated} posters switched to the self-hosted copies.` : '.'),
    );
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
