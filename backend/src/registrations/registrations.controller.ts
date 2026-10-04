import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../common/decorators';
import { ObjectIdPipe } from '../common/util';
import { ZodPipe } from '../common/zod.pipe';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { AdminCancelDto, AdminRegistrationQuery, CancelDto, CreateRegistrationDto, IdempotencyKey } from './registrations.dto';
import { RegistrationsService } from './registrations.service';

const code = (s: string) => s.toUpperCase().slice(0, 12);
// @Headers() takes no pipes, so the key is validated by hand (same 400 shape as any other field).
const idempotencyKey = new ZodPipe(IdempotencyKey);

/** The signed-in person's own registrations. Ownership checks, no permission needed. */
@Controller('registrations')
export class RegistrationsController {
  constructor(private readonly regs: RegistrationsService) {}

  // Per person (see AppThrottlerGuard): a campus behind one NAT IP isn't throttled as one user.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  create(
    @Body(new ZodPipe(CreateRegistrationDto)) dto: CreateRegistrationDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentUser() u: AuthUser,
  ) {
    return this.regs.create(u, dto, idempotencyKey.transform(key));
  }

  @Get('my')
  mine(@CurrentUser() u: AuthUser) {
    return this.regs.mine(u);
  }

  @Get(':code')
  get(@Param('code') c: string, @CurrentUser() u: AuthUser) {
    return this.regs.getMine(u, code(c));
  }

  @Post(':code/cancel')
  @HttpCode(200)
  cancel(@Param('code') c: string, @Body(new ZodPipe(CancelDto)) dto: z.infer<typeof CancelDto>, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.regs.cancelMine(u, code(c), dto.reason || null, req.ip);
  }
}

@Controller('admin')
export class AdminRegistrationsController {
  constructor(private readonly regs: RegistrationsService) {}

  @RequirePermission('registration.read')
  @Get('local-events/:id/registrations')
  list(@Param('id', ObjectIdPipe) id: Types.ObjectId, @Query(new ZodPipe(AdminRegistrationQuery)) q: AdminRegistrationQuery, @CurrentUser() u: AuthUser) {
    return this.regs.adminList(u, id, q);
  }

  @RequirePermission('registration.read')
  @Get('registrations/:code')
  get(@Param('code') c: string, @CurrentUser() u: AuthUser) {
    return this.regs.adminGet(u, code(c));
  }

  @RequirePermission('registration.manage')
  @Post('registrations/:code/cancel')
  @HttpCode(200)
  cancel(@Param('code') c: string, @Body(new ZodPipe(AdminCancelDto)) dto: z.infer<typeof AdminCancelDto>, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.regs.adminCancel(u, code(c), dto.reason, req.ip);
  }
}
