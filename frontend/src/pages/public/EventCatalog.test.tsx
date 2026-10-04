import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { publicApi, regApi, type EventCard, type EventPage, type FestDetail, type Registration } from '@/lib/ems-api';
import { clearQueryCache } from '@/lib/query';
import { useAuth } from '@/store/auth';
import { EventCatalog } from './EventCatalog';

let n = 0;
const fest = (): FestDetail => ({
  id: 'f1',
  slug: `fest-${++n}`, // fresh slug per test: the feed cache is keyed by fest
  name: 'Tech Fest',
  editionYear: 2027,
  type: 'TECHNICAL',
  tagline: null,
  startsAt: null,
  endsAt: null,
  venue: null,
  bannerUrl: null,
  status: 'PUBLISHED',
  suspendReason: null,
  departments: [
    { id: 'd1', code: 'CSE', name: 'Computer Science' },
    { id: 'd2', code: 'IT', name: 'Information Technology' },
  ],
  description: null,
  contactEmail: null,
  publishedAt: null,
});

const card = (name: string, over: Partial<EventCard> = {}): EventCard => ({
  id: name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  name,
  tagline: null,
  category: 'TECHNICAL',
  department: { id: 'd1', code: 'CSE', name: 'Computer Science' },
  organizer: null,
  startsAt: '2027-03-14T08:00:00.000Z',
  endsAt: null,
  venue: 'Lab 1',
  online: false,
  participation: 'TEAM',
  teamMin: 2,
  teamMax: 2,
  pricing: { type: 'FREE', amountPaise: 0, per: 'TEAM', modes: [] },
  seatsTotal: null,
  seatsLeft: null,
  registrationClosesAt: null,
  status: 'PUBLISHED',
  bannerUrl: null,
  ...over,
});

const page = (items: EventCard[], days: { day: string; n: number }[] = []): EventPage => ({
  items,
  nextCursor: null,
  facets: { total: 3, departments: { CSE: 2, IT: 1 }, categories: { TECHNICAL: 2, WORKSHOP: 1 }, paid: 0, days },
});

afterEach(() => {
  vi.restoreAllMocks();
  clearQueryCache();
  useAuth.getState().setUser(null);
});

function mount(f = fest(), search = '') {
  const loc = memoryLocation({ path: `/events/${f.slug}${search}`, record: true });
  render(
    <Router hook={loc.hook} searchHook={loc.searchHook}>
      <EventCatalog fest={f} />
    </Router>,
  );
  return loc;
}

describe('EventCatalog', () => {
  it('shows events with chip counts; chips filter through the URL', async () => {
    const spy = vi.spyOn(publicApi, 'events').mockResolvedValue(page([card('Blind Coding'), card('Code Relay')]));
    const loc = mount();
    expect(await screen.findByText('Blind Coding')).toBeTruthy();
    expect(spy).toHaveBeenLastCalledWith(expect.any(String), { dept: undefined, category: undefined, free: undefined, q: undefined, cursor: undefined });

    await userEvent.click(screen.getByRole('button', { name: /Workshop/ }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ category: 'WORKSHOP' })));
    expect(loc.history.at(-1)).toContain('cat=WORKSHOP');

    await userEvent.click(screen.getByRole('button', { name: /^IT/ }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ category: 'WORKSHOP', dept: 'IT' })));
  });

  it('reads filters from a shared link and debounces search', async () => {
    const spy = vi.spyOn(publicApi, 'events').mockResolvedValue(page([card('Blind Coding')]));
    mount(fest(), '?dept=CSE');
    await screen.findByText('Blind Coding');
    expect(spy).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ dept: 'CSE' }));
    const calls = spy.mock.calls.length;

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search events' }), 'robo');
    expect(spy.mock.calls.length).toBe(calls); // nothing yet: still typing
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ dept: 'CSE', q: 'robo' })), { timeout: 1500 });
  });

  it('a slow answer for an old filter never replaces the current results', async () => {
    let releaseOld!: (p: EventPage) => void;
    const spy = vi.spyOn(publicApi, 'events');
    spy.mockImplementationOnce(() => new Promise((r) => (releaseOld = r))); // "All" — slow
    spy.mockResolvedValue(page([card('Workshop Result', { category: 'WORKSHOP' })])); // "Workshop" — fast
    mount();

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    // Chips render before the first answer arrives (no counts yet).
    await userEvent.click(screen.getByRole('button', { name: /Workshop/ }));
    expect(await screen.findByText('Workshop Result')).toBeTruthy();

    await act(async () => releaseOld(page([card('Stale Result')])));
    expect(screen.queryByText('Stale Result')).toBeNull();
    expect(screen.getByText('Workshop Result')).toBeTruthy();
  });

  it('says so when nothing matches and offers to clear filters', async () => {
    vi.spyOn(publicApi, 'events').mockResolvedValue(page([]));
    const loc = mount(fest(), '?cat=WORKSHOP');
    expect(await screen.findByText('No events match')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(loc.history.at(-1)).not.toContain('cat=');
  });
});

describe('EventCatalog as a schedule', () => {
  const twoDays = (): FestDetail => ({ ...fest(), startsAt: '2027-03-12T09:00:00+05:30', endsAt: '2027-03-13T17:00:00+05:30' });
  const DAYS = [
    { day: '2027-03-12', n: 3 },
    { day: '2027-03-13', n: 1 },
  ];
  const ist = (d: string, t: string) => new Date(`${d}T${t}:00+05:30`).toISOString();

  it("opens on the fest's first day (no extra request), groups by start time, and switches days", async () => {
    const spy = vi.spyOn(publicApi, 'events').mockImplementation(async (_f, q) =>
      q.day === '2027-03-13'
        ? page([card('Robo Race', { startsAt: ist('2027-03-13', '10:00') })], DAYS)
        : page([card('Blind Coding', { startsAt: ist('2027-03-12', '09:30') }), card('Paper Talk', { startsAt: ist('2027-03-12', '09:30') }), card('Quiz', { startsAt: ist('2027-03-12', '11:30') })], DAYS),
    );
    const loc = mount(twoDays());
    expect(await screen.findByText('Blind Coding')).toBeTruthy();
    expect(spy.mock.calls[0][1]).toMatchObject({ day: '2027-03-12' }); // the very first request is already for day 1

    const slot930 = screen.getByRole('region', { name: 'Fri, 12 Mar, 9:30 AM' });
    expect(slot930.textContent).toContain('2 events');
    expect(slot930.textContent).toContain('Paper Talk');
    expect(screen.getByRole('region', { name: 'Fri, 12 Mar, 11:30 AM' }).textContent).toContain('Quiz');

    const day2 = screen.getByRole('tab', { name: /Day 2/ });
    expect(day2.textContent).toContain('Sat, 13 Mar');
    await userEvent.click(day2);
    expect(await screen.findByText('Robo Race')).toBeTruthy();
    expect(loc.history.at(-1)).toContain('day=2027-03-13');
    expect(screen.getByRole('tab', { name: /Day 2/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('a search covers every day', async () => {
    const spy = vi.spyOn(publicApi, 'events').mockResolvedValue(page([card('Blind Coding', { startsAt: ist('2027-03-12', '09:30') })], DAYS));
    mount(twoDays());
    await screen.findByText('Blind Coding');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search events' }), 'robo');
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ q: 'robo', day: undefined })), { timeout: 1500 });
  });

  it('marks what I registered for, and what clashes with it', async () => {
    useAuth.getState().setUser({ id: 'u1', email: 'me@x.io', fullName: 'Me', phone: null, college: null, status: 'ACTIVE', emailVerified: true, roles: [], createdAt: '2026-01-01' });
    const reg = {
      code: 'REG-ABCDEF',
      status: 'CONFIRMED',
      role: 'LEADER',
      eventId: 'Blind Coding',
      startsAt: ist('2027-03-12', '10:00'),
      endsAt: ist('2027-03-12', '12:00'),
      payment: { mode: 'NONE', status: 'NOT_REQUIRED', amountPaise: 0 },
      holdExpiresAt: null,
      event: { name: 'Blind Coding', status: 'PUBLISHED' },
    } as unknown as Registration;
    vi.spyOn(regApi, 'mine').mockResolvedValue({ items: [reg] });
    vi.spyOn(publicApi, 'events').mockResolvedValue(
      page(
        [
          card('Blind Coding', { startsAt: ist('2027-03-12', '10:00'), endsAt: ist('2027-03-12', '12:00') }),
          card('Code Relay', { startsAt: ist('2027-03-12', '11:00') }),
          card('Quiz', { startsAt: ist('2027-03-12', '12:00') }), // starts as Blind Coding ends: fine
        ],
        DAYS,
      ),
    );
    mount(twoDays());
    await screen.findByText('Registered');
    const tile = (name: string) => screen.getByText(name).closest('a')!;
    expect(tile('Blind Coding').textContent).toContain('Registered');
    expect(tile('Code Relay').textContent).toContain('Clashes with Blind Coding');
    expect(tile('Quiz').textContent).not.toMatch(/Registered|Clashes/);
    expect(screen.getByRole('region', { name: 'Fri, 12 Mar, 11:00 AM' }).textContent).toContain("You're at Blind Coding");
  });
});
