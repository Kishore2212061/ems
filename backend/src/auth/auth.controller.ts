import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, ResendOtpDto, ResetPasswordDto, SignupDto, VerifyOtpDto } from './auth.dto';
import { AuthService, SessionResult } from './auth.service';
import { ClientCtx, REFRESH_COOKIE, TokenService } from './token.service';

const ctxOf = (req: FastifyRequest): ClientCtx => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

// Per IP+email (see AppThrottlerGuard) — tight enough to stop guessing, loose enough for shared campus IPs.
const AUTH_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  /** Moves the refresh token into an HttpOnly cookie — it never appears in a JSON body. */
  private withSession(reply: FastifyReply, s: SessionResult) {
    const { refreshToken, ...body } = s;
    if (refreshToken) reply.setCookie(REFRESH_COOKIE, refreshToken, this.tokens.cookieOptions());
    return body;
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('signup')
  @HttpCode(201)
  signup(@Body(new ZodPipe(SignupDto)) dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(LoginDto)) dto: LoginDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const r = await this.auth.login(dto, ctxOf(req));
    return 'otpRequired' in r ? r : this.withSession(reply, r);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('verify-otp')
  @HttpCode(200)
  async verifyOtp(
    @Body(new ZodPipe(VerifyOtpDto)) dto: VerifyOtpDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withSession(reply, await this.auth.verifyOtp(dto, ctxOf(req)));
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('resend-otp')
  @HttpCode(200)
  resendOtp(@Body(new ZodPipe(ResendOtpDto)) dto: ResendOtpDto) {
    return this.auth.resendOtp(dto.otpToken);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body(new ZodPipe(ForgotPasswordDto)) dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(
    @Body(new ZodPipe(ResetPasswordDto)) dto: ResetPasswordDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withSession(reply, await this.auth.resetPassword(dto, ctxOf(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      return this.withSession(reply, await this.auth.refresh(req.cookies[REFRESH_COOKIE], ctxOf(req)));
    } catch (e) {
      reply.clearCookie(REFRESH_COOKIE, { path: this.tokens.cookieOptions().path });
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(req.cookies[REFRESH_COOKIE]);
    reply.clearCookie(REFRESH_COOKIE, { path: this.tokens.cookieOptions().path });
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  // ── security settings (under /auth so the refresh cookie identifies "this device") ──

  @Throttle(AUTH_LIMIT)
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(ChangePasswordDto)) dto: ChangePasswordDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withSession(reply, await this.auth.changePassword(user.id, dto, ctxOf(req)));
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest) {
    return this.auth.listSessions(user.id, req.cookies[REFRESH_COOKIE]);
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  revokeOthers(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest) {
    return this.auth.revokeOtherSessions(user.id, req.cookies[REFRESH_COOKIE]);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return; // not a family id → nothing to do
    await this.auth.revokeSession(user.id, id);
  }
}
