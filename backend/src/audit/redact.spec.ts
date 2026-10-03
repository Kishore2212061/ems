import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { redact } from './redact';

describe('redact', () => {
  it('replaces secrets at any depth', () => {
    const out = redact({
      email: 'a@b.c',
      password_hash: '$argon2id$...',
      nested: { refreshToken: 'abc', otp: '123456', keep: 1 },
      list: [{ apiSecret: 'x', name: 'n' }],
    });
    expect(out).toEqual({
      email: 'a@b.c',
      password_hash: '[redacted]',
      nested: { refreshToken: '[redacted]', otp: '[redacted]', keep: 1 },
      list: [{ apiSecret: '[redacted]', name: 'n' }],
    });
  });

  it('keeps ObjectIds readable and dates intact', () => {
    const id = new Types.ObjectId();
    const at = new Date();
    expect(redact({ id, at })).toEqual({ id: id.toHexString(), at });
  });

  it('caps depth and array length so one log row cannot explode', () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    expect(JSON.stringify(redact(deep))).toContain('[truncated]');
    expect((redact({ xs: Array.from({ length: 500 }, (_, i) => i) }) as any).xs).toHaveLength(50);
  });
});
