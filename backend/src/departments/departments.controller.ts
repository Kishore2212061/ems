import { Body, Controller, Get, Header, Param, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Types } from 'mongoose';
import { type AuthUser, CurrentUser, Public } from '../common/decorators';
import { ObjectIdPipe } from '../common/util';
import { ZodPipe } from '../common/zod.pipe';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { DepartmentDto, UpdateDepartmentDto } from './departments.dto';
import { DepartmentsService } from './departments.service';

@Controller()
export class DepartmentsController {
  constructor(private readonly depts: DepartmentsService) {}

  @Public()
  @Get('departments')
  @Header('Cache-Control', 'public, max-age=60')
  listPublic() {
    return this.depts.listActive();
  }

  @RequirePermission('admin.access')
  @Get('admin/departments')
  listAll() {
    return this.depts.listAll();
  }

  @RequirePermission('department.manage')
  @Post('admin/departments')
  create(@Body(new ZodPipe(DepartmentDto)) dto: DepartmentDto, @CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    return this.depts.create(dto, u.id, req.ip);
  }

  @RequirePermission('department.manage')
  @Patch('admin/departments/:id')
  update(
    @Param('id', ObjectIdPipe) id: Types.ObjectId,
    @Body(new ZodPipe(UpdateDepartmentDto)) dto: UpdateDepartmentDto,
    @CurrentUser() u: AuthUser,
    @Req() req: FastifyRequest,
  ) {
    return this.depts.update(id, dto, u.id, req.ip);
  }
}
