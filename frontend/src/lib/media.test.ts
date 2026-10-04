import { describe, expect, it } from 'vitest';
import { cardImage, isImageUrl } from './media';

describe('cardImage', () => {
  it('uses the small sibling of a self-hosted poster', () => {
    expect(cardImage('/media/tf25/blind-coding.webp')).toBe('/media/tf25/blind-coding-card.webp');
  });
  it('uploaded / imported posters have a card sibling too', () => {
    expect(cardImage('/api/v1/media/p0123456789abcdef01234567.webp')).toBe('/api/v1/media/p0123456789abcdef01234567-card.webp');
  });
  it('asks Cloudinary for a 640×400 crop', () => {
    expect(cardImage('https://res.cloudinary.com/nec/image/upload/v1/posters/x.jpg')).toBe('https://res.cloudinary.com/nec/image/upload/c_fill,g_auto,w_640,h_400,f_auto,q_auto/v1/posters/x.jpg');
  });
  it('leaves other URLs alone; nothing for no poster', () => {
    expect(cardImage('https://example.com/p.png')).toBe('https://example.com/p.png');
    expect(cardImage(null)).toBeNull();
  });
});

describe('isImageUrl', () => {
  it('accepts https and /media files only (same rule as the API)', () => {
    expect(isImageUrl('https://example.com/p.png')).toBe(true);
    expect(isImageUrl('/media/tf25/blind-coding.webp')).toBe(true);
    expect(isImageUrl('/api/v1/media/p0123456789abcdef01234567.webp')).toBe(true);
    for (const bad of ['http://example.com/p.png', '/media/../x.webp', '/etc/passwd', 'javascript:alert(1)', '//evil.com/a.png']) expect(isImageUrl(bad), bad).toBe(false);
  });
});
