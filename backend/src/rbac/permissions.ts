import type { Role } from '../users/user.schema';

/**
 * Every permission in the system. Grow this list module by module; the type keeps call sites honest.
 * Participant actions (own registrations, own tickets) are ownership checks, not permissions.
 */
export const PERMISSIONS = [
  // consoles
  'admin.access',
  'scan.access',
  // org setup (Module 2)
  'department.manage',
  'user.read',
  'user.invite',
  'user.manage',
  'audit.read',
  // global events (Module 2)
  'global_event.create',
  'global_event.read',
  'global_event.update',
  'global_event.publish',
  'global_event.cancel',
  // local events (Module 3)
  'local_event.read',
  'local_event.manage',
  'local_event.publish',
  'local_event.cancel',
  // registrations / payments / check-in / refunds / reports (Modules 4–9)
  'registration.read',
  'registration.manage',
  'order.read',
  'order.collect_offline',
  'refund.approve',
  'checkin.scan',
  'checkin.manual',
  'report.read',
  'report.finance',
  'export.pii',
  'settings.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Role → permissions. SUPER_ADMIN implicitly has everything.
 * A permission granted by a scoped role only applies inside that role's scope (see RbacService).
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = Object.freeze({
  SUPER_ADMIN: new Set<Permission>(PERMISSIONS),
  ADMIN: new Set<Permission>([
    'admin.access',
    'global_event.read',
    'global_event.update',
    'local_event.read',
    'local_event.manage',
    'local_event.publish',
    'local_event.cancel',
    'registration.read',
    'registration.manage',
    'checkin.manual',
    'user.read',
    'user.invite',
    'report.read',
  ]),
  FINANCE: new Set<Permission>(['admin.access', 'global_event.read', 'order.read', 'refund.approve', 'report.read', 'report.finance']),
  SCANNER: new Set<Permission>(['scan.access', 'checkin.scan', 'order.collect_offline']),
  PARTICIPANT: new Set<Permission>(),
});
