import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Errors } from '../common/app-exception';
import { IS_PUBLIC } from '../common/decorators';
import type { Permission } from '../rbac/permissions';
import { Forbidden, RbacService } from '../rbac/rbac.service';
import { REQUIRED_PERMISSION } from '../rbac/require-permission.decorator';
import { TokenService } from './token.service';

/**
 * Global guard, in this order:
 *  1. @Public() routes pass.
 *  2. Valid access token required (signature + expiry; no DB hit).
 *  3. @RequirePermission(p) → some role in the token grants p (no DB hit).
 * Revocation is enforced at refresh, so a revoked session dies within one access-token TTL.
 * Doing both checks in one guard guarantees the permission check always runs after authentication.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly rbac: RbacService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw Errors.unauthorized();

    try {
      req.user = this.tokens.verifyAccess(header.slice(7));
    } catch (e: any) {
      throw e?.name === 'TokenExpiredError'
        ? Errors.unauthorized('TOKEN_EXPIRED', 'Session expired')
        : Errors.unauthorized('TOKEN_INVALID', 'Invalid session');
    }

    const perm = this.reflector.getAllAndOverride<Permission | undefined>(REQUIRED_PERMISSION, targets);
    if (perm && !this.rbac.hasAny(req.user, perm)) throw Forbidden(perm);
    return true;
  }
}
