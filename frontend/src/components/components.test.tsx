import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DataList, type Column } from './data';
import { Tabs } from './layout';
import { ConfirmDialog } from './overlay';
import { toast, Toaster } from './toast';

describe('ConfirmDialog', () => {
  function Harness({ onConfirm, requireText }: { onConfirm: () => Promise<void>; requireText?: string }) {
    const [open, setOpen] = useState(true);
    return (
      <ConfirmDialog open={open} onClose={() => setOpen(false)} onConfirm={onConfirm} title="Cancel event?" message="Refunds will be issued." confirmLabel="Cancel event" tone="danger" requireText={requireText} />
    );
  }

  it('type-to-confirm keeps the action disabled until the exact text is typed', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<Harness onConfirm={onConfirm} requireText="Blind Coding" />);
    const btn = screen.getByRole('button', { name: 'Cancel event' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/to confirm/i), 'Blind Codin');
    expect(btn.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/to confirm/i), 'g');
    expect(btn.disabled).toBe(false);
    await userEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('shows the error and stays open when the action fails', async () => {
    render(<Harness onConfirm={() => Promise.reject(new Error('Refund batch already running'))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel event' }));
    expect(await screen.findByText('Refund batch already running')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel event' })).toBeTruthy();
  });
});

describe('Tabs', () => {
  it('arrow keys move selection (WAI-ARIA tabs pattern)', async () => {
    function H() {
      const [v, setV] = useState<'a' | 'b' | 'c'>('a');
      return <Tabs label="Filter" value={v} onChange={setV} items={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }]} />;
    }
    render(<H />);
    const tab = (n: string) => screen.getByRole('tab', { name: n });
    expect(tab('A').getAttribute('aria-selected')).toBe('true');
    tab('A').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('B').getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}'); // wraps around
    expect(tab('C').getAttribute('aria-selected')).toBe('true');
    expect(tab('A').tabIndex).toBe(-1); // roving tabindex
  });
});

describe('DataList', () => {
  const cols: Column<{ id: string; name: string }>[] = [{ key: 'n', header: 'Name', primary: true, render: (r) => r.name }];

  it('renders the empty state when there are no rows', () => {
    render(<DataList columns={cols} rows={[]} rowKey={(r) => r.id} empty={<p>Nothing here</p>} />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });

  it('renders rows (mobile cards + desktop table) and handles clicks', async () => {
    const onRowClick = vi.fn();
    render(<DataList columns={cols} rows={[{ id: '1', name: 'Tech Fest' }]} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    const cells = screen.getAllByText('Tech Fest');
    expect(cells).toHaveLength(2); // card + table cell; CSS decides which is visible
    await userEvent.click(cells[1]);
    expect(onRowClick).toHaveBeenCalledWith({ id: '1', name: 'Tech Fest' });
  });
});

describe('toast', () => {
  it('announces and auto-dismisses', async () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => toast.success('Event saved'));
    expect(screen.getByRole('status').textContent).toContain('Event saved');
    act(() => vi.advanceTimersByTime(4100));
    expect(screen.queryByText('Event saved')).toBeNull();
    vi.useRealTimers();
  });
});
