import { describe, expect, it } from 'vitest';
import { calculateBreakdown, hasExtras } from './fees';

describe('fees (mirror of the server)', () => {
  const DOC = { platformFeeBps: 200, platformFeeFlatPaise: 0, gstBps: 1800, feeBearer: 'PARTICIPANT' as const };
  it('documented example: ₹400 base, 2 % fee, 18 % GST → ₹481.44', () => {
    expect(calculateBreakdown(40_000, true, DOC)).toMatchObject({ platformFeePaise: 800, gstPaise: 7_344, cgstPaise: 3_672, sgstPaise: 3_672, totalPaise: 48_144 });
  });
  it('no platform fee at the desk; organiser-borne fees leave the price as listed', () => {
    expect(calculateBreakdown(10_000, false, DOC)).toMatchObject({ platformFeePaise: 0, totalPaise: 11_800 });
    const absorbed = calculateBreakdown(10_000, true, { ...DOC, feeBearer: 'ORGANIZER' });
    expect([absorbed.totalPaise, hasExtras(absorbed)]).toEqual([10_000, false]);
  });
});
