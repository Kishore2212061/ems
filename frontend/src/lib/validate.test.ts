import { describe, expect, it } from 'vitest';
import { passwordScore, rules, sanitizePhone, validate } from './validate';

describe('sanitizePhone', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['+91 98765 43210', '9876543210'], // pasted with country code + spaces
    ['919876543210', '9876543210'],
    ['09876543210', '9876543210'], // trunk prefix
    ['98765-432-10', '9876543210'],
    ['987654321099', '9876543210'], // never more than 10 digits
    ['98abc76', '9876'],
  ])('%s → %s', (input, out) => expect(sanitizePhone(input)).toBe(out));
});

describe('rules (mirror the backend)', () => {
  it('phone: 10 digits starting 6-9', () => {
    expect(rules.phone('9876543210')).toBeUndefined();
    expect(rules.phone('5876543210')).toBe('Enter a valid 10-digit mobile number');
    expect(rules.phone('98765')).toBe('Enter a valid 10-digit mobile number');
    expect(rules.phone('')).toBe('Enter your mobile number');
  });

  it('password: 8+ chars with a letter and a number', () => {
    expect(rules.password('short1')).toBe('Use at least 8 characters');
    expect(rules.password('12345678')).toBe('Include at least one letter');
    expect(rules.password('abcdefgh')).toBe('Include at least one number');
    expect(rules.password('abcdefg1')).toBeUndefined();
  });

  it('email', () => {
    expect(rules.email('a@b.co')).toBeUndefined();
    expect(rules.email('nope')).toBe('Enter a valid email address');
    expect(rules.email('  ')).toBe('Enter your email');
  });

  it('validate() collects only failing fields', () => {
    expect(validate({ email: 'x', phone: '9876543210' }, { email: rules.email, phone: rules.phone })).toEqual({
      email: 'Enter a valid email address',
    });
  });
});

describe('passwordScore', () => {
  it('rises with length and variety', () => {
    expect(passwordScore('')).toBe(0);
    expect(passwordScore('abc')).toBe(1);
    expect(passwordScore('abcdefg1')).toBe(1);
    expect(passwordScore('Abcdefg1')).toBe(2);
    expect(passwordScore('Abcdefghijk1!')).toBe(4);
  });
});
