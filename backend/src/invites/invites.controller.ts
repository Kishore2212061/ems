import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { REFRESH_COOKIE, TokenService } from '../auth/token.service';
import { Errors } from '../common/app-exception';
import { type AuthUser, CurrentUser, Public } from '../common/decorators';
import { ObjectIdPipe } from '../common/util';
import { ZodPipe } from '../common/zod.pipe';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { AcceptInviteDto, CreateInviteDto, InviteListQuery, InviteToken } from './invites.dto';
import { InvitesService } from './invites.service';

@Controller('admin/invites')
export class AdminInvitesController {
  constructor(private readonly invites: InvitesService) {}

  @RequirePermission('user.invite')
  @Post()
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(CreateInviteDto)) dto: CreateInviteDto, @Req() req: FastifyRequest) {
    return this.invites.create(u, dto, req.ip);
  }

  @RequirePermission('user.invite')
  @Get()
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(InviteListQuery)) q: z.infer<typeof InviteListQuery>) {
    return this.invites.list(u, q.status);
  }

  @RequirePermission('user.invite')
  @Delete(':id')
  @HttpCode(204)
  revoke(@CurrentUser() u: AuthUser, @Param('id', ObjectIdPipe) id: Types.ObjectId, @Req() req: FastifyRequest) {
    return this.invites.revoke(u, id, req.ip);
  }

  @RequirePermission('user.invite')
  @Post(':id/resend')
  @HttpCode(200)
  resend(@CurrentUser() u: AuthUser, @Param('id', ObjectIdPipe) id: Types.ObjectId, @Req() req: FastifyRequest) {
    return this.invites.resend(u, id, req.ip);
  }
}

const token = (raw: string) => {
  if (!InviteToken.safeParse(raw).success) throw Errors.notFound('Invitation');
  return raw;
};

/** Public, token-authenticated. Under /auth so accepting can set the refresh cookie. */
@Controller('auth/invites')
export class PublicInvitesController {
  constructor(
    private readonly invites: InvitesService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  preview(@Param('token') raw: string) {
    return this.invites.preview(token(raw));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':token/accept')
  @HttpCode(200)
  async accept(
    @Param('token') raw: string,
    @Body(new ZodPipe(AcceptInviteDto)) dto: AcceptInviteDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const r = await this.invites.accept(token(raw), dto, { ip: req.ip, userAgent: req.headers['user-agent'] });
    if (r.status === 'ROLE_ADDED') return r;
    const { refreshToken, ...session } = r.session;
    if (refreshToken) reply.setCookie(REFRESH_COOKIE, refreshToken, this.tokens.cookieOptions());
    return { status: r.status, ...session };
  }
}
