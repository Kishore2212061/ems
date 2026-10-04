import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportApi, type FestSummary, type Overview } from '@/lib/ems-api';
import { clearQueryCache } from '@/lib/query';
import { Analytics } from './Analytics';

class FakeEventSource {
  static last: FakeEventSource | null = null;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners[type] ?? []) fn({ data: JSON.stringify(data) } as MessageEvent);
  }
  close() {}
}

const fest = { id: 'f1', name: "NEC Tech Fest '27", status: 'PUBLISHED' } as FestSummary;
const overview: Overview = {
  fest: { id: 'f1', name: "NEC Tech Fest '27", slug: 'nec-tech-fest-27', status: 'PUBLISHED' },
  totals: { registrations: 120, people: 300, cancellations: 4, checkins: 30, revenuePaise: 5_000_000, refundsPaise: 0, netPaise: 5_000_000 },
  daily: [
    { day: '2026-10-01', registrations: 40, people: 100, checkins: 0, revenuePaise: 0 },
    { day: '2026-10-02', registrations: 80, people: 200, checkins: 30, revenuePaise: 0 },
  ],
  departments: [{ code: 'CSE', registrations: 70, people: 180, checkins: 20 }],
  topEvents: [{ id: 'e1', name: 'Blind Coding', registrations: 30, people: 60, checkins: 10 }],
  previous: { fest: { id: 'f0', name: "NEC Tech Fest '25", editionYear: 2025 }, totals: { registrations: 100, people: 200, cancellations: 0, checkins: 0, revenuePaise: 4_000_000, refundsPaise: 0, netPaise: 4_000_000 } },
};

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.spyOn(reportApi, 'overview').mockResolvedValue(overview);
  vi.spyOn(reportApi, 'colleges').mockResolvedValue({ items: [{ college: 'National Engineering College', registrations: 50, people: 95 }] });
  vi.spyOn(reportApi, 'livePass').mockResolvedValue({ pass: 'p.f1.x.y', expiresIn: 3600 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearQueryCache();
});

describe('Analytics', () => {
  it('shows KPIs with the change since last edition, charts and lists', async () => {
    render(<Analytics fests={[fest]} />);
    expect(await screen.findByText('120')).toBeTruthy();
    expect(screen.getByText('+20% vs last edition')).toBeTruthy(); // 120 vs 100
    expect(screen.getByText('₹50,000')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Registrations per day' })).toBeTruthy();
    expect(screen.getByText('Blind Coding')).toBeTruthy();
    expect(screen.getByText('National Engineering College')).toBeTruthy();
  });

  it('live ticks add to the totals', async () => {
    render(<Analytics fests={[fest]} />);
    await screen.findByText('120');
    await vi.waitFor(() => expect(FakeEventSource.last?.url).toBe('/api/v1/live/fests/f1?pass=p.f1.x.y'));
    act(() => {
      FakeEventSource.last!.emit('hello', {});
      FakeEventSource.last!.emit('tick', { registrations: 2, people: 5 });
    });
    expect(screen.getByText('122')).toBeTruthy();
    expect(screen.getByText('Live')).toBeTruthy();
  });
});
