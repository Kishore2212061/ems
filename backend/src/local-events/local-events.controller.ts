import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Public } from '../common/decorators';
import { ObjectIdPipe } from '../common/util';
import { ZodPipe } from '../common/zod.pipe';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { AdminEventQuery, CreateEventDto, PublicEventQuery, ReasonDto, UpdateEventDto } from './local-events.dto';
import { LocalEventsService } from './local-events.service';

const slugParam = (s: string) => s.toLowerCase().slice(0, 80);

@Controller('global-events/:slug/events')
export class PublicLocalEventsController {
  constructor(private readonly events: LocalEventsService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  list(@Param('slug') slug: string, @Query(new ZodPipe(PublicEventQuery)) q: PublicEventQuery) {
    return this.events.listPublic(slugParam(slug), q);
  }

  @Public()
  @Get(':eventSlug')
  @Header('Cache-Control', 'public, max-age=30')
  get(@Param('slug') slug: string, @Param('eventSlug') eventSlug: string) {
    return this.events.getPublic(slugParam(slug), slugParam(eventSlug));
  }
}

const ctx = (user: AuthUser, req: FastifyRequest) => ({ user, ip: req.ip });
type Id = Types.ObjectId;

@Controller('admin')
export class AdminLocalEventsController {
  constructor(private readonly events: LocalEventsService) {}

  @RequirePermission('local_event.read')
  @Get('global-events/:festId/events')
  list(@Param('festId', ObjectIdPipe) festId: Id, @CurrentUser() u: AuthUser, @Query(new ZodPipe(AdminEventQuery)) q: z.infer<typeof AdminEventQuery>) {
    return this.events.listForFest(festId, u, q.status);
  }

  @RequirePermission('local_event.manage')
  @Post('global-events/:festId/events')
  create(@Param('festId', ObjectIdPipe) festId: Id, @Body(new ZodPipe(CreateEventDto)) dto: CreateEventDto, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.events.create(festId, dto, ctx(u, req));
  }

  @RequirePermission('local_event.read')
  @Get('local-events/:id')
  get(@Param('id', ObjectIdPipe) id: Id, @CurrentUser() u: AuthUser) {
    return this.events.getAdmin(id, u);
  }

  @RequirePermission('local_event.manage')
  @Patch('local-events/:id')
  update(@Param('id', ObjectIdPipe) id: Id, @Body(new ZodPipe(UpdateEventDto)) dto: UpdateEventDto, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.events.update(id, dto, ctx(u, req));
  }

  @RequirePermission('local_event.manage')
  @Delete('local-events/:id')
  @HttpCode(204)
  async remove(@Param('id', ObjectIdPipe) id: Id, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    await this.events.removeDraft(id, ctx(u, req));
  }

  @RequirePermission('local_event.publish')
  @Post('local-events/:id/publish')
  publish(@Param('id', ObjectIdPipe) id: Id, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.events.publish(id, ctx(u, req));
  }

  @RequirePermission('local_event.publish')
  @Post('local-events/:id/suspend')
  suspend(@Param('id', ObjectIdPipe) id: Id, @Body(new ZodPipe(ReasonDto)) dto: z.infer<typeof ReasonDto>, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.events.suspend(id, dto.reason, ctx(u, req));
  }

  @RequirePermission('local_event.publish')
  @Post('local-events/:id/reactivate')
  reactivate(@Param('id', ObjectIdPipe) id: Id, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.events.reactivate(id, ctx(u, req));
  }

  @RequirePermission('local_event.publish')
  @Post('local-events/:id/complete')
  complete(@Param('id', ObjectIdPipe) id: Id, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.events.complete(id, ctx(u, req));
  }

  @RequirePermission('global_event.cancel')
  @Post('global-events/:festId/cancel')
  cancelFest(@Param('festId', ObjectIdPipe) festId: Id, @Body(new ZodPipe(ReasonDto)) dto: z.infer<typeof ReasonDto>, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.events.cancelFest(festId, dto.reason, ctx(u, req));
  }

  @RequirePermission('local_event.cancel')
  @Post('local-events/:id/cancel')
  cancel(@Param('id', ObjectIdPipe) id: Id, @Body(new ZodPipe(ReasonDto)) dto: z.infer<typeof ReasonDto>, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.events.cancel(id, dto.reason, ctx(u, req));
  }

  @RequirePermission('local_event.manage')
  @Post('local-events/:id/clone')
  clone(@Param('id', ObjectIdPipe) id: Id, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.events.clone(id, ctx(u, req));
  }
}
