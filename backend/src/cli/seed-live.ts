import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * npm run seed:live [-- --year 2027]
 * Publishes the upcoming NEC Tech Fest as a live fest, built from the Tech Fest '25 catalogue:
 * same events on the new dates, registration open, and a free / pay-online / pay-at-desk mix
 * (see local-events/live-edition.ts). Safe to run again: existing records are never overwritten.
 */
async function main() {
  process.env.JOBS_ENABLED = 'false'; // a one-off command must not start working the email queue
  const { buildLiveEdition, upcomingYear } = await import('../local-events/live-edition');
  const yearArg = process.argv.indexOf('--year');
  const year = yearArg > 0 ? Number(process.argv[yearArg + 1]) : upcomingYear();
  if (!Number.isInteger(year) || year < 2000) throw new Error('Pass a valid year, e.g. --year 2027');

  const past = JSON.parse(readFileSync(resolve(__dirname, '../../seed/techfest-2025.json'), 'utf8'));
  const live = buildLiveEdition(past, year);

  const { NestFactory } = await import('@nestjs/core');
  const { setupMongoose } = await import('../database/mongoose-setup');
  setupMongoose();
  const { AppModule } = await import('../app.module');
  const { EventSeedService } = await import('../local-events/event-seed.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const r = await app.get(EventSeedService).importFile(live);
    const mix = { free: 0, online: 0, desk: 0, both: 0 };
    for (const e of live.events) {
      const m = e.pricing.modes;
      if (e.pricing.type === 'FREE') mix.free++;
      else if (m.length === 2) mix.both++;
      else if (m[0] === 'ONLINE') mix.online++;
      else mix.desk++;
    }
    console.log(`${r.festCreated ? 'Published' : 'Found'} "${live.fest.name}" (${live.fest.startsAt.slice(0, 10)}): ${r.inserted} events added, ${r.existing} already present.`);
    if (r.imagesUpdated) console.log(`Posters switched to the self-hosted copies: ${r.imagesUpdated}.`);
    console.log(`Entry: ${mix.free} free · ${mix.online} pay online · ${mix.desk} pay at the desk · ${mix.both} either.`);
    console.log(`Public page: /events/${live.fest.slug}`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
