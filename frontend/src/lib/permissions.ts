import type { Role, User } from '@/store/auth';

/**
 * Mirror of backend/src/rbac/permissions.ts — only what the UI needs to hide/show things.
 * The API is the real gate; this just avoids offering actions that would 403.
 */
const MATRIX: Record<Role, readonly string[]> = {
  SUPER_ADMIN: ['*'],
  ADMIN: ['admin.access', 'global_event.read', 'global_event.update', 'user.read', 'user.invite', 'local_event.read', 'local_event.manage', 'local_event.publish', 'local_event.cancel', 'registration.read', 'registration.manage', 'order.collect_offline', 'checkin.scan', 'report.read'],
  FINANCE: ['admin.access', 'global_event.read', 'order.read', 'refund.approve', 'report.read', 'report.finance'],
  SCANNER: ['scan.access', 'checkin.scan', 'order.collect_offline'],
  PARTICIPANT: [],
};

export type UiPermission =
  | 'admin.access'
  | 'global_event.read'
  | 'global_event.create'
  | 'global_event.update'
  | 'global_event.publish'
  | 'department.manage'
  | 'user.read'
  | 'user.invite'
  | 'user.manage'
  | 'audit.read'
  | 'local_event.read'
  | 'local_event.manage'
  | 'local_event.publish'
  | 'local_event.cancel'
  | 'registration.read'
  | 'registration.manage'
  | 'order.read'
  | 'order.collect_offline'
  | 'settings.manage'
  | 'checkin.scan'
  | 'refund.approve'
  | 'global_event.cancel'
  | 'report.read'
  | 'report.finance';

const grants = (role: Role, p: UiPermission) => MATRIX[role].includes('*') || MATRIX[role].includes(p);

/** Has the permission through any role (any scope). */
export const can = (user: User | null, p: UiPermission) => !!user?.roles.some((r) => grants(r.role, p));

/** Has it org-wide (e.g. the full user directory). */
export const canOrgWide = (user: User | null, p: UiPermission) => !!user?.roles.some((r) => r.scopeType === 'ORG' && grants(r.role, p));

export const isSuperAdmin = (user: User | null) => !!user?.roles.some((r) => r.role === 'SUPER_ADMIN');

/** Permission on one specific fest: org-wide, or scoped to exactly this fest (mirrors the API). */
export const canOnFest = (user: User | null, p: UiPermission, festId: string) =>
  !!user?.roles.some((r) => grants(r.role, p) && (r.scopeType === 'ORG' || (r.scopeType === 'GLOBAL_EVENT' && r.scopeId === festId)));

/**
 * Permission on a department event (mirrors the API): org-wide, the whole fest, or the event's own
 * department. `departmentId` null = a fest-wide event, which department admins can't touch.
 */
export const canOnEvent = (user: User | null, p: UiPermission, festId: string, departmentId: string | null) =>
  !!user?.roles.some(
    (r) =>
      grants(r.role, p) &&
      (r.scopeType === 'ORG' || (r.scopeType === 'GLOBAL_EVENT' && r.scopeId === festId) || (r.scopeType === 'DEPARTMENT' && departmentId !== null && r.scopeId === departmentId)),
  );

/** Departments (of this fest) the user may create events for; `null` in the list = fest-wide events too. */
export function eventDepartmentsFor(user: User | null, festId: string, festDepartmentIds: string[]): (string | null)[] {
  if (!user) return [];
  if (user.roles.some((r) => grants(r.role, 'local_event.manage') && (r.scopeType === 'ORG' || (r.scopeType === 'GLOBAL_EVENT' && r.scopeId === festId)))) {
    return [null, ...festDepartmentIds];
  }
  return festDepartmentIds.filter((id) => user.roles.some((r) => grants(r.role, 'local_event.manage') && r.scopeType === 'DEPARTMENT' && r.scopeId === id));
}
