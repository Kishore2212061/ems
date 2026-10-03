import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowLeftIcon } from './icons';
import { cx } from './ui';

// ── Badge ───────────────────────────────────────────────────────────────────
const BADGE_TONES = {
  neutral: 'bg-surface-2 text-fg-2 ring-line',
  brand: 'bg-indigo-50 text-indigo-700 ring-indigo-600/15 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-400/20',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/20',
  warning: 'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/20',
  danger: 'bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-400/20',
  info: 'bg-sky-50 text-sky-700 ring-sky-600/15 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/20',
} as const;
const DOT = { neutral: 'bg-subtle', brand: 'bg-indigo-500', success: 'bg-emerald-500', warning: 'bg-amber-500', danger: 'bg-red-500', info: 'bg-sky-500' };

export type Tone = keyof typeof BADGE_TONES;

export function Badge({ tone = 'neutral', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', BADGE_TONES[tone])}>
      {dot && <span className={cx('size-1.5 rounded-full', DOT[tone])} />}
      {children}
    </span>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────
export function Card({ title, description, actions, children, className, padded = true }: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** false for edge-to-edge content such as DataList. */
  padded?: boolean;
}) {
  const header = title || actions;
  return (
    <section className={cx('rounded-2xl border border-line bg-surface shadow-sm', className)}>
      {header && (
        <div className={cx('flex flex-wrap items-start justify-between gap-3', padded ? 'px-5 pt-5 sm:px-6 sm:pt-6' : 'border-b border-line px-5 py-4 sm:px-6')}>
          <div className="min-w-0">
            {title && <h2 className="text-lg font-bold text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cx(padded && (header ? 'p-5 pt-4 sm:p-6 sm:pt-4' : 'p-5 sm:p-6'))}>{children}</div>
    </section>
  );
}

// ── PageHeader ──────────────────────────────────────────────────────────────
export function PageHeader({ title, description, actions, back }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-6 sm:mb-8">
      {back && (
        <Link href={back.href} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
          <ArrowLeftIcon className="size-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-[28px]">{title}</h1>
          {description && <p className="mt-1.5 max-w-2xl text-[15px] text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────
export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

/** Accessible tablist: arrow keys / Home / End move focus and select (WAI-ARIA pattern). */
export function Tabs<T extends string>({ items, value, onChange, label }: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const select = (i: number) => {
    const n = (i + items.length) % items.length;
    onChange(items[n].value);
    refs.current[n]?.focus();
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (k !== undefined) {
      e.preventDefault();
      select(k);
    }
  };

  return (
    <div role="tablist" aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1 [scrollbar-width:none]">
      {items.map((t, i) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${id}-${t.value}`}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors',
              active ? 'border-indigo-500 text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cx('rounded-full px-1.5 text-xs tabular-nums', active ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300' : 'bg-surface-2 text-muted')}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
