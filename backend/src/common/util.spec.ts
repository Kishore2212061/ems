import { describe, expect, it } from 'vitest';
import { slugify } from './util';

describe('slugify', () => {
  it('makes readable addresses', () => {
    expect(slugify("NEC Tech Fest '25")).toBe('nec-tech-fest-25');
    expect(slugify('  War of UI/UX  ')).toBe('war-of-uiux');
    expect(slugify('Café Débat')).toBe('cafe-debat');
  });

  it('cuts long names at a word boundary, never mid-word', () => {
    const s = slugify('An Introduction to Industrial Geometric Dimensioning and Tolerancing');
    expect(s).toBe('an-introduction-to-industrial-geometric-dimensioning-and');
    expect(s.length).toBeLessThanOrEqual(60);
    expect(slugify('x'.repeat(80))).toHaveLength(60); // one huge word: hard cut
  });

  it('returns empty for names with no latin letters (callers fall back)', () => {
    expect(slugify('தமிழ்')).toBe('');
  });
});
