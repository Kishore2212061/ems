import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../common/decorators';
import { ObjectIdPipe } from '../common/util';
import { ZodPipe } from '../common/zod.pipe';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { CheckinsService } from './checkins.service';

const ScanDto = z
  .object({
    qr: z.string().trim().max(200).optional(),
    code: z.string().trim().max(20).optional(),
    deviceId: z.string().trim().max(64).optional(),
  })
  .refine((v) => v.qr || v.code, { message: 'Scan a QR or enter a ticket code', path: ['code'] });
const LookupQuery = z.object({ q: z.string().trim().min(3, 'Type at least 3 characters').max(254) });

/** Gate check-in (scanners for their fest; admins within their scope). */
@Controller('checkins')
export class CheckinsController {
  constructor(private readonly checkins: CheckinsService) {}

  @RequirePermission('checkin.scan')
  @Get('events')
  events(@CurrentUser() u: AuthUser) {
    return this.checkins.gateEvents(u);
  }

  @RequirePermission('checkin.scan')
  @Post(':eventId/scan')
  @HttpCode(200)
  scan(@Param('eventId', ObjectIdPipe) id: Types.ObjectId, @Body(new ZodPipe(ScanDto)) dto: z.infer<typeof ScanDto>, @CurrentUser() u: AuthUser) {
    return this.checkins.scan(u, id, dto);
  }

  @RequirePermission('checkin.scan')
  @Get(':eventId/lookup')
  lookup(@Param('eventId', ObjectIdPipe) id: Types.ObjectId, @Query(new ZodPipe(LookupQuery)) q: z.infer<typeof LookupQuery>, @CurrentUser() u: AuthUser) {
    return this.checkins.lookup(u, id, q.q);
  }

  @RequirePermission('checkin.scan')
  @Get(':eventId/summary')
  summary(@Param('eventId', ObjectIdPipe) id: Types.ObjectId, @CurrentUser() u: AuthUser) {
    return this.checkins.summary(u, id);
  }
}
