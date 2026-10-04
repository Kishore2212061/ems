import { useEffect, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { cx } from './ui';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

// ── Skeleton ────────────────────────────────────────────────────────────────
/** Loading placeholder for content (prefer over spinners). Pulses only when motion is allowed. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('rounded-lg bg-surface-2 motion-safe:animate-pulse', className ?? 'h-4 w-full')} />;
}

// ── EmptyState ──────────────────────────────────────────────────────────────
export function EmptyState({ icon: I, title, description, action, compact }: {
  icon?: Icon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx('flex flex-col items-center text-center', compact ? 'px-4 py-8' : 'px-6 py-14')}>
      {I && (
        <div className="grid size-12 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
          <I className="size-6" />
        </div>
      )}
      <p className={cx('font-bold text-fg', I && 'mt-4')}>{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── StatTile ────────────────────────────────────────────────────────────────
const TINTS = {
  brand: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  info: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
  success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
};

export function StatTile({ label, value, icon: I, tint = 'brand', delta, loading }: {
  label: string;
  value: ReactNode;
  icon?: Icon;
  tint?: keyof typeof TINTS;
  /** e.g. +12 % vs last edition */
  delta?: { value: string; positive: boolean };
  loading?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3 shadow-sm min-[360px]:p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5">
      {I && (
        <div className={cx('grid size-10 shrink-0 place-items-center rounded-xl sm:size-12', TINTS[tint])}>
          <I className="size-5 sm:size-6" />
        </div>
      )}
      <div className="min-w-0">
        {loading ? <Skeleton className="h-7 w-12" /> : <div className="text-xl font-bold tabular-nums text-fg sm:text-2xl">{value}</div>}
        <div className="flex flex-wrap items-center gap-x-2 text-xs font-medium leading-snug text-muted sm:text-sm">
          {label}
          {delta && (
            <span className={delta.positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{delta.value}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── DataList ────────────────────────────────────────────────────────────────
export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  /** Shown as the card title on mobile (exactly one column should set this). */
  primary?: boolean;
  /** Omit from the mobile card. */
  hideOnMobile?: boolean;
  align?: 'left' | 'right';
}

/**
 * Responsive list: a real <table> from `sm` up, stacked cards on phones (no horizontal scroll).
 * Handles loading (skeleton rows), empty and row-click states.
 */
/** Tracks a media query (e.g. the `sm` breakpoint) so only the layout on screen is rendered. */
function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function DataList<T>({ columns, rows, rowKey, onRowClick, loading, empty, skeletonRows = 5 }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
  skeletonRows?: number;
}) {
  if (!loading && rows.length === 0) return <>{empty}</>;
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary && !c.hideOnMobile);
  const clickable = !!onRowClick;
  // One layout in the DOM, not two (one hidden by CSS): half the nodes for long admin lists.
  const wide = useMedia('(min-width: 640px)');

  if (!wide) {
    return (
      <ul className="divide-y divide-line">
        {loading
          ? Array.from({ length: skeletonRows }, (_, i) => (
              <li key={i} className="space-y-2 px-5 py-4">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </li>
            ))
          : rows.map((row) => (
              <li
                key={rowKey(row)}
                onClick={clickable ? () => onRowClick(row) : undefined}
                className={cx('px-5 py-4', clickable && 'cursor-pointer active:bg-surface-2')}
              >
                <div className="font-semibold text-fg">{primary.render(row)}</div>
                {rest.length > 0 && (
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    {rest.map((c) => (
                      <div key={c.key} className="contents">
                        <dt className="text-muted">{c.header}</dt>
                        <dd className="min-w-0 truncate text-right text-fg-2">{c.render(row)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
      </ul>
    );
  }

  return (
    <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface">
            <tr className="border-b border-line text-left">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cx('whitespace-nowrap px-6 py-3 text-xs font-semibold uppercase tracking-wider text-subtle', c.align === 'right' && 'text-right')}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading
              ? Array.from({ length: skeletonRows }, (_, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c.key} className="px-6 py-4">
                        <Skeleton className="h-4 w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr
                    key={rowKey(row)}
                    onClick={clickable ? () => onRowClick(row) : undefined}
                    // Instant hover, no colour transition: rows sliding under the pointer while scrolling would animate repaints.
                    className={cx(clickable && 'cursor-pointer hover:bg-surface-2')}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={cx('px-6 py-4 text-fg-2', c.primary && 'font-semibold text-fg', c.align === 'right' && 'text-right', c.className)}>
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
    </div>
  );
}
