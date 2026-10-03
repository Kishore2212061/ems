import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Errors } from '../common/app-exception';
import { IS_PUBLIC } from '../common/decorators';
import { TokenService } from './token.service';

/**
 * Global guard: every route needs a valid access token unless marked @Public().
 * Stateless (signature + expiry only) — no DB hit per request. Revocation is enforced at refresh,
 * so a revoked session dies within one access-token TTL.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw Errors.unauthorized();

    try {
      req.user = this.tokens.verifyAccess(header.slice(7));
      return true;
    } catch (e: any) {
      throw e?.name === 'TokenExpiredError'
        ? Errors.unauthorized('TOKEN_EXPIRED', 'Session expired')
        : Errors.unauthorized('TOKEN_INVALID', 'Invalid session');
    }
  }
}
