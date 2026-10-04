import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../common/decorators';
import { PERMISSIONS, ROLE_PERMISSIONS } from './permissions';
import { NO_ACCESS, RbacService } from './rbac.service';

const rbac = new RbacService(null as any, null as any); // pure methods only
const id = () => new Types.ObjectId().toHexString();
const user = (...roles: [string, string, string | null][]): AuthUser => ({
  id: id(),
  sv: 0,
  roles: roles.map(([r, st, sid]) => ({ r, st, sid })),
});

const X = id(); // global event
const Y = id(); // another global event
const CSE = id(); // department
const MECH = id();
const BLIND = id(); // local event

describe('RbacService.can', () => {
  it('SUPER_ADMIN can do everything, anywhere', () => {
    const u = user(['SUPER_ADMIN', 'ORG', null]);
    for (const p of PERMISSIONS) expect(rbac.can(u, p, { globalEventId: Y })).toBe(true);
  });

  it('a fest-scoped ADMIN acts only inside that fest', () => {
    const u = user(['ADMIN', 'GLOBAL_EVENT', X]);
    expect(rbac.can(u, 'global_event.update', { globalEventId: X })).toBe(true);
    expect(rbac.can(u, 'global_event.update', { globalEventId: Y })).toBe(false);
    expect(rbac.can(u, 'local_event.manage', { globalEventId: X, departmentId: MECH, localEventId: BLIND })).toBe(true);
    // Publishing / creating fests is Super Admin only.
    expect(rbac.can(u, 'global_event.publish', { globalEventId: X })).toBe(false);
    expect(rbac.can(u, 'global_event.create')).toBe(false);
  });

  it('a department ADMIN manages only that department', () => {
    const u = user(['ADMIN', 'DEPARTMENT', CSE]);
    expect(rbac.can(u, 'local_event.manage', { globalEventId: X, departmentId: CSE })).toBe(true);
    expect(rbac.can(u, 'local_event.manage', { globalEventId: X, departmentId: MECH })).toBe(false);
    expect(rbac.can(u, 'local_event.manage', {})).toBe(false); // scoped role needs a matching resource
  });

  it('a SCANNER can only scan its own event and has no console access', () => {
    const u = user(['SCANNER', 'LOCAL_EVENT', BLIND]);
    expect(rbac.can(u, 'checkin.scan', { localEventId: BLIND })).toBe(true);
    expect(rbac.can(u, 'checkin.scan', { localEventId: id() })).toBe(false);
    expect(rbac.hasAny(u, 'admin.access')).toBe(false);
    expect(rbac.hasAny(u, 'scan.access')).toBe(true);
  });

  it('a PARTICIPANT has no permissions', () => {
    const u = user(['PARTICIPANT', 'ORG', null]);
    expect(PERMISSIONS.some((p) => rbac.hasAny(u, p))).toBe(false);
  });

  it('multiple roles combine (CSE admin + scanner elsewhere)', () => {
    const u = user(['ADMIN', 'DEPARTMENT', CSE], ['SCANNER', 'LOCAL_EVENT', BLIND], ['PARTICIPANT', 'ORG', null]);
    expect(rbac.can(u, 'local_event.manage', { departmentId: CSE })).toBe(true);
    expect(rbac.can(u, 'checkin.scan', { localEventId: BLIND })).toBe(true);
    expect(rbac.can(u, 'checkin.scan', { localEventId: id(), departmentId: CSE })).toBe(true); // department admins can run their own gates
    expect(rbac.can(u, 'checkin.scan', { localEventId: id(), departmentId: id() })).toBe(false); // …not other departments'
  });

  it('assertCan throws a 403 naming the permission', () => {
    const u = user(['PARTICIPANT', 'ORG', null]);
    expect(() => rbac.assertCan(u, 'user.manage')).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('every role only references known permissions', () => {
    for (const set of Object.values(ROLE_PERMISSIONS)) for (const p of set) expect(PERMISSIONS).toContain(p);
  });
});

describe('RbacService.scopeFilter', () => {
  const fields = { globalEventId: 'global_event_id', departmentId: 'department_id' };

  it('ORG-wide role → no restriction', () => {
    expect(rbac.scopeFilter(user(['SUPER_ADMIN', 'ORG', null]), 'local_event.read', fields)).toEqual({});
  });

  it('one scope → a single indexed $in clause', () => {
    const f = rbac.scopeFilter(user(['ADMIN', 'GLOBAL_EVENT', X]), 'local_event.read', fields);
    expect(f).toEqual({ global_event_id: { $in: [new Types.ObjectId(X)] } });
  });

  it('several scopes → $or of $in clauses', () => {
    const f = rbac.scopeFilter(user(['ADMIN', 'GLOBAL_EVENT', X], ['ADMIN', 'DEPARTMENT', CSE], ['ADMIN', 'DEPARTMENT', MECH]), 'local_event.read', fields);
    expect(f).toEqual({
      $or: [
        { global_event_id: { $in: [new Types.ObjectId(X)] } },
        { department_id: { $in: [new Types.ObjectId(CSE), new Types.ObjectId(MECH)] } },
      ],
    });
  });

  it('no qualifying role, or a scope the collection lacks → NO_ACCESS', () => {
    expect(rbac.scopeFilter(user(['PARTICIPANT', 'ORG', null]), 'local_event.read', fields)).toBe(NO_ACCESS);
    expect(rbac.scopeFilter(user(['ADMIN', 'LOCAL_EVENT', BLIND]), 'local_event.read', fields)).toBe(NO_ACCESS);
  });

  it('ignores malformed scope ids instead of crashing', () => {
    expect(rbac.scopeFilter(user(['ADMIN', 'GLOBAL_EVENT', 'not-an-id']), 'local_event.read', fields)).toBe(NO_ACCESS);
  });
});

describe('RbacService.withScope', () => {
  it('never lets the scope overwrite the requested id (regression: spread merged _id keys)', () => {
    const requested = new Types.ObjectId();
    const scope = rbac.scopeFilter(user(['ADMIN', 'GLOBAL_EVENT', X]), 'global_event.read', { globalEventId: '_id' });
    expect(rbac.withScope({ _id: requested }, scope)).toEqual({ $and: [{ _id: requested }, { _id: { $in: [new Types.ObjectId(X)] } }] });
  });

  it('leaves the filter untouched for org-wide access', () => {
    expect(rbac.withScope({ status: 'DRAFT' }, {})).toEqual({ status: 'DRAFT' });
  });
});
