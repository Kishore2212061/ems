import { create } from 'zustand';
import { AlertIcon, CheckIcon } from './icons';
import { cx } from './ui';

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

const DURATION_MS = 4000;
let seq = 0;

const useToasts = create<{ items: ToastItem[] }>(() => ({ items: [] }));

function push(tone: ToastTone, message: string) {
  const id = ++seq;
  useToasts.setState((s) => ({ items: [...s.items.slice(-2), { id, tone, message }] })); // max 3 on screen
  setTimeout(() => dismiss(id), tone === 'error' ? DURATION_MS * 1.5 : DURATION_MS);
}
function dismiss(id: number) {
  useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) }));
}

/** Fire-and-forget notifications: toast.success('Saved'), toast.error('Could not save'). */
export const toast = {
  success: (m: string) => push('success', m),
  error: (m: string) => push('error', m),
  info: (m: string) => push('info', m),
};

const STYLE: Record<ToastTone, string> = {
  success: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-red-600 dark:text-red-400',
  info: 'text-indigo-600 dark:text-indigo-400',
};

/**
 * Mount once at the app root. Desktop: centred over the empty middle of the header bar, so it never
 * covers page actions or sticky save buttons. Phones: just under the header (clear of the bottom tab
 * bar). Announced politely to screen readers.
 */
export function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-16 z-50 flex flex-col items-center gap-2 p-4 sm:top-3 sm:p-0"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm font-medium text-fg shadow-lg motion-safe:animate-[toast-in_.18s_ease-out]"
        >
          <span className={cx('mt-px shrink-0', STYLE[t.tone])}>
            {t.tone === 'success' ? <CheckIcon className="size-4" strokeWidth={2.5} /> : <AlertIcon className="size-4" />}
          </span>
          <span className="flex-1">{t.message}</span>
          <button type="button" onClick={() => dismiss(t.id)} className="-m-1 rounded-md p-1 text-subtle hover:text-fg" aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
