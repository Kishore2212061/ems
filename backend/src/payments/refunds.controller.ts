import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../common/decorators';
import { objectId, ObjectIdPipe } from '../common/util';
import { ZodPipe } from '../common/zod.pipe';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { REFUND_STATUS } from './refund.schema';
import { RefundsService } from './refunds.service';

const RequestDto = z.object({ reason: z.string().trim().min(5, 'Tell us briefly why').max(300) });
const NoteDto = z.object({ note: z.string().trim().min(3, 'Add a short note').max(300) });
const OptionalNoteDto = z.object({ note: z.string().trim().max(300).optional() });
const ListQuery = z.object({
  festId: objectId,
  status: z.enum(REFUND_STATUS).optional(),
  cursor: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

@Controller()
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Post('registrations/:code/refund-request')
  request(@Param('code') code: string, @Body(new ZodPipe(RequestDto)) dto: z.infer<typeof RequestDto>, @CurrentUser() u: AuthUser) {
    return this.refunds.request(u, code.toUpperCase().slice(0, 12), dto.reason);
  }

  @Get('refunds/my')
  mine(@CurrentUser() u: AuthUser) {
    return this.refunds.mine(u);
  }

  @RequirePermission('refund.approve')
  @Get('admin/refunds')
  list(@Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>, @CurrentUser() u: AuthUser) {
    return this.refunds.list(u, q);
  }

  @RequirePermission('refund.approve')
  @Post('admin/refunds/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ObjectIdPipe) id: Types.ObjectId, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.refunds.approve(u, id, req.ip);
  }

  @RequirePermission('refund.approve')
  @Post('admin/refunds/:id/reject')
  @HttpCode(200)
  reject(@Param('id', ObjectIdPipe) id: Types.ObjectId, @Body(new ZodPipe(NoteDto)) dto: z.infer<typeof NoteDto>, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.refunds.reject(u, id, dto.note, req.ip);
  }

  @RequirePermission('refund.approve')
  @Post('admin/refunds/:id/mark-paid')
  @HttpCode(200)
  markPaid(@Param('id', ObjectIdPipe) id: Types.ObjectId, @Body(new ZodPipe(OptionalNoteDto)) dto: z.infer<typeof OptionalNoteDto>, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.refunds.markPaid(u, id, dto.note || null, req.ip);
  }

  @RequirePermission('refund.approve')
  @Post('admin/refunds/:id/retry')
  @HttpCode(200)
  retry(@Param('id', ObjectIdPipe) id: Types.ObjectId, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.refunds.retry(u, id, req.ip);
  }

  @RequirePermission('refund.approve')
  @Get('admin/refund-batches')
  batches(@Query(new ZodPipe(z.object({ festId: objectId }))) q: { festId: Types.ObjectId }, @CurrentUser() u: AuthUser) {
    return this.refunds.listBatches(u, q.festId);
  }

  @RequirePermission('refund.approve')
  @Post('admin/refund-batches/:id/resume')
  @HttpCode(200)
  resume(@Param('id', ObjectIdPipe) id: Types.ObjectId, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.refunds.resume(u, id, req.ip);
  }
}
