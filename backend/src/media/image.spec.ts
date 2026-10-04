import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { fetchImage, ImageError, isPublicAddress, makeVariants } from './image';

const png = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#4f46e5' } }).png().toBuffer();

describe('makeVariants', () => {
  it('portrait poster → 720 px full + 640×400 card, as WebP without metadata', async () => {
    const v = await makeVariants(await png(1587, 2245));
    expect(v.width).toBe(720);
    const full = await sharp(v.full).metadata();
    const card = await sharp(v.card).metadata();
    expect([full.format, full.width]).toEqual(['webp', 720]);
    expect([card.format, card.width, card.height]).toEqual(['webp', 640, 400]);
    expect(full.exif).toBeUndefined();
  });

  it('never enlarges a small image; wide images are centre-cropped for the card', async () => {
    const v = await makeVariants(await png(300, 120));
    expect(v.width).toBe(300);
    expect((await sharp(v.card).metadata()).height).toBe(400);
  });

  it('refuses files that are not images', async () => {
    await expect(makeVariants(Buffer.from('<html>not an image</html>'))).rejects.toBeInstanceOf(ImageError);
  });
});

describe('SSRF guard', () => {
  it('only public addresses are reachable', () => {
    for (const ip of ['10.0.0.1', '172.20.1.1', '192.168.1.10', '127.0.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.1.2.3']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ['8.8.8.8', '76.76.21.21', '2606:4700:4700::1111']) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it('refuses private targets before connecting, and non-https links', async () => {
    await expect(fetchImage('https://127.0.0.1/x.png')).rejects.toThrow('not allowed');
    await expect(fetchImage('https://169.254.169.254/latest/meta-data')).rejects.toThrow('not allowed');
    await expect(fetchImage('https://[::1]/x.png')).rejects.toThrow('not allowed');
    await expect(fetchImage('https://localhost/x.png')).rejects.toThrow('not allowed'); // resolves to loopback
    await expect(fetchImage('http://example.com/x.png')).rejects.toThrow('https');
    await expect(fetchImage('not a url')).rejects.toThrow('valid link');
  });
});
