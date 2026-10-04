import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Types } from 'mongoose';
import { type AuthUser, CurrentUser } from '../common/decorators';
import { ObjectIdPipe } from '../common/util';
import { ZodPipe } from '../common/zod.pipe';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { RoleGrantDto } from './roles';
import { ProfileDto, UserListQuery } from './users.dto';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Patch('me/profile')
  updateProfile(@CurrentUser() u: AuthUser, @Body(new ZodPipe(ProfileDto)) dto: ProfileDto) {
    return this.users.updateProfile(u.id, dto);
  }

  @RequirePermission('user.read')
  @Get('admin/users')
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(UserListQuery)) q: UserListQuery) {
    return this.users.list(u, q);
  }

  @RequirePermission('user.read')
  @Get('admin/users/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ObjectIdPipe) id: Types.ObjectId) {
    return this.users.get(u, id);
  }

  @RequirePermission('user.manage')
  @Post('admin/users/:id/roles')
  grant(@CurrentUser() u: AuthUser, @Param('id', ObjectIdPipe) id: Types.ObjectId, @Body(new ZodPipe(RoleGrantDto)) g: RoleGrantDto, @Req() req: FastifyRequest) {
    return this.users.grantRole(u, id, g, req.ip);
  }

  // POST (not DELETE) because the role tuple travels in the body.
  @RequirePermission('user.manage')
  @Post('admin/users/:id/roles/revoke')
  @HttpCode(200)
  revoke(@CurrentUser() u: AuthUser, @Param('id', ObjectIdPipe) id: Types.ObjectId, @Body(new ZodPipe(RoleGrantDto)) g: RoleGrantDto, @Req() req: FastifyRequest) {
    return this.users.revokeRole(u, id, g, req.ip);
  }

  @RequirePermission('user.manage')
  @Post('admin/users/:id/suspend')
  @HttpCode(200)
  suspend(@CurrentUser() u: AuthUser, @Param('id', ObjectIdPipe) id: Types.ObjectId, @Req() req: FastifyRequest) {
    return this.users.setStatus(u, id, true, req.ip);
  }

  @RequirePermission('user.manage')
  @Post('admin/users/:id/reactivate')
  @HttpCode(200)
  reactivate(@CurrentUser() u: AuthUser, @Param('id', ObjectIdPipe) id: Types.ObjectId, @Req() req: FastifyRequest) {
    return this.users.setStatus(u, id, false, req.ip);
  }
}
