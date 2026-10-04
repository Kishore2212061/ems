import { describe, expect, it } from 'vitest';
import type { Registration } from './ems-api';
import { daysBetween, groupSchedule, isActive, istDay, markFor, overlaps, scheduleOf, selfClashes, windowOf } from './schedule';

const ist = (d: string, t: string) => new Date(`${d}T${t}:00+05:30`).toISOString();
const reg = (over: Partial<Registration>): Registration =>
  ({ code: 'REG-AAAAAA', status: 'CONFIRMED', eventId: 'e1', startsAt: ist('2027-03-12', '10:00'), endsAt: ist('2027-03-12', '12:00'), holdExpiresAt: null, event: { name: 'Blind Coding', status: 'PUBLISHED' }, ...over }) as Registration;

describe('schedule', () => {
  it('an event without an end counts as 2 hours; windows are half-open', () => {
    const w = windowOf(ist('2027-03-12', '09:30'), null);
    expect(w.end - w.start).toBe(2 * 3600_000);
    expect(windowOf(ist('2027-03-12', '09:30'), ist('2027-03-12', '09:30')).end - w.start).toBe(2 * 3600_000); // zero-length → assumed
    const a = windowOf(ist('2027-03-12', '10:00'), ist('2027-03-12', '11:30'));
    expect(overlaps(a, windowOf(ist('2027-03-12', '11:30'), null))).toBe(false); // back to back
    expect(overlaps(a, windowOf(ist('2027-03-12', '11:29'), null))).toBe(true);
  });

  it('days are college-time days, also around midnight', () => {
    expect(istDay(ist('2027-03-13', '00:30'))).toBe('2027-03-13'); // 12 March in UTC
    expect(istDay(ist('2027-03-12', '23:59'))).toBe('2027-03-12');
    expect(daysBetween(ist('2027-03-12', '09:00'), ist('2027-03-13', '17:00'))).toEqual(['2027-03-12', '2027-03-13']);
    expect(daysBetween(ist('2027-03-12', '09:00'), null)).toEqual(['2027-03-12']);
  });

  it('groups by day, then by start time, in time order', () => {
    const e = (n: string, d: string, t: string) => ({ n, startsAt: ist(d, t) });
    const g = groupSchedule([e('c', '2027-03-13', '10:00'), e('a', '2027-03-12', '09:30'), e('b', '2027-03-12', '09:30'), e('d', '2027-03-12', '11:30'), { n: 'x', startsAt: null }]);
    expect(g.map((d) => [d.day, d.slots.map((s) => s.items.map((i) => i.n).join(''))])).toEqual([
      ['2027-03-12', ['ab', 'd']],
      ['2027-03-13', ['c']],
    ]);
  });

  it('expired holds and cancelled events stop counting', () => {
    const now = Date.parse(ist('2027-03-01', '10:00'));
    expect(isActive(reg({ status: 'PAYMENT_PENDING', holdExpiresAt: ist('2027-03-01', '10:05') }), now)).toBe(true);
    expect(isActive(reg({ status: 'PAYMENT_PENDING', holdExpiresAt: ist('2027-03-01', '09:55') }), now)).toBe(false);
    expect(isActive(reg({ event: { status: 'CANCELLED' } as Registration['event'] }), now)).toBe(false);
    expect(isActive(reg({ status: 'CANCELLED' }), now)).toBe(false);
  });

  it('marks: registered, payment pending, or clashing', () => {
    const s = scheduleOf([reg({}), reg({ code: 'REG-BBBBBB', eventId: 'e2', status: 'PAYMENT_PENDING', holdExpiresAt: '2999-01-01T00:00:00Z', startsAt: ist('2027-03-12', '14:00'), endsAt: ist('2027-03-12', '15:00') })], 0);
    expect(markFor({ id: 'e1', startsAt: ist('2027-03-12', '10:00'), endsAt: null }, s)?.kind).toBe('registered');
    expect(markFor({ id: 'e2', startsAt: ist('2027-03-12', '14:00'), endsAt: null }, s)?.kind).toBe('pending');
    expect(markFor({ id: 'e3', startsAt: ist('2027-03-12', '11:00'), endsAt: null }, s)).toMatchObject({ kind: 'clash', reg: { code: 'REG-AAAAAA' } });
    expect(markFor({ id: 'e4', startsAt: ist('2027-03-12', '12:00'), endsAt: ist('2027-03-12', '13:00') }, s)).toBeNull();
  });

  it('finds my own overlapping registrations (after an organiser moved an event)', () => {
    const a = reg({});
    const b = reg({ code: 'REG-CCCCCC', eventId: 'e2', startsAt: ist('2027-03-12', '11:00'), endsAt: ist('2027-03-12', '13:00') });
    const c = reg({ code: 'REG-DDDDDD', eventId: 'e3', startsAt: ist('2027-03-12', '13:00'), endsAt: ist('2027-03-12', '14:00') });
    expect([...selfClashes([a, b, c])].sort()).toEqual(['REG-AAAAAA', 'REG-CCCCCC']);
  });
});
