import { cx } from './ui';

/** Area sparkline (SVG, no chart library). Scales to its container's width. */
export function Sparkline({ values, height = 64, label, className }: { values: number[]; height?: number; label: string; className?: string }) {
  if (values.length < 2) values = [0, ...values, ...(values.length ? [] : [0])];
  const max = Math.max(1, ...values);
  const step = 100 / (values.length - 1);
  const pts = values.map((v, i) => [i * step, height - 3 - (v / max) * (height - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" role="img" aria-label={label} className={cx('w-full text-indigo-500', className)} style={{ height }}>
      <path d={`${line} L100 ${height} L0 ${height} Z`} fill="currentColor" opacity={0.12} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Ranked horizontal bars (plain divs: crisp, accessible as a list). */
export function BarList({ items, format = (n) => String(n) }: { items: { label: string; value: number; hint?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-fg" title={i.label}>
              {i.label}
            </span>
            <span className="shrink-0 tabular-nums text-muted">
              {format(i.value)}
              {i.hint && <span className="text-subtle"> · {i.hint}</span>}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
