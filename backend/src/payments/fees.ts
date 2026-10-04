/**
 * Fee engine: pure integer-paise maths (no floats, no I/O), shared by quotes, registrations and
 * orders. GST applies to base + platform fee and is split CGST/SGST (intrastate) or IGST.
 * The platform fee only applies to online payments (it covers gateway charges).
 */
export interface FeeSettings {
  platformFeeBps: number; // 200 = 2 %
  platformFeeFlatPaise: number;
  gstBps: number; // 1800 = 18 %
  /** PARTICIPANT pays fees + GST on top; ORGANIZER absorbs them (participant pays the base). */
  feeBearer: 'PARTICIPANT' | 'ORGANIZER';
}

export interface Breakdown {
  basePaise: number;
  platformFeePaise: number;
  gstPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

export const NO_FEES: FeeSettings = { platformFeeBps: 0, platformFeeFlatPaise: 0, gstBps: 0, feeBearer: 'PARTICIPANT' };

export function calculateBreakdown(input: { basePaise: number; online: boolean; interstate?: boolean; settings: FeeSettings }): Breakdown {
  const base = input.basePaise;
  if (!Number.isSafeInteger(base) || base < 0) throw new RangeError('basePaise must be a non-negative integer');
  if (base === 0) return { basePaise: 0, platformFeePaise: 0, gstPaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0 };
  const s = input.settings;
  const platformFeePaise = input.online ? Math.round((base * s.platformFeeBps) / 10_000) + s.platformFeeFlatPaise : 0;
  const gstPaise = Math.round(((base + platformFeePaise) * s.gstBps) / 10_000);
  const cgstPaise = input.interstate ? 0 : Math.round(gstPaise / 2);
  const sgstPaise = input.interstate ? 0 : gstPaise - cgstPaise;
  const igstPaise = input.interstate ? gstPaise : 0;
  const totalPaise = s.feeBearer === 'PARTICIPANT' ? base + platformFeePaise + gstPaise : base;
  return { basePaise: base, platformFeePaise, gstPaise, cgstPaise, sgstPaise, igstPaise, totalPaise };
}
