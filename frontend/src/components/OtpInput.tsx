import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

/** N separate boxes: auto-advance, backspace-to-previous, paste-the-whole-code, SMS/email autofill. */
export function OtpInput({
  length = 6,
  value,
  onChange,
  invalid,
  disabled,
}: {
  length?: number;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const focus = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();

  const setAt = (i: number, digits: string) => {
    const chars = value.padEnd(length, ' ').split('');
    for (let k = 0; k < digits.length && i + k < length; k++) chars[i + k] = digits[k];
    onChange(chars.join('').replace(/\s+$/, '').replace(/ /g, ''));
    focus(i + digits.length);
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !value[i]) {
      e.preventDefault();
      onChange(value.slice(0, Math.max(0, i - 1)));
      focus(i - 1);
    } else if (e.key === 'ArrowLeft') focus(i - 1);
    else if (e.key === 'ArrowRight') focus(i + 1);
  };

  const onPaste = (e: ClipboardEvent) => {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (digits) {
      e.preventDefault();
      onChange(digits);
      focus(digits.length);
    }
  };

  return (
    <div className="flex justify-between gap-2" onPaste={onPaste}>
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={value[i] ?? ''}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, '');
            if (d) setAt(i, d);
            else onChange(value.slice(0, i) + value.slice(i + 1));
          }}
          onKeyDown={(e) => onKey(i, e)}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          disabled={disabled}
          autoFocus={i === 0}
          aria-label={`Digit ${i + 1}`}
          className={[
            'h-14 w-full min-w-0 rounded-lg border bg-white text-center text-2xl font-semibold text-slate-900 shadow-xs transition',
            'focus:outline-none focus:ring-4 disabled:opacity-60',
            invalid ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15' : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-500/15',
          ].join(' ')}
        />
      ))}
    </div>
  );
}
