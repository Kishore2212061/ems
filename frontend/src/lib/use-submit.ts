import { useState } from 'react';
import { ApiError } from './api';

/** Wraps an async submit: loading flag, a form-level error, and per-field errors (client or server). */
export function useSubmit() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setLoading(true);
    setError(null);
    setFields({});
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.details?.fields) setFields(e.details.fields);
        else setError(e.message);
      } else setError('Something went wrong. Please try again.');
      return undefined;
    } finally {
      setLoading(false);
    }
  }

  /** Clear one field's error as the user edits it. */
  const clearField = (k: string) =>
    setFields((f) => {
      if (!(k in f)) return f;
      const { [k]: _, ...rest } = f;
      return rest;
    });

  return { loading, error, setError, fields, setFields, clearField, run };
}
