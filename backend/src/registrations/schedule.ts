/**
 * Time windows for clash checks. A person can't be at two events at once, so a registration
 * blocks every other event whose window overlaps it. Windows are half-open [start, end): an event
 * ending at 11:30 doesn't clash with one starting at 11:30.
 */

/**
 * Many events only publish a start time. They're assumed to run this long: the fest's slots
 * (9:30, 11:30, 1:15, 3:15) are about two hours apart, so back-to-back events stay bookable.
 */
export const DEFAULT_EVENT_MINUTES = 120;

export function effectiveEnd(start: Date, end: Date | null | undefined): Date {
  return end && end > start ? end : new Date(start.getTime() + DEFAULT_EVENT_MINUTES * 60_000);
}

export const overlaps = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) => a.start < b.end && b.start < a.end;

const IST_OFFSET_MS = 5.5 * 3_600_000;

/** "2027-03-12" → the IST calendar day as [00:00, next 00:00) instants. IST has no daylight saving. */
export function istDayRange(day: string) {
  const start = new Date(Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}
