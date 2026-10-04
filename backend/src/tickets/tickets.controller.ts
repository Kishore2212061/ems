import { Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Throttle } from '@nestjs/throttler';
import { Model } from 'mongoose';
import { Errors } from '../common/app-exception';
import { type AuthUser, CurrentUser, Public } from '../common/decorators';
import { USER_MODEL, User } from '../users/user.schema';
import { TicketsService } from './tickets.service';

const code = (c: string) => c.toUpperCase().slice(0, 12);

@Controller()
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
  ) {}

  /** Tickets belong to an email (teammates may not have had an account when registered). */
  private async email(u: AuthUser) {
    const me = await this.users.findById(u.id).select('email').lean();
    if (!me) throw Errors.unauthorized();
    return me.email;
  }

  @Get('tickets/my')
  async mine(@CurrentUser() u: AuthUser) {
    return this.tickets.mine(await this.email(u));
  }

  @Get('tickets/:code')
  @Header('Cache-Control', 'private, no-store')
  async get(@Param('code') c: string, @CurrentUser() u: AuthUser) {
    return this.tickets.getMine(await this.email(u), code(c));
  }

  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post('tickets/:code/resend')
  @HttpCode(200)
  async resend(@Param('code') c: string, @CurrentUser() u: AuthUser) {
    return this.tickets.resend(await this.email(u), code(c));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('verify/:code')
  @Header('Cache-Control', 'no-store')
  verify(@Param('code') c: string) {
    return this.tickets.verifyPublic(code(c));
  }
}
