import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLiveEdition, festFriday, upcomingYear } from './live-edition';
import { SeedFileDto } from './local-events.dto';

const past = JSON.parse(readFileSync(resolve(__dirname, '../../seed/techfest-2025.json'), 'utf8'));

describe('live edition builder', () => {
  const live = buildLiveEdition(past, 2027);

  it('is a valid seed file for a published fest on the Friday + Saturday of mid-March', () => {
    expect(SeedFileDto.safeParse(live).success).toBe(true);
    expect(festFriday(2027)).toBe('2027-03-12');
    expect(live.fest).toMatchObject({ slug: 'nec-tech-fest-27', name: "NEC Tech Fest '27", editionYear: 2027, status: 'PUBLISHED' });
  });

  it('keeps every event on its day and IST clock time, with registration closing the evening before', () => {
    past.events.forEach((src: any, i: number) => {
      const e = live.events[i];
      expect(Date.parse(e.startsAt) - Date.parse(src.startsAt)).toBe(728 * 86_400_000); // 14 Mar 2025 → 12 Mar 2027
      expect(e.registrationClosesAt).toBe('2027-03-11T18:00:00+05:30');
      expect(new Date(e.registrationClosesAt) < new Date(e.startsAt)).toBe(true);
    });
  });

  it('mixes free, pay-online and pay-at-desk entry by a simple rule', () => {
    const kind = (e: (typeof live.events)[number]) => (e.pricing.type === 'FREE' ? 'free' : e.pricing.modes.join('+'));
    const mix = live.events.reduce<Record<string, number>>((m, e) => ((m[kind(e)] = (m[kind(e)] ?? 0) + 1), m), {});
    expect(mix).toEqual({ free: 34, ONLINE: 41, OFFLINE: 47, 'ONLINE+OFFLINE': 1 });
    expect(live.events.find((e) => e.slug === 'paper-presentation-it')!.pricing).toEqual({ type: 'PAID', amountPaise: 20000, per: 'TEAM', modes: ['ONLINE'] });
  });

  it('targets the next March that is still ahead', () => {
    expect(upcomingYear(new Date('2026-10-03'))).toBe(2027);
    expect(upcomingYear(new Date('2027-01-10'))).toBe(2027);
    expect(upcomingYear(new Date('2027-03-20'))).toBe(2028);
  });
});
