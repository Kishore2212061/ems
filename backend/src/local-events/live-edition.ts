/**
 * Builds the upcoming *live* edition from a past edition's seed file (same shape as
 * seed/techfest-2025.json): the same events, moved to the new fest days at the same IST time,
 * published, registration open now and closing the evening before the fest.
 *
 * The past fest sold day passes, so it has no per-event prices. The live edition uses a simple,
 * explainable mix that exercises every payment path:
 *   - non-technical events ............ free
 *   - workshops ....................... ₹300 per person, paid online
 *   - paper / poster presentations .... ₹200 per team, paid online
 *   - other technical events .......... ₹100 per team, paid at the registration desk
 *   - hackathon (Ideathon) ............ ₹500 per team, online or at the desk
 */

interface SeedEvent {
  slug: string;
  name: string;
  category: 'TECHNICAL' | 'NON_TECHNICAL' | 'WORKSHOP' | 'HACKATHON';
  participation?: 'INDIVIDUAL' | 'TEAM';
  startsAt: string;
  endsAt?: string | null;
  [k: string]: unknown;
}
interface SeedFile {
  fest: { slug: string; name: string; editionYear: number; startsAt: string; endsAt: string; [k: string]: unknown };
  events: SeedEvent[];
  [k: string]: unknown;
}

const DAY = 86_400_000;
const IST_OFFSET = 5.5 * 3_600_000;
/** Calendar day (YYYY-MM-DD) of an instant, in IST. */
const istDay = (iso: string) => new Date(new Date(iso).getTime() + IST_OFFSET).toISOString().slice(0, 10);

/** Tech Fest runs Friday + Saturday in mid-March: the first Friday on or after 12 March. */
export function festFriday(year: number) {
  const d = new Date(Date.UTC(year, 2, 12));
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Next March edition that is still ahead of `now` (and at least ~6 weeks away). */
export function upcomingYear(now = new Date()) {
  const y = now.getUTCFullYear();
  return now < new Date(Date.UTC(y, 1, 1)) ? y : y + 1;
}

export function pricingFor(e: Pick<SeedEvent, 'name' | 'category' | 'participation'>) {
  const per = e.participation === 'TEAM' ? ('TEAM' as const) : ('MEMBER' as const);
  if (e.category === 'NON_TECHNICAL') return { type: 'FREE' as const, amountPaise: 0, per, modes: [] as ('ONLINE' | 'OFFLINE')[] };
  if (e.category === 'WORKSHOP') return { type: 'PAID' as const, amountPaise: 30_000, per: 'MEMBER' as const, modes: ['ONLINE' as const] };
  if (e.category === 'HACKATHON') return { type: 'PAID' as const, amountPaise: 50_000, per, modes: ['ONLINE' as const, 'OFFLINE' as const] };
  if (/\b(paper|poster) presentation\b/i.test(e.name)) return { type: 'PAID' as const, amountPaise: 20_000, per, modes: ['ONLINE' as const] };
  return { type: 'PAID' as const, amountPaise: 10_000, per, modes: ['OFFLINE' as const] };
}

export function buildLiveEdition(past: SeedFile, year: number, firstDay = festFriday(year)) {
  const shiftDays = Math.round((Date.parse(`${firstDay}T00:00:00Z`) - Date.parse(`${istDay(past.fest.startsAt)}T00:00:00Z`)) / DAY);
  // IST has no daylight saving, so adding whole days keeps the wall-clock time.
  const shift = (iso?: string | null) => (iso ? new Date(Date.parse(iso) + shiftDays * DAY).toISOString() : null);
  const yy = String(year).slice(-2);
  const dayBefore = new Date(Date.parse(`${firstDay}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
  const closes = `${dayBefore}T18:00:00+05:30`;

  return {
    replaceImagesFrom: past.replaceImagesFrom as string | undefined,
    fest: {
      ...past.fest,
      slug: `nec-tech-fest-${yy}`,
      name: `NEC Tech Fest '${yy}`,
      editionYear: year,
      startsAt: shift(past.fest.startsAt)!,
      endsAt: shift(past.fest.endsAt)!,
      status: 'PUBLISHED' as const,
    },
    events: past.events.map((e) => ({
      ...e,
      startsAt: shift(e.startsAt)!,
      endsAt: shift(e.endsAt ?? null),
      registrationOpensAt: null,
      registrationClosesAt: closes,
      pricing: pricingFor(e),
    })),
  };
}
