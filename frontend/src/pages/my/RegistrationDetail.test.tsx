import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { payApi, regApi, type Registration } from '@/lib/ems-api';
import { clearQueryCache } from '@/lib/query';
import { useAuth } from '@/store/auth';
import RegistrationDetail from './RegistrationDetail';

const pending = (over: Partial<Registration> = {}): Registration =>
  ({
    code: 'REG-PAYME2',
    status: 'PAYMENT_PENDING',
    role: 'LEADER',
    eventId: 'e1',
    startsAt: '2027-03-13T03:30:00.000Z',
    endsAt: '2027-03-13T07:00:00.000Z',
    teamName: null,
    members: [{ name: 'Asha', email: 'asha@x.io', leader: true }],
    payment: { mode: 'ONLINE', status: 'PENDING', amountPaise: 35_400, breakdown: { basePaise: 30_000, platformFeePaise: 0, gstPaise: 5_400, cgstPaise: 2_700, sgstPaise: 2_700, igstPaise: 0, totalPaise: 35_400 } },
    holdExpiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
    cancelReason: null,
    cancelledAt: null,
    createdAt: new Date().toISOString(),
    event: { id: 'e1', slug: 'cnc', name: 'CNC Workshop', category: 'WORKSHOP', startsAt: '2027-03-13T03:30:00.000Z', endsAt: null, venue: 'Lab', online: false, status: 'PUBLISHED', departmentCode: 'MECH', bannerUrl: null },
    fest: { slug: 'f', name: 'Fest', status: 'PUBLISHED' },
    ...over,
  }) as Registration;

function mount() {
  const loc = memoryLocation({ path: '/my/registrations/REG-PAYME2' });
  render(
    <Router hook={loc.hook}>
      <Route path="/my/registrations/:code" component={RegistrationDetail} />
    </Router>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  clearQueryCache();
  useAuth.getState().setUser(null);
});

describe('paying for a held seat', () => {
  it('shows the countdown and breakdown; the simulated gateway pays and the page turns confirmed', async () => {
    useAuth.getState().setUser({ id: 'u1', email: 'asha@x.io', fullName: 'Asha', phone: null, college: null, status: 'ACTIVE', emailVerified: true, roles: [], createdAt: '2026-01-01' });
    const get = vi.spyOn(regApi, 'get').mockResolvedValueOnce(pending());
    vi.spyOn(regApi, 'mine').mockResolvedValue({ items: [] });
    vi.spyOn(payApi, 'start').mockResolvedValue({
      orderCode: 'ORD-ABCDEFGH',
      gateway: 'mock',
      keyId: 'rzp_test_simulated',
      gatewayOrderId: 'order_sim_1',
      amountPaise: 35_400,
      currency: 'INR',
      description: 'CNC Workshop',
      holdExpiresAt: '',
      prefill: { name: 'Asha', email: 'asha@x.io', contact: '' },
    });
    vi.spyOn(payApi, 'simulate').mockResolvedValue({ gatewayOrderId: 'order_sim_1', paymentId: 'pay_1', signature: 'a'.repeat(64) });
    const verify = vi.spyOn(payApi, 'verify').mockResolvedValue({ status: 'PAID' } as never);
    mount();

    expect(await screen.findByText('Complete payment to confirm your seat')).toBeTruthy();
    expect(screen.getByText(/^9:\d\d$|^8:5\d$/)).toBeTruthy();
    expect(screen.getByText('CGST')).toBeTruthy();
    get.mockResolvedValue(pending({ status: 'CONFIRMED', holdExpiresAt: null, payment: { ...pending().payment, status: 'PAID' } }));

    await userEvent.click(screen.getByRole('button', { name: 'Pay ₹354' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Pay ₹354 (simulated)' }));
    await waitFor(() => expect(verify).toHaveBeenCalledWith('ORD-ABCDEFGH', { gatewayOrderId: 'order_sim_1', paymentId: 'pay_1', signature: 'a'.repeat(64) }));
    expect(await screen.findByText("You're registered · ₹354 paid")).toBeTruthy();
  });

  it('a confirmed registration shows my QR instead of the code, with a full-screen ticket link', async () => {
    vi.spyOn(regApi, 'get').mockResolvedValueOnce(
      pending({ status: 'CONFIRMED', holdExpiresAt: null, payment: { ...pending().payment, status: 'PAID' }, ticket: { code: 'TCK-QR12-AB', status: 'ACTIVE', registrationCode: 'REG-PAYME2', holder: 'Asha', leader: true, issuedAt: '', usedAt: null, qr: 'EMS1.TCK-QR12-AB.k1.abcdefghijklmnopqrstuv' } }),
    );
    mount();
    expect(await screen.findByRole('img', { name: 'Your entry QR code' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Full-screen ticket/ }).getAttribute('href')).toBe('/my/tickets/TCK-QR12-AB');
    expect(screen.queryByText('Registration code')).toBeNull();
  });

  it("teammates are told the leader pays", async () => {
    vi.spyOn(regApi, 'get').mockResolvedValueOnce(pending({ role: 'MEMBER' }));
    mount();
    expect(await screen.findByText('Your team leader completes the payment.')).toBeTruthy();
    clearQueryCache();
  });
});
