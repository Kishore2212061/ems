import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Public } from '../common/decorators';
import { Errors } from '../common/app-exception';
import { ZodPipe } from '../common/zod.pipe';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { FeeSettingsService } from './fee-settings.service';
import { CollectDto, FeeSettingsDto, ORDER_CODE, OrderListQuery, VerifyDto } from './payments.dto';
import { PaymentsService } from './payments.service';

const order = (c: string) => {
  const code = c.toUpperCase();
  if (!ORDER_CODE.test(code)) throw Errors.notFound('Order');
  return code;
};

@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly fees: FeeSettingsService,
  ) {}

  /** Public fee settings, so the register sheet can show the exact total before submitting. */
  @Public()
  @Get('fees')
  @Header('Cache-Control', 'public, max-age=60')
  getFees() {
    return this.fees.get();
  }

  @Post('registrations/:code/order')
  createOrder(@Param('code') code: string, @CurrentUser() u: AuthUser) {
    return this.payments.createOrder(u, code.toUpperCase().slice(0, 12));
  }

  @Post('orders/:code/verify')
  @HttpCode(200)
  verify(@Param('code') code: string, @Body(new ZodPipe(VerifyDto)) dto: VerifyDto, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.payments.verify(u, order(code), dto, req.ip);
  }

  @Get('orders/:code')
  status(@Param('code') code: string, @CurrentUser() u: AuthUser) {
    return this.payments.status(u, order(code));
  }

  /** Development only: the simulated gateway's "Pay" button. 404 with a real gateway or in production. */
  @Post('orders/:code/simulate')
  @HttpCode(200)
  simulate(@Param('code') code: string, @CurrentUser() u: AuthUser) {
    return this.payments.simulatePay(u, order(code));
  }

  /** Razorpay webhook: signed over the raw body (kept for /webhooks/* only, see app.setup). */
  @Public()
  @SkipThrottle()
  @Post('webhooks/razorpay')
  @HttpCode(200)
  webhook(@Req() req: FastifyRequest & { rawBody?: Buffer }, @Headers('x-razorpay-signature') sig?: string, @Headers('x-razorpay-event-id') eventId?: string) {
    return this.payments.webhook(req.rawBody, sig, eventId);
  }

  // ── staff ──

  @RequirePermission('order.collect_offline')
  @Post('admin/registrations/:code/collect')
  @HttpCode(200)
  collect(@Param('code') code: string, @Body(new ZodPipe(CollectDto)) dto: z.infer<typeof CollectDto>, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.payments.collectOffline(u, code.toUpperCase().slice(0, 12), dto.amountPaise, req.ip);
  }

  @RequirePermission('order.read')
  @Get('admin/orders')
  list(@Query(new ZodPipe(OrderListQuery)) q: OrderListQuery, @CurrentUser() u: AuthUser) {
    return this.payments.list(u, q);
  }

  @RequirePermission('settings.manage')
  @Put('admin/settings/fees')
  setFees(@Body(new ZodPipe(FeeSettingsDto)) dto: z.infer<typeof FeeSettingsDto>, @CurrentUser() u: AuthUser) {
    return this.fees.set(dto, u.id);
  }
}
