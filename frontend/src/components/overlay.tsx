import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, cx } from './ui';

/**
 * Modal built on the native <dialog>: focus trap, Esc to close, top-layer stacking and inert
 * background come from the browser for free (0 KB). Bottom sheet on phones, centred on desktop.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault(); // Esc → let React state drive closing
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()} // backdrop click
      className={cx(
        'm-0 mt-auto w-full max-w-none rounded-t-3xl border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/50',
        'sm:m-auto sm:rounded-2xl',
        { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' }[size],
      )}
    >
      {open && (
        <div className="max-h-[85dvh] overflow-y-auto">
          <div className="px-5 pt-5 sm:px-6 sm:pt-6">
            <h2 id={titleId} className="text-lg font-bold">
              {title}
            </h2>
            {description && <div className="mt-1.5 text-sm leading-relaxed text-muted">{description}</div>}
          </div>
          {children && <div className="px-5 pt-4 sm:px-6">{children}</div>}
          <div className="flex flex-col-reverse gap-2 px-5 pb-5 pt-5 sm:flex-row sm:justify-end sm:px-6 sm:pb-6">{footer}</div>
        </div>
      )}
    </dialog>
  );
}

/**
 * Confirmation for consequential actions. `requireText` adds type-to-confirm (e.g. the event
 * name) for destructive, irreversible operations such as cancelling an event.
 */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', tone = 'primary', requireText }: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  requireText?: string;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    if (open) {
      setTyped('');
      setError(null);
    }
  }, [open]);

  const ready = !requireText || typed.trim() === requireText;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError((e as Error).message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      size="sm"
      title={title}
      description={message}
      footer={
        <>
          <Button variant="secondary" size="sm" block={false} onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone} size="sm" block={false} onClick={confirm} loading={busy} disabled={!ready}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {(requireText || error) && (
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          {requireText && (
            <div>
              <label htmlFor={inputId} className="mb-2 block text-sm text-muted">
                Type <span className="font-semibold text-fg">{requireText}</span> to confirm
              </label>
              <input
                id={inputId}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-[15px] text-fg outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
              />
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
