import { describe, expect, it } from 'vitest';
import type { EventDetail } from '@/lib/ems-api';
import { changes, toForm, toInput } from './EventStudio';

// Shaped like an imported Tech Fest '25 event: multi-line rule, nulls, faculty without a phone.
const seeded: EventDetail = {
  id: 'e1',
  slug: 'on-spot-sketch',
  name: 'On Spot Sketch',
  tagline: null,
  category: 'NON_TECHNICAL',
  department: { id: 'd1', code: 'CSE', name: 'Computer Science' },
  organizer: null,
  startsAt: '2025-03-15T09:45:00.000Z',
  endsAt: null,
  venue: 'Seminar Hall',
  online: false,
  participation: 'INDIVIDUAL',
  teamMin: 1,
  teamMax: 1,
  pricing: { type: 'FREE', amountPaise: 0, per: 'TEAM', modes: [] },
  seatsTotal: null,
  seatsLeft: null,
  registrationClosesAt: null,
  status: 'COMPLETED',
  tags: ['Talent'],
  description: 'Show your talent.',
  rules: ['Only individual participants', 'Activity Options: \n- Sketching\n- Singing'],
  statusReason: null,
  registrationOpensAt: null,
  coordinators: [
    { name: 'Ms. R. Srimathi', phone: null, role: 'FACULTY' },
    { name: 'Student One', phone: '9876543210', role: 'STUDENT' },
  ],
  resourcePerson: null,
  bannerUrl: 'https://example.com/poster.webp',
  publishedAt: null,
  version: 3,
};

describe('event studio form', () => {
  it('a paid event that takes both payment types round-trips without looking changed', () => {
    const paid: EventDetail = { ...seeded, pricing: { type: 'PAID', amountPaise: 50000, per: 'TEAM', modes: ['OFFLINE', 'ONLINE'] } };
    const form = toForm(paid, '');
    expect(form).toMatchObject({ priceType: 'PAID', price: '500', payOnline: true, payDesk: true });
    expect(changes(toInput(form), toInput(toForm(paid, '')))).toEqual({});
  });

  it('an untouched form saves nothing, even for messy imported data', () => {
    const before = toInput(toForm(seeded, ''));
    expect(changes(before, toInput(toForm(seeded, '')))).toEqual({});
  });

  it('a save sends only what changed', () => {
    const form = toForm(seeded, '');
    const before = toInput(form);
    expect(changes(before, toInput({ ...form, tagline: 'Talent showcase' }))).toEqual({ tagline: 'Talent showcase' });
    expect(changes(before, toInput({ ...form, priceType: 'PAID', price: '150' }))).toEqual({ pricing: { type: 'PAID', amountPaise: 15000, per: 'MEMBER', modes: ['ONLINE'] } });
    expect(toInput({ ...form, priceType: 'PAID', price: '150', payOnline: false, payDesk: true }).pricing?.modes).toEqual(['OFFLINE']);
  });

  it('switching to a team event sends sizes; individual events always send 1–1', () => {
    const form = toForm(seeded, '');
    const team = toInput({ ...form, participation: 'TEAM', teamMin: '2', teamMax: '4' });
    expect(team).toMatchObject({ participation: 'TEAM', teamMin: 2, teamMax: 4 });
    expect(toInput({ ...form, teamMin: '3', teamMax: '5' })).toMatchObject({ participation: 'INDIVIDUAL', teamMin: 1, teamMax: 1 });
  });

  it('a new event starts in the given department, as a free individual event', () => {
    expect(toInput(toForm(undefined, 'd9'))).toMatchObject({ departmentId: 'd9', participation: 'INDIVIDUAL', pricing: { type: 'FREE', amountPaise: 0 }, seatsTotal: null, rules: [], coordinators: [] });
  });
});
