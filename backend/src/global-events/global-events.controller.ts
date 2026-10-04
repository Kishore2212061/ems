import { Body, Controller, Get, Header, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Types } from 'mongoose';
import { type AuthUser, CurrentUser, Public } from '../common/decorators';
import { ObjectIdPipe } from '../common/util';
import { ZodPipe } from '../common/zod.pipe';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { AdminFestQuery, CloneDto, CreateFestDto, SetDepartmentsDto, SuspendDto, UpdateFestDto } from './global-events.dto';
import { GlobalEventsService } from './global-events.service';
import { z } from 'zod';

@Controller('global-events')
export class PublicGlobalEventsController {
  constructor(private readonly fests: GlobalEventsService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  list() {
    return this.fests.listPublic();
  }

  @Public()
  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=60')
  get(@Param('slug') slug: string) {
    return this.fests.getPublic(slug.toLowerCase().slice(0, 80));
  }
}

const ctx = (user: AuthUser, req: FastifyRequest) => ({ user, ip: req.ip });

@Controller('admin/global-events')
export class AdminGlobalEventsController {
  constructor(private readonly fests: GlobalEventsService) {}

  @RequirePermission('global_event.read')
  @Get()
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(AdminFestQuery)) q: z.infer<typeof AdminFestQuery>) {
    return this.fests.listAdmin(u, q.status);
  }

  @RequirePermission('global_event.read')
  @Get(':id')
  get(@Param('id', ObjectIdPipe) id: Types.ObjectId, @CurrentUser() u: AuthUser) {
    return this.fests.getAdmin(id, u);
  }

  @RequirePermission('global_event.create')
  @Post()
  create(@Body(new ZodPipe(CreateFestDto)) dto: CreateFestDto, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.fests.create(dto, ctx(u, req));
  }

  @RequirePermission('global_event.update')
  @Patch(':id')
  update(
    @Param('id', ObjectIdPipe) id: Types.ObjectId,
    @Body(new ZodPipe(UpdateFestDto)) dto: UpdateFestDto,
    @CurrentUser() u: AuthUser,
    @Req() req: FastifyRequest,
  ) {
    return this.fests.update(id, dto, ctx(u, req));
  }

  @RequirePermission('global_event.update')
  @Put(':id/departments')
  setDepartments(
    @Param('id', ObjectIdPipe) id: Types.ObjectId,
    @Body(new ZodPipe(SetDepartmentsDto)) dto: SetDepartmentsDto,
    @CurrentUser() u: AuthUser,
    @Req() req: FastifyRequest,
  ) {
    return this.fests.setDepartments(id, dto, ctx(u, req));
  }

  @RequirePermission('global_event.publish')
  @Post(':id/publish')
  publish(@Param('id', ObjectIdPipe) id: Types.ObjectId, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.fests.publish(id, ctx(u, req));
  }

  @RequirePermission('global_event.publish')
  @Post(':id/suspend')
  suspend(
    @Param('id', ObjectIdPipe) id: Types.ObjectId,
    @Body(new ZodPipe(SuspendDto)) dto: z.infer<typeof SuspendDto>,
    @CurrentUser() u: AuthUser,
    @Req() req: FastifyRequest,
  ) {
    return this.fests.suspend(id, dto.reason, ctx(u, req));
  }

  @RequirePermission('global_event.publish')
  @Post(':id/reactivate')
  reactivate(@Param('id', ObjectIdPipe) id: Types.ObjectId, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.fests.reactivate(id, ctx(u, req));
  }

  @RequirePermission('global_event.publish')
  @Post(':id/complete')
  complete(@Param('id', ObjectIdPipe) id: Types.ObjectId, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.fests.complete(id, ctx(u, req));
  }

  @RequirePermission('global_event.create')
  @Post(':id/clone')
  clone(
    @Param('id', ObjectIdPipe) id: Types.ObjectId,
    @Body(new ZodPipe(CloneDto)) dto: CloneDto,
    @CurrentUser() u: AuthUser,
    @Req() req: FastifyRequest,
  ) {
    return this.fests.clone(id, dto, ctx(u, req));
  }
}
