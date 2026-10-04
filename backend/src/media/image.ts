import { lookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import sharp from 'sharp';

// One image at a time, no libvips cache: bounded memory on a small container.
sharp.cache(false);
sharp.concurrency(1);

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Decompression-bomb guard: a 4419×6250 poster is 27.6 MP; 60 MP leaves headroom. */
export const MAX_IMAGE_PIXELS = 60_000_000;

/** A problem with the image the user gave us (shown to them as a field error). */
export class ImageError extends Error {}

/**
 * Two web-sized variants of a poster:
 * - full: ≤ 720 px wide (≤ 1600 tall), for the "View poster" dialog
 * - card: 640×400; portrait posters are cut around the title line (~30 % down), others centre-cropped
 * EXIF orientation is applied and all metadata (GPS etc.) is dropped.
 */
export async function makeVariants(input: Buffer) {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  } catch (e: any) {
    throw new ImageError(/pixel limit/i.test(e?.message) ? 'That image is too large (over 60 megapixels)' : 'That file is not an image we can read');
  }
  if (!meta.width || !meta.height || !['jpeg', 'png', 'webp', 'avif', 'gif', 'heif', 'tiff'].includes(meta.format ?? '')) {
    throw new ImageError('Use a JPG, PNG or WebP image');
  }

  const full = await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS })
    .rotate()
    .resize({ width: 720, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 64, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h } = full.info;
  const windowH = Math.round((w * 10) / 16);
  const card =
    h > windowH
      ? await sharp(full.data)
          .extract({ left: 0, top: Math.max(0, Math.min(h - windowH, Math.round(h * 0.3 - windowH / 2))), width: w, height: windowH })
          .resize(640, 400)
          .webp({ quality: 62, effort: 4 })
          .toBuffer()
      : await sharp(full.data).resize(640, 400, { fit: 'cover' }).webp({ quality: 62, effort: 4 }).toBuffer();

  return { full: full.data, card, width: w, height: h };
}

// ── fetching a poster from a link, safely ───────────────────────────────────

// The server must never be tricked into calling itself or the private network (SSRF):
// loopback, private, link-local (cloud metadata 169.254.169.254), CGNAT, multicast, reserved.
const blocked = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const) {
  blocked.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) blocked.addSubnet(net, bits, 'ipv6');

export function isPublicAddress(ip: string) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (mapped) return !blocked.check(mapped, 'ipv4');
  const family = isIP(ip);
  return family !== 0 && !blocked.check(ip, family === 6 ? 'ipv6' : 'ipv4');
}

/**
 * DNS lookup for the socket itself: the address we validate is the address we connect to, so a
 * hostname can't resolve to a public IP for the check and a private one for the connection.
 */
function safeLookup(hostname: string, options: LookupOptions, cb: (err: Error | null, address: string | LookupAddress[], family?: number) => void) {
  lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err, '');
    if (!addrs.length || !addrs.every((a) => isPublicAddress(a.address))) return cb(new ImageError('That address is not allowed'), '');
    if (options.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

/** GET an image over https: public addresses only, ≤ 3 redirects, 10 s, ≤ 10 MB, image/* only. */
export function fetchImage(url: string, redirects = 3): Promise<Buffer> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return Promise.reject(new ImageError('Enter a valid link'));
  }
  if (u.protocol !== 'https:') return Promise.reject(new ImageError('Use an https:// link'));
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host)) return Promise.reject(new ImageError('That address is not allowed'));

  return new Promise((resolve, reject) => {
    const fail = (e: unknown) => reject(e instanceof ImageError ? e : new ImageError("Couldn't load an image from that link"));
    const req = request(u, { lookup: safeLookup as never, timeout: 10_000, headers: { accept: 'image/*', 'user-agent': 'NEC-Events/1.0 (poster import)' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return fail(new ImageError('That link redirects too many times'));
        return fetchImage(new URL(res.headers.location, u).toString(), redirects - 1).then(resolve, reject);
      }
      if (status !== 200) {
        res.resume();
        return fail(new ImageError(`That link answered ${status}, not an image`));
      }
      if (!/^image\//i.test(String(res.headers['content-type'] ?? ''))) {
        res.resume();
        return fail(new ImageError('That link is not an image'));
      }
      if (Number(res.headers['content-length'] ?? 0) > MAX_IMAGE_BYTES) {
        res.destroy();
        return fail(new ImageError('Images must be under 10 MB'));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_IMAGE_BYTES) {
          res.destroy();
          fail(new ImageError('Images must be under 10 MB'));
        } else chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', fail);
    });
    req.on('timeout', () => req.destroy(new ImageError('That link took too long to answer')));
    req.on('error', fail);
    req.end();
  });
}
