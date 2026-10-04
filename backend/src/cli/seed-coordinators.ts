/**
 * npm run seed:coordinators
 * Copies the coordinators from seed/techfest-2025.json onto the matching events (same slug) of every
 * fest in the database, e.g. NEC Tech Fest '25 and its '27 edition. The seed file holds made-up
 * sample names and numbers, so this replaces the real people's contact details in existing data.
 * Events organisers created themselves (slugs not in the file) are left alone. Safe to re-run.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function main() {
  process.env.JOBS_ENABLED = 'false';
  const { NestFactory } = await import('@nestjs/core');
  const { getModelToken } = await import('@nestjs/mongoose');
  const { setupMongoose } = await import('../database/mongoose-setup');
  setupMongoose();
  const { AppModule } = await import('../app.module');
  const { LOCAL_EVENT_MODEL } = await import('../local-events/local-event.schema');

  const seed: { events: { slug: string; coordinators: { name: string; phone?: string; role: string }[] }[] } = JSON.parse(
    readFileSync(resolve(__dirname, '../../seed/techfest-2025.json'), 'utf8'),
  );
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const events = app.get(getModelToken(LOCAL_EVENT_MODEL));
    const r = await events.bulkWrite(
      seed.events.map((e) => ({
        updateMany: {
          filter: { slug: e.slug },
          update: { $set: { coordinators: e.coordinators.map((c) => ({ name: c.name, phone: c.phone ?? null, role: c.role })) } },
        },
      })),
      { ordered: false, timestamps: false },
    );
    console.log(`Coordinators set from the seed file: ${r.modifiedCount} events updated (${r.matchedCount} matched).`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
