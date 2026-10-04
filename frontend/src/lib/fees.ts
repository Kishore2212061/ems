/** Mirror of backend payments/fees.ts: integer paise, GST on base + platform fee, fee only online. */
export interface FeeSettings {
  platformFeeBps: number;
  platformFeeFlatPaise: number;
  gstBps: number;
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

export function calculateBreakdown(basePaise: number, online: boolean, s: FeeSettings): Breakdown {
  if (basePaise <= 0) return { basePaise: 0, platformFeePaise: 0, gstPaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0 };
  const platformFeePaise = online ? Math.round((basePaise * s.platformFeeBps) / 10_000) + s.platformFeeFlatPaise : 0;
  const gstPaise = Math.round(((basePaise + platformFeePaise) * s.gstBps) / 10_000);
  const cgstPaise = Math.round(gstPaise / 2);
  return {
    basePaise,
    platformFeePaise,
    gstPaise,
    cgstPaise,
    sgstPaise: gstPaise - cgstPaise,
    igstPaise: 0,
    totalPaise: s.feeBearer === 'PARTICIPANT' ? basePaise + platformFeePaise + gstPaise : basePaise,
  };
}

/** Anything on top of the listed price? (fees absorbed by the organiser don't count). */
export const hasExtras = (b: Breakdown) => b.totalPaise !== b.basePaise;
