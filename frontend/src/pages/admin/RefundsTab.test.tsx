import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminRefundApi, type RefundBatchView, type RefundView } from '@/lib/ems-api';
import { RefundsTab } from './RefundsTab';

const failed: RefundView = {
  id: 'r1',
  registrationCode: 'REG-TRD2JJ',
  orderCode: 'ORD-QKPBT5BV',
  mode: 'ONLINE',
  amountPaise: 30_000,
  source: 'EVENT_CANCELLED',
  reason: 'Event cancelled: Venue flooded',
  status: 'FAILED',
  failure: 'The payment is not captured yet',
  note: null,
  batchId: 'b1',
  createdAt: new Date().toISOString(),
  decidedAt: null,
  updatedAt: new Date().toISOString(),
  eventName: 'Blind Coding',
};
const batch: RefundBatchView = { id: 'b1', eventName: 'Blind Coding', reason: 'Venue flooded', status: 'RUNNING', total: 1, succeeded: 0, failed: 1, manual: 0, pausedReason: null, createdAt: failed.createdAt };

beforeEach(() => {
  vi.spyOn(adminRefundApi, 'list').mockResolvedValue({ items: [failed], nextCursor: null, counts: { FAILED: 1 } });
  vi.spyOn(adminRefundApi, 'batches').mockResolvedValue({ items: [batch] });
});
afterEach(() => vi.restoreAllMocks());

describe('RefundsTab', () => {
  it('a failed refund can be tried again from its dialog', async () => {
    const retry = vi.spyOn(adminRefundApi, 'retry').mockResolvedValue({ ...failed, status: 'QUEUED', failure: null });
    render(<RefundsTab festId="f1" />);
    fireEvent.click((await screen.findAllByText('REG-TRD2JJ'))[0]);
    expect(screen.getByText('Failed: The payment is not captured yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await vi.waitFor(() => expect(retry).toHaveBeenCalledWith('r1'));
  });

  it('a running batch with failures offers "Retry failed"', async () => {
    const resume = vi.spyOn(adminRefundApi, 'resume').mockResolvedValue({ requeued: 1 });
    render(<RefundsTab festId="f1" />);
    expect(await screen.findByText('Some refunds failed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed' }));
    await vi.waitFor(() => expect(resume).toHaveBeenCalledWith('b1'));
  });
});
