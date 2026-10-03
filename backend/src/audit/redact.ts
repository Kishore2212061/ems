const SECRET_KEY = /pass(word)?|token|hash|secret|otp|code_hash|pepper|signature/i;
const MAX_DEPTH = 5;

/**
 * Deep-copies a value for the audit log with secrets replaced by "[redacted]".
 * Keeps ObjectIds/Dates readable and caps depth so huge documents can't bloat a log row.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return value;
  if ('_bsontype' in (value as object)) return String(value); // ObjectId → hex string
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}
