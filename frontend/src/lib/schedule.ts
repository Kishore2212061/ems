import type { Registration } from './ems-api';

/**
 * Day / time-slot grouping and clash detection. Mirrors backend registrations/schedule.ts:
 * a person can't be at two events whose windows overlap; windows are half-open, so an event
 * ending at 11:30 doesn't clash with one starting at 11:30.
 */

/** Events that only publish a start time are assumed to run this long (as on the server). */
export const DEFAULT_EVENT_MINUTES = 120;

export interface Window {
  start: number;
  end: number;
}

export function windowOf(startsAt: string, endsAt: string | null): Window {
  const start = Date.parse(startsAt);
  const end = endsAt ? Date.parse(endsAt) : NaN;
  return { start, end: end > start ? end : start + DEFAULT_EVENT_MINUTES * 60_000 };
}

export const overlaps = (a: Window, b: Window) => a.start < b.end && b.start < a.end;

const IST_OFFSET = 5.5 * 3_600_000;
/** Calendar day in college time: "2027-03-12". */
export const istDay = (iso: string | number) => new Date((typeof iso === 'number' ? iso : Date.parse(iso)) + IST_OFFSET).toISOString().slice(0, 10);

/** Every calendar day from start to end (college time), e.g. a fest's two days. Capped at 14. */
export function daysBetween(startIso: string, endIso: string | null): string[] {
  const out: string[] = [];
  let t = Date.parse(`${istDay(startIso)}T00:00:00Z`);
  const last = Date.parse(`${istDay(endIso ?? startIso)}T00:00:00Z`);
  while (t <= last && out.length < 14) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}

export interface Slot<T> {
  /** Start time shared by every item in the slot. */
  at: string;
  items: T[];
}
export interface ScheduleDay<T> {
  day: string;
  slots: Slot<T>[];
}

/** Items → days → start-time slots, in time order (search results arrive by relevance, so sort first). */
export function groupSchedule<T extends { startsAt: string | null }>(items: T[]): ScheduleDay<T>[] {
  const timed = items.filter((i) => i.startsAt).sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!));
  const days: ScheduleDay<T>[] = [];
  for (const it of timed) {
    const d = istDay(it.startsAt!);
    let day = days[days.length - 1];
    if (day?.day !== d) days.push((day = { day: d, slots: [] }));
    let slot = day.slots[day.slots.length - 1];
    if (!slot || Date.parse(slot.at) !== Date.parse(it.startsAt!)) day.slots.push((slot = { at: it.startsAt!, items: [] }));
    slot.items.push(it);
  }
  return days;
}

/** Holding a seat right now (an online hold that ran out no longer counts, even before the server sweeps it). */
export const isActive = (r: Registration, now = Date.now()) =>
  r.event?.status !== 'CANCELLED' && (r.status === 'CONFIRMED' || (r.status === 'PAYMENT_PENDING' && (!r.holdExpiresAt || Date.parse(r.holdExpiresAt) > now)));

export interface MySchedule {
  active: Registration[];
  byEvent: Map<string, Registration>;
}

export function scheduleOf(regs: Registration[], now = Date.now()): MySchedule {
  const active = regs.filter((r) => isActive(r, now));
  return { active, byEvent: new Map(active.map((r) => [r.eventId, r])) };
}

export type Mark = { kind: 'registered' | 'pending' | 'clash'; reg: Registration };

/** How an event relates to my schedule: I'm in it, or it overlaps something I'm in. */
export function markFor(e: { id: string; startsAt: string | null; endsAt: string | null }, s: MySchedule): Mark | null {
  const mine = s.byEvent.get(e.id);
  if (mine) return { kind: mine.status === 'PAYMENT_PENDING' ? 'pending' : 'registered', reg: mine };
  if (!e.startsAt) return null;
  const w = windowOf(e.startsAt, e.endsAt);
  const hit = s.active.find((r) => overlaps(w, { start: Date.parse(r.startsAt), end: Date.parse(r.endsAt) }));
  return hit ? { kind: 'clash', reg: hit } : null;
}

/** Codes of my registrations that overlap another of mine (only possible if an organiser moved an event). */
export function selfClashes(active: Registration[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (overlaps({ start: Date.parse(a.startsAt), end: Date.parse(a.endsAt) }, { start: Date.parse(b.startsAt), end: Date.parse(b.endsAt) })) {
        out.add(a.code);
        out.add(b.code);
      }
    }
  }
  return out;
}
