import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { Connection } from 'mongoose';
import { Public } from '../common/decorators';

@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  /** Railway healthcheck target. 503 when Mongo is unreachable so the deploy is held back. */
  @Get()
  check(@Res({ passthrough: true }) reply: FastifyReply) {
    const db = this.conn.readyState === 1 ? 'up' : 'down';
    if (db === 'down') reply.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: db === 'up' ? 'ok' : 'degraded', db, uptime: Math.round(process.uptime()) };
  }
}
