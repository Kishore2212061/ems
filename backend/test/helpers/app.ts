import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Connection } from 'mongoose';

export interface SentMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface TestApp {
  app: NestFastifyApplication;
  conn: Connection;
  outbox: SentMail[];
  /** Latest OTP code emailed to an address. Drains the job queue first, so queued emails are delivered. */
  lastOtp(email: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * Boots the real AppModule on the real Fastify stack (same configureApp as production) against
 * this test file's private database. Emails are captured instead of sent.
 */
export async function createTestApp(extra: { controllers?: any[] } = {}): Promise<TestApp> {
  // Imported lazily so test/setup/env.ts has already populated process.env.
  const { setupMongoose } = await import('../../src/database/mongoose-setup');
  setupMongoose();
  const { AppModule } = await import('../../src/app.module');
  const { configureApp, createAdapter } = await import('../../src/app.setup');
  const { MailService } = await import('../../src/mail/mail.service');
  const { JobsService } = await import('../../src/jobs/jobs.service');

  const outbox: SentMail[] = [];
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: extra.controllers ?? [] })
    .overrideProvider(MailService)
    .useFactory({
      inject: [JobsService],
      factory: (jobs: InstanceType<typeof JobsService>) => {
        const real = new MailService(jobs);
        // Keep real templating; replace the transport with an in-memory outbox.
        (real as any).send = async (m: SentMail) => void outbox.push(m);
        real.onModuleInit = async () => {}; // don't let init swap the transport back
        return real;
      },
    })
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter(), { logger: false });
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const conn = app.get<Connection>(getConnectionToken());
  // Wait for every index so explain()-based tests see the real query plans.
  await Promise.all(Object.values(conn.models).map((m) => m.init()));

  return {
    app,
    conn,
    outbox,
    async lastOtp(email) {
      await app.get(JobsService).drain();
      for (let i = outbox.length - 1; i >= 0; i--) {
        const m = outbox[i];
        if (m.to === email) {
          const code = /\b(\d{6})\b/.exec(m.text)?.[1];
          if (code) return code;
        }
      }
      throw new Error(`No OTP emailed to ${email}`);
    },
    async close() {
      await conn.dropDatabase();
      await app.close();
    },
  };
}
