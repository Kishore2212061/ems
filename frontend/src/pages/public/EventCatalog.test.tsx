import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { publicApi, type EventCard, type EventPage, type FestDetail } from '@/lib/ems-api';
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

const page = (items: EventCard[]): EventPage => ({
  items,
  nextCursor: null,
  facets: { total: 3, departments: { CSE: 2, IT: 1 }, categories: { TECHNICAL: 2, WORKSHOP: 1 }, paid: 0 },
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
