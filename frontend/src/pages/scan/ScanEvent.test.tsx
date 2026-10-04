import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { adminPayApi, checkinApi, type GateSummary } from '@/lib/ems-api';
import { clearQueryCache } from '@/lib/query';
import ScanEvent from './ScanEvent';

const summary: GateSummary = {
  event: { id: 'e1', name: 'Blind Coding', startsAt: null, endsAt: null, venue: 'Lab 1' },
  checkedIn: 3,
  expected: 10,
  paymentDue: 1,
  shift: { scans: 4, admitted: 3, cashPaise: 0, cashCount: 0 },
};
const holder = { name: 'Asha Raman', ticketCode: 'TCK-AB12-CD', registrationCode: 'REG-ABCDEF', leader: true };

function mount() {
  const loc = memoryLocation({ path: '/scan/e1' });
  render(
    <Router hook={loc.hook}>
      <Route path="/scan/:eventId" component={ScanEvent} />
    </Router>,
  );
}

beforeEach(() => {
  vi.spyOn(checkinApi, 'summary').mockResolvedValue(summary);
});
afterEach(() => {
  vi.restoreAllMocks();
  clearQueryCache();
});

describe('gate scanner', () => {
  it('a typed ticket code admits: full-screen green flash with the name, then ready again', async () => {
    const scan = vi.spyOn(checkinApi, 'scan').mockResolvedValue({ result: 'OK', message: 'Welcome, Asha!', holder });
    mount();
    expect(await screen.findByText('Blind Coding')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    await userEvent.type(screen.getByPlaceholderText('Ticket code, email or phone'), 'tck-ab12-cd{Enter}');
    const flash = await screen.findByRole('alertdialog', { name: 'Admitted' });
    expect(flash.textContent).toContain('Asha Raman');
    expect(scan).toHaveBeenCalledWith('e1', expect.objectContaining({ code: 'TCK-AB12-CD', deviceId: expect.stringMatching(/^dev-/) }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), { timeout: 2500 });
  });

  it('payment due: "₹100 received" records the desk payment, then the same ticket is admitted', async () => {
    const scan = vi
      .spyOn(checkinApi, 'scan')
      .mockResolvedValueOnce({ result: 'PAYMENT_DUE', message: 'Collect ₹100 for the team, then scan again', holder, amountPaise: 10_000 })
      .mockResolvedValueOnce({ result: 'OK', message: 'Welcome, Asha!', holder });
    const collect = vi.spyOn(adminPayApi, 'collect').mockResolvedValue({} as never);
    mount();
    await userEvent.type(await screen.findByPlaceholderText('Ticket code, email or phone'), 'TCK-AB12-CD{Enter}');
    await screen.findByRole('alertdialog', { name: 'Payment due' });
    await userEvent.click(screen.getByRole('button', { name: '₹100 received: admit' }));
    expect(collect).toHaveBeenCalledWith('REG-ABCDEF', 10_000);
    expect(await screen.findByRole('alertdialog', { name: 'Admitted' })).toBeTruthy();
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('refusals stay on screen until "Next"; lookups list people with an Admit button', async () => {
    vi.spyOn(checkinApi, 'scan').mockResolvedValue({ result: 'ALREADY_USED', message: 'Already checked in at Fri, 12 Mar, 9:40 AM', holder });
    vi.spyOn(checkinApi, 'lookup').mockResolvedValue({ items: [{ code: 'TCK-AB12-CD', holder: 'Asha Raman', status: 'ACTIVE', registrationCode: 'REG-ABCDEF', leader: true, usedAt: null }] });
    mount();
    await userEvent.type(await screen.findByPlaceholderText('Ticket code, email or phone'), 'asha@nec.edu{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Admit' }));
    const flash = await screen.findByRole('alertdialog', { name: 'Already checked in' });
    expect(flash.textContent).toContain('9:40 AM');
    await new Promise((r) => setTimeout(r, 1700));
    expect(screen.getByRole('alertdialog')).toBeTruthy(); // not auto-dismissed
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
