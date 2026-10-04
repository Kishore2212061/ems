import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refundApi, type Registration, type RefundView } from '@/lib/ems-api';
import { clearQueryCache } from '@/lib/query';
import { RefundPanel } from './RefundPanel';

const reg = {
  code: 'REG-PAID22',
  status: 'CONFIRMED',
  role: 'LEADER',
  startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  payment: { mode: 'ONLINE', status: 'PAID', amountPaise: 30_000 },
} as Registration;
const refund = (over: Partial<RefundView>): RefundView =>
  ({ id: 'r1', registrationCode: 'REG-PAID22', orderCode: 'ORD-AAAAAAAA', mode: 'ONLINE', amountPaise: 30_000, source: 'REQUEST', reason: 'x', status: 'REQUESTED', failure: null, note: null, batchId: null, createdAt: new Date().toISOString(), decidedAt: null, updatedAt: '', ...over }) as RefundView;

afterEach(() => {
  vi.restoreAllMocks();
  clearQueryCache();
});

describe('RefundPanel', () => {
  it('a paid leader can ask for a refund with a reason', async () => {
    vi.spyOn(refundApi, 'mine').mockResolvedValue({ items: [] });
    const request = vi.spyOn(refundApi, 'request').mockResolvedValue(refund({}));
    const changed = vi.fn();
    render(<RefundPanel reg={reg} onChanged={changed} />);
    await userEvent.click(await screen.findByRole('button', { name: /Request a refund/ }));
    const send = screen.getByRole('button', { name: 'Send request' });
    expect(send.hasAttribute('disabled')).toBe(true);
    await userEvent.type(screen.getByLabelText('Reason'), 'Exam moved to that day');
    await userEvent.click(send);
    await waitFor(() => expect(request).toHaveBeenCalledWith('REG-PAID22', 'Exam moved to that day'));
    expect(changed).toHaveBeenCalled();
  });

  it('tracks progress; cancelled-event refunds skip the approval steps; teammates cannot ask', async () => {
    vi.spyOn(refundApi, 'mine').mockResolvedValue({ items: [refund({ status: 'PROCESSING', source: 'EVENT_CANCELLED' })] });
    const { unmount } = render(<RefundPanel reg={{ ...reg, role: 'MEMBER' } as Registration} onChanged={() => {}} />);
    expect(await screen.findByText(/coming back automatically/)).toBeTruthy();
    expect(screen.queryByText('Approved by finance')).toBeNull();
    expect(screen.getByText('₹300 back to your account')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Request a refund/ })).toBeNull();
    unmount();
  });
});
