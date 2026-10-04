import { createHmac, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { encode } from 'uqr';
import { env } from '../config/env';

/**
 * QR payload: `EMS1.<ticket code>.<kid>.<mac>`, about 45 characters, where
 * mac = first 16 bytes of HMAC-SHA256(key[kid], "<code>.<jti>") in base64url.
 *
 * Deliberately not a JWT (~180 chars): the short payload gives a 29–33 module QR that scans fast
 * on a dim phone screen. The scanner looks the ticket up by code anyway (status, used, event), so
 * the token only has to prove it was issued by us and is the latest copy (jti).
 */
const PREFIX = 'EMS1';

/** Current key (kid → secret). Without QR_SIGNING_SECRET a key is derived from the JWT secret. */
function keys(): Map<string, string> {
  const kid = env.QR_SIGNING_KID;
  const secret = env.QR_SIGNING_SECRET ?? createHmac('sha256', env.JWT_ACCESS_SECRET).update(`qr-signing:${kid}`).digest('hex');
  const all = new Map([[kid, secret]]);
  // Older keys stay valid for tickets already issued: "k0:secret,k-1:secret".
  for (const pair of (env.QR_PREVIOUS_KEYS ?? '').split(',').filter(Boolean)) {
    const [k, s] = pair.split(':');
    if (k && s && !all.has(k)) all.set(k, s);
  }
  return all;
}
let cached: Map<string, string> | undefined;
const keyring = () => (cached ??= keys());

export const currentKid = () => env.QR_SIGNING_KID;

const mac = (secret: string, code: string, jti: string) => createHmac('sha256', secret).update(`${code}.${jti}`).digest().subarray(0, 16).toString('base64url');

export function signTicket(code: string, jti: string, kid = currentKid()): string {
  const secret = keyring().get(kid);
  if (!secret) throw new Error(`unknown QR key ${kid}`);
  return `${PREFIX}.${code}.${kid}.${mac(secret, code, jti)}`;
}

/** Parse without trusting: returns the code + kid + mac to check against the stored ticket. */
export function parseTicketToken(token: string): { code: string; kid: string; mac: string } | null {
  const m = /^EMS1\.(TCK-[A-Z0-9]{4}-[A-Z0-9]{2})\.([A-Za-z0-9_-]{1,16})\.([A-Za-z0-9_-]{22})$/.exec(token.trim());
  return m ? { code: m[1], kid: m[2], mac: m[3] } : null;
}

/** Constant-time check of a token against the ticket's jti. */
export function verifyTicketToken(token: string, ticket: { code: string; jti: string }): boolean {
  const p = parseTicketToken(token);
  const secret = p && keyring().get(p.kid);
  if (!p || !secret || p.code !== ticket.code) return false;
  const want = Buffer.from(mac(secret, ticket.code, ticket.jti));
  const got = Buffer.from(p.mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** QR as a crisp PNG for emails (~1–2 KB): modules drawn as one SVG path, rasterised by sharp. */
export async function qrPng(text: string, size = 264): Promise<Buffer> {
  const { data } = encode(text, { ecc: 'M', border: 4 });
  const n = data.length;
  let path = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (data[y][x]) path += `M${x} ${y}h1v1h-1z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#111827"/></svg>`;
  return sharp(Buffer.from(svg)).png({ palette: true, colours: 2, compressionLevel: 9 }).toBuffer();
}
