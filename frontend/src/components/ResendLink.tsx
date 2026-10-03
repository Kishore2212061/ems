/** "Didn't get it? Resend code" with cooldown display. */
export function ResendLink({ left, loading, onResend }: { left: number; loading: boolean; onResend: () => void }) {
  return (
    <p className="text-center text-sm text-muted">
      Didn't get the code?{' '}
      {left > 0 ? (
        <span className="font-semibold tabular-nums text-subtle">Resend in {left}s</span>
      ) : (
        <button
          type="button"
          onClick={onResend}
          disabled={loading}
          className="font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 disabled:opacity-50"
        >
          {loading ? 'Sending…' : 'Resend code'}
        </button>
      )}
    </p>
  );
}
