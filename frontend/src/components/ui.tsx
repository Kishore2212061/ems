import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-9 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="9" className={light ? 'fill-white/15' : 'fill-indigo-600'} />
        <path d="M9 22V10h3.2l7.6 7.4V10H23v12h-3.2L12.2 14.6V22z" className="fill-white" />
      </svg>
      <div className="leading-tight">
        <div className={cx('text-[15px] font-semibold', light ? 'text-white' : 'text-slate-900')}>NEC Events</div>
        <div className={cx('text-xs', light ? 'text-indigo-200' : 'text-slate-500')}>National Engineering College</div>
      </div>
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
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: 'primary' | 'ghost' }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition',
        'focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary' &&
          'w-full bg-indigo-600 text-white shadow-sm shadow-indigo-600/20 hover:bg-indigo-500 focus-visible:ring-indigo-500/30',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-400/20',
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: ReactNode; trailing?: ReactNode };

export function Field({ label, error, hint, trailing, className, ...props }: FieldProps) {
  const id = useId();
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          {label}
        </label>
        {hint}
      </div>
      <div className="relative">
        <input
          id={id}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          {...props}
          className={cx(
            'block h-11 w-full rounded-lg border bg-white px-3.5 text-[15px] text-slate-900 shadow-xs transition placeholder:text-slate-400',
            'focus:outline-none focus:ring-4',
            error
              ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15'
              : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-500/15',
            !!trailing && 'pr-11',
          )}
        />
        {trailing && <div className="absolute inset-y-0 right-0 flex items-center pr-1.5">{trailing}</div>}
      </div>
      {error && (
        <p id={`${id}-err`} className="mt-1.5 text-[13px] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function PasswordField(props: Omit<FieldProps, 'type' | 'trailing'>) {
  const [show, setShow] = useState(false);
  return (
    <Field
      {...props}
      type={show ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="grid size-8 place-items-center rounded-md text-slate-400 hover:text-slate-700"
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {show && <path d="M3 3l18 18" />}
          </svg>
        </button>
      }
    />
  );
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info'; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'rounded-lg border px-3.5 py-2.5 text-sm',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-700',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
        tone === 'info' && 'border-indigo-200 bg-indigo-50 text-indigo-700',
      )}
    >
      {children}
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
