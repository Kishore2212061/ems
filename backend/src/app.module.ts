import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { AppThrottlerGuard } from './common/throttler.guard';
import { env } from './config/env';
import { HealthController } from './health/health.controller';
import { MailModule } from './mail/mail.module';
import { SeedModule } from './seed/seed.module';

@Module({
  imports: [
    MongooseModule.forRoot(env.MONGODB_URI, {
      maxPoolSize: env.DB_POOL_MAX,
      minPoolSize: 1,
      serverSelectionTimeoutMS: 8000,
      // Builds indexes on boot (idempotent). Cheap at this stage; revisit when collections are large.
      autoIndex: true,
    }),
    // In-memory store is fine for a single instance; swap to a Mongo-backed store when scaling out.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    MailModule,
    AuthModule,
    SeedModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
