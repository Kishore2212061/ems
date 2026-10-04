import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { ApiError } from '@/lib/api';
import { regApi, type EventDetail, type Registration } from '@/lib/ems-api';
import { useAuth } from '@/store/auth';
import RegisterSheet from './RegisterSheet';

const event = (over: Partial<EventDetail> = {}): EventDetail =>
  ({
    id: 'e1',
    slug: 'code-relay',
    name: 'Code Relay',
    category: 'TECHNICAL',
    participation: 'TEAM',
    teamMin: 2,
    teamMax: 3,
    pricing: { type: 'FREE', amountPaise: 0, per: 'TEAM', modes: [] },
    startsAt: '2027-03-12T04:30:00.000Z',
    endsAt: null,
    venue: 'Lab 1',
    ...over,
  }) as EventDetail;

const done = (over: Partial<Registration> = {}) =>
  ({ code: 'REG-K7M2QP', status: 'CONFIRMED', payment: { mode: 'NONE', status: 'NOT_REQUIRED', amountPaise: 0 }, members: [{}, {}], ...over }) as Registration;

function mount(e: EventDetail, onRegistered = vi.fn()) {
  const loc = memoryLocation({ path: '/events/f/code-relay' });
  render(
    <Router hook={loc.hook}>
      <RegisterSheet event={e} open onClose={() => {}} onRegistered={onRegistered} />
    </Router>,
  );
  return onRegistered;
}

beforeEach(() => {
  useAuth.getState().setUser({ id: 'u1', email: 'lead@nec.edu', fullName: 'Team Lead', phone: null, college: null, status: 'ACTIVE', emailVerified: true, roles: [], createdAt: '2026-01-01' });
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuth.getState().setUser(null);
});

describe('RegisterSheet', () => {
  it('starts with the minimum teammates; add and remove stay within the team size', async () => {
    mount(event());
    expect(screen.getByText('Team Lead')).toBeTruthy();
    expect(screen.getAllByText(/^Teammate \d$/)).toHaveLength(1); // team of 2 = you + 1
    expect(screen.queryByRole('button', { name: /Remove teammate/ })).toBeNull(); // can't go below 2

    await userEvent.click(screen.getByRole('button', { name: 'Add teammate' }));
    expect(screen.getAllByText(/^Teammate \d$/)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Add teammate' })).toBeNull(); // 3 = max
    await userEvent.click(screen.getByRole('button', { name: 'Remove teammate 2' }));
    expect(screen.getAllByText(/^Teammate \d$/)).toHaveLength(1);
  });

  it("checks the team before sending: names, emails, and that a teammate isn't you", async () => {
    const create = vi.spyOn(regApi, 'create');
    mount(event());
    await userEvent.type(screen.getByLabelText('Email'), 'LEAD@nec.edu');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm registration' }));
    expect(screen.getByText('Enter their name')).toBeTruthy();
    expect(screen.getByText("That's you: you're the team leader")).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it('sends the team once per key (a retry reuses it) and shows the code when confirmed', async () => {
    const create = vi
      .spyOn(regApi, 'create')
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.'))
      .mockResolvedValueOnce(done());
    mount(event());
    await userEvent.type(screen.getByLabelText('Team name'), 'Byte Busters');
    await userEvent.type(screen.getByLabelText('Name'), 'Asha');
    await userEvent.type(screen.getByLabelText('Email'), 'asha@nec.edu');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm registration' }));
    expect(await screen.findByText('Cannot reach the server. Check your connection.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm registration' }));

    expect(await screen.findByText("You're registered!")).toBeTruthy();
    expect(screen.getByText('REG-K7M2QP')).toBeTruthy();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0]).toEqual({ eventId: 'e1', teamName: 'Byte Busters', teammates: [{ name: 'Asha', email: 'asha@nec.edu' }], paymentMode: undefined });
    expect(create.mock.calls[1][1]).toBe(create.mock.calls[0][1]); // same Idempotency-Key
  });

  it("puts the server's answer on the right teammate (e.g. busy at that time)", async () => {
    vi.spyOn(regApi, 'create').mockRejectedValue(
      new ApiError(409, 'TIME_CLASH', 'asha@nec.edu is registered for another event at this time', { email: 'asha@nec.edu', self: false, fields: { 'teammates.0.email': 'Busy with another event at this time' } }),
    );
    mount(event());
    await userEvent.type(screen.getByLabelText('Name'), 'Asha');
    await userEvent.type(screen.getByLabelText('Email'), 'asha@nec.edu');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm registration' }));
    expect(await screen.findByText('Busy with another event at this time')).toBeTruthy();
  });

  it('paid with both options: you choose, the total follows team size, online goes to checkout', async () => {
    const pending = done({ status: 'PAYMENT_PENDING', payment: { mode: 'ONLINE', status: 'PENDING', amountPaise: 20_000 } });
    const create = vi.spyOn(regApi, 'create').mockResolvedValue(pending);
    const onRegistered = mount(event({ participation: 'INDIVIDUAL', teamMin: 1, teamMax: 1, pricing: { type: 'PAID', amountPaise: 20_000, per: 'MEMBER', modes: ['ONLINE', 'OFFLINE'] } }));
    expect(screen.getByText('₹200')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm registration' }));
    expect(screen.getByText('Choose how you will pay')).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: /Pay online now/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith(pending));
    expect(create.mock.calls[0][0]).toMatchObject({ paymentMode: 'ONLINE', teammates: [], teamName: null });
  });
});
