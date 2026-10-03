import { SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions';

export const REQUIRED_PERMISSION = 'requiredPermission';

/**
 * Route-level gate, checked by the global auth guard from JWT claims (no DB call):
 * the user needs this permission through at least one role, in any scope.
 * Resource-specific scope is then enforced in the service with RbacService.assertCan / scopeFilter.
 */
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRED_PERMISSION, permission);
