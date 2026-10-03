import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export interface AuthUser {
  id: string;
  roles: { r: string; st: string; sid: string | null }[];
  sv: number;
}

export const IS_PUBLIC = 'isPublic';
/** Opt a route out of the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
