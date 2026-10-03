import { useId, useState, type ButtonHTMLAttributes, type ComponentType, type InputHTMLAttributes, type ReactNode, type SVGProps } from 'react';
import { passwordScore } from '@/lib/validate';
import { AlertIcon, CheckIcon, EyeIcon, EyeOffIcon } from './icons';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export function Logo({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cx(
          'grid size-9 shrink-0 place-items-center rounded-xl shadow-lg sm:size-10',
          light ? 'bg-white/10 ring-1 ring-white/20 shadow-black/20' : 'bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-indigo-500/30',
        )}
      >
        <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
          <path d="M8 24V8h3.6l8.8 9.4V8H24v16h-3.6l-8.8-9.4V24z" fill="#fff" />
        </svg>
      </div>
      {!compact && (
        <div className="min-w-0 leading-tight">
          <div className={cx('whitespace-nowrap text-[15px] font-bold tracking-tight', light ? 'text-white' : 'text-fg')}>NEC Events</div>
          <div className={cx('hidden whitespace-nowrap text-xs font-medium sm:block', light ? 'text-white/60' : 'text-muted')}>National Engineering College</div>
        </div>
      )}
    </div>
  );
}

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Button({
  loading,
  variant = 'primary',
  size = 'md',
  block = true,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** md = 48 px (forms), sm = 40 px (toolbars, dialogs, tables). */
  size?: 'md' | 'sm';
  /** Full width (default for forms). Set false for inline buttons. */
  block?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'group inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-semibold transition-all',
        'focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60',
        size === 'md' ? 'h-12 px-5 text-[15px]' : 'h-10 px-4 text-sm',
        block && variant !== 'ghost' && 'w-full',
        variant === 'primary' &&
          'bg-gradient-to-b from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-600/25 ring-1 ring-inset ring-white/10 hover:from-indigo-500 hover:to-indigo-500 hover:shadow-indigo-600/35 active:scale-[.99] focus-visible:ring-indigo-500/30',
        variant === 'secondary' &&
          'border border-line bg-surface text-fg-2 shadow-sm hover:border-line-strong hover:bg-surface-2 focus-visible:ring-slate-400/20',
        variant === 'danger' &&
          'bg-red-600 text-white shadow-lg shadow-red-600/20 hover:bg-red-500 active:scale-[.99] focus-visible:ring-red-500/30',
        variant === 'ghost' && 'h-10 px-3 text-sm text-muted hover:bg-surface-2 hover:text-fg focus-visible:ring-slate-400/20',
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: ReactNode;
  icon?: Icon;
  /** Static text inside the field, e.g. "+91" */
  prefix?: string;
  trailing?: ReactNode;
  footer?: ReactNode;
};

export function Field({ label, error, hint, icon: I, prefix, trailing, footer, className, ...props }: FieldProps) {
  const id = useId();
  return (
    <div className={className}>
      <div className="mb-2 flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-semibold text-fg-2">
          {label}
        </label>
        {hint}
      </div>
      <div
        className={cx(
          'group/f flex h-12 items-center rounded-xl border bg-surface shadow-sm transition-all',
          'focus-within:ring-4',
          error
            ? 'border-red-300 bg-red-50/30 dark:border-red-500/60 dark:bg-red-500/5 focus-within:border-red-400 focus-within:ring-red-500/10'
            : 'border-line hover:border-line-strong focus-within:border-indigo-500 focus-within:ring-indigo-500/10',
        )}
      >
        {I && (
          <I
            className={cx(
              'ml-3.5 size-[18px] shrink-0 transition-colors',
              error ? 'text-red-400' : 'text-subtle group-focus-within/f:text-indigo-500',
            )}
          />
        )}
        {prefix && (
          <span className="ml-3 flex h-6 items-center border-r border-line pr-3 text-[15px] font-medium text-muted">
            {prefix}
          </span>
        )}
        <input
          id={id}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          {...props}
          className="h-full w-full min-w-0 rounded-xl bg-transparent px-3 text-[15px] text-fg outline-none placeholder:text-subtle"
        />
        {trailing && <div className="mr-1.5 flex shrink-0 items-center">{trailing}</div>}
      </div>
      {error ? (
        <p id={`${id}-err`} className="mt-1.5 flex items-center gap-1.5 text-[13px] font-medium text-red-600 dark:text-red-400">
          <AlertIcon className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : (
        footer
      )}
    </div>
  );
}

export function PasswordField({ showStrength, ...props }: Omit<FieldProps, 'type' | 'trailing'> & { showStrength?: boolean }) {
  const [show, setShow] = useState(false);
  const value = String(props.value ?? '');
  return (
    <Field
      {...props}
      type={show ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="grid size-9 place-items-center rounded-lg text-subtle transition hover:bg-surface-2 hover:text-fg-2"
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOffIcon className="size-[18px]" /> : <EyeIcon className="size-[18px]" />}
        </button>
      }
      footer={showStrength ? <StrengthMeter value={value} /> : props.footer}
    />
  );
}

const STRENGTH = [
  ['', ''],
  ['Weak', 'bg-red-500'],
  ['Fair', 'bg-amber-500'],
  ['Good', 'bg-emerald-500'],
  ['Strong', 'bg-emerald-600'],
];

function StrengthMeter({ value }: { value: string }) {
  const score = passwordScore(value);
  const checks = [
    [value.length >= 8, '8+ characters'],
    [/[A-Za-z]/.test(value), 'A letter'],
    [/\d/.test(value), 'A number'],
  ] as const;
  return (
    <div className="mt-2.5 space-y-2.5">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1.5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={cx('h-1.5 flex-1 rounded-full transition-colors', i <= score ? STRENGTH[score][1] : 'bg-line')} />
          ))}
        </div>
        <span className="w-12 text-right text-xs font-semibold text-muted">{STRENGTH[score][0]}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {checks.map(([ok, label]) => (
          <span key={label} className={cx('flex items-center gap-1 text-xs font-medium transition-colors', ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-subtle')}>
            <CheckIcon className="size-3.5" strokeWidth={2.5} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info'; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
        tone === 'info' && 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300',
      )}
    >
      {tone === 'success' ? <CheckIcon className="mt-px size-4 shrink-0" strokeWidth={2.5} /> : <AlertIcon className="mt-px size-4 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

export function FullPageSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center text-indigo-600">
      <Spinner className="size-7" />
    </div>
  );
}
