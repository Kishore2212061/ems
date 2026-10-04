import { useEffect, useState } from 'react';
import { cx } from './ui';

const cache = new Map<string, { n: number; d: string }>();

/** Modules → one SVG path (crisp at any size, a few KB of DOM at most). */
function toPath(data: boolean[][]) {
  let d = '';
  for (let y = 0; y < data.length; y++) for (let x = 0; x < data.length; x++) if (data[y][x]) d += `M${x} ${y}h1v1h-1z`;
  return { n: data.length, d };
}

/**
 * QR code drawn as SVG on a white panel (dark-on-white in both themes, with the standard 4-module
 * quiet zone) so phone cameras and gate scanners read it reliably. The encoder (~4 KB) loads on
 * first use, never with the page bundle.
 */
export function QrCode({ value, size = 220, label = 'Entry QR code', className }: { value: string; size?: number; label?: string; className?: string }) {
  const [qr, setQr] = useState(() => cache.get(value));
  useEffect(() => {
    const hit = cache.get(value);
    if (hit) return setQr(hit);
    let live = true;
    void import('uqr').then(({ encode }) => {
      const out = toPath(encode(value, { ecc: 'M', border: 4 }).data);
      cache.set(value, out);
      if (live) setQr(out);
    });
    return () => {
      live = false;
    };
  }, [value]);

  return (
    <div className={cx('overflow-hidden rounded-2xl bg-white', className)} style={{ width: size, height: size }}>
      {qr ? (
        <svg viewBox={`0 0 ${qr.n} ${qr.n}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges">
          <path d={qr.d} fill="#111827" />
        </svg>
      ) : (
        <div className="size-full animate-pulse bg-slate-100" aria-hidden />
      )}
    </div>
  );
}
