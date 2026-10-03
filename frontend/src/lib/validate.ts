// Client-side mirror of the backend zod rules — instant feedback, no wasted round trip.
// The backend still validates everything; these only improve UX.

type Rule = (v: string) => string | undefined;

export const rules = {
  fullName: (v: string) => (v.trim().length < 2 ? 'Enter your full name' : v.trim().length > 80 ? 'Name is too long' : undefined),
  email: (v: string) =>
    !v.trim() ? 'Enter your email' : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? 'Enter a valid email address' : undefined,
  phone: (v: string) =>
    !v ? 'Enter your mobile number' : !/^[6-9]\d{9}$/.test(v) ? 'Enter a valid 10-digit mobile number' : undefined,
  college: (v: string) => (v.trim().length < 2 ? 'Enter your college name' : undefined),
  password: (v: string) =>
    v.length < 8
      ? 'Use at least 8 characters'
      : !/[A-Za-z]/.test(v)
        ? 'Include at least one letter'
        : !/\d/.test(v)
          ? 'Include at least one number'
          : undefined,
  required: (label: string) => (v: string) => (v ? undefined : `Enter your ${label}`),
} satisfies Record<string, Rule | ((...a: string[]) => Rule)>;

export function validate<T extends Record<string, string>>(values: T, schema: Partial<Record<keyof T, Rule>>) {
  const errors: Partial<Record<keyof T, string>> = {};
  for (const k in schema) {
    const msg = schema[k]!(values[k] ?? '');
    if (msg) errors[k] = msg;
  }
  return errors;
}

/** Digits only, max 10 — the field physically can't hold an invalid length. */
export const sanitizePhone = (v: string) => v.replace(/\D/g, '').replace(/^(91|0)(?=\d{10})/, '').slice(0, 10);

/** 0–4 score for the strength meter. */
export function passwordScore(v: string) {
  if (!v) return 0;
  let s = 0;
  if (v.length >= 8) s++;
  if (v.length >= 12) s++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
  if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) s++;
  return Math.max(1, Math.min(4, s));
}
