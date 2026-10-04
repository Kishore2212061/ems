import { describe, expect, it } from 'vitest';
import { calculateBreakdown, NO_FEES, type FeeSettings } from './fees';

const DOC: FeeSettings = { platformFeeBps: 200, platformFeeFlatPaise: 0, gstBps: 1800, feeBearer: 'PARTICIPANT' };

describe('fee engine', () => {
  it("matches the documented example (team of 4 × ₹100, 2 % fee, 18 % GST)", () => {
    expect(calculateBreakdown({ basePaise: 40_000, online: true, settings: DOC })).toEqual({
      basePaise: 40_000,
      platformFeePaise: 800,
      gstPaise: 7_344,
      cgstPaise: 3_672,
      sgstPaise: 3_672,
      igstPaise: 0,
      totalPaise: 48_144,
    });
  });

  it('defaults: no fees → the participant pays exactly the listed price', () => {
    expect(calculateBreakdown({ basePaise: 30_000, online: true, settings: NO_FEES }).totalPaise).toBe(30_000);
    expect(calculateBreakdown({ basePaise: 0, online: true, settings: DOC }).totalPaise).toBe(0);
  });

  it('desk payments carry no platform fee; interstate is IGST; organiser can absorb fees', () => {
    expect(calculateBreakdown({ basePaise: 10_000, online: false, settings: DOC })).toMatchObject({ platformFeePaise: 0, gstPaise: 1_800, totalPaise: 11_800 });
    expect(calculateBreakdown({ basePaise: 10_000, online: true, interstate: true, settings: DOC })).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 1_836 });
    expect(calculateBreakdown({ basePaise: 10_000, online: true, settings: { ...DOC, feeBearer: 'ORGANIZER' } }).totalPaise).toBe(10_000);
  });

  it('property: 10 000 random inputs → integer parts that add up, never negative', () => {
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31), seed % n);
    for (let i = 0; i < 10_000; i++) {
      const settings: FeeSettings = { platformFeeBps: rnd(1_000), platformFeeFlatPaise: rnd(5_000), gstBps: rnd(2_800), feeBearer: rnd(4) ? 'PARTICIPANT' : 'ORGANIZER' };
      const b = calculateBreakdown({ basePaise: rnd(10_000_000), online: !!rnd(2), interstate: !rnd(3), settings });
      for (const v of Object.values(b)) expect(Number.isInteger(v) && v >= 0).toBe(true);
      expect(b.cgstPaise + b.sgstPaise + b.igstPaise).toBe(b.gstPaise);
      expect(b.totalPaise).toBe(settings.feeBearer === 'PARTICIPANT' ? b.basePaise + b.platformFeePaise + b.gstPaise : b.basePaise);
    }
  });

  it('rejects non-integer or negative amounts', () => {
    expect(() => calculateBreakdown({ basePaise: 10.5, online: true, settings: DOC })).toThrow(RangeError);
    expect(() => calculateBreakdown({ basePaise: -1, online: true, settings: DOC })).toThrow(RangeError);
  });
});
