import 'reflect-metadata';
import { env } from './config/env';
import { setupMongoose } from './database/mongoose-setup';

setupMongoose(); // before any model compiles

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { configureApp, createAdapter } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createAdapter(), {
    logger: env.NODE_ENV === 'development' ? ['log', 'warn', 'error', 'debug'] : ['log', 'warn', 'error'],
  });
  await configureApp(app);
  app.enableShutdownHooks();

  // "::" = dual-stack; required for Railway private networking (IPv6).
  await app.listen(env.PORT, '::');
  new Logger('Bootstrap').log(`API ready on :${env.PORT}/api/v1 (${env.NODE_ENV})`);
}

void bootstrap();
