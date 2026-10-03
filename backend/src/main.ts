import 'reflect-metadata';
import { env } from './config/env';
import { setupMongoose } from './database/mongoose-setup';

setupMongoose(); // before any model compiles

import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // Fastify: ~2x Express throughput with lower per-request overhead.
    // trustProxy = number of proxy hops in front of us (Railway edge + nginx = 2). Trusting a fixed
    // hop count, not "true", stops clients spoofing X-Forwarded-For to dodge per-IP rate limits.
    new FastifyAdapter({ trustProxy: env.TRUST_PROXY_HOPS, bodyLimit: 100 * 1024 }),
    { logger: env.NODE_ENV === 'development' ? ['log', 'warn', 'error', 'debug'] : ['log', 'warn', 'error'] },
  );

  await app.register(fastifyHelmet, { contentSecurityPolicy: false }); // JSON API: no HTML to protect
  await app.register(fastifyCookie);

  app.setGlobalPrefix('api/v1');
  // Prod traffic is same-origin via nginx; CORS only matters for direct API calls (local tools, previews).
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
  app.enableShutdownHooks();

  // "::" = dual-stack; required for Railway private networking (IPv6).
  await app.listen(env.PORT, '::');
  new Logger('Bootstrap').log(`API ready on :${env.PORT}/api/v1 (${env.NODE_ENV})`);
}

void bootstrap();
