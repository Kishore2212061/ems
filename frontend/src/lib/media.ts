/**
 * Image variants. A poster is stored once (`bannerUrl`); the small card variant is derived:
 * - our own posters (/media/… shipped with the site, /api/v1/media/… uploaded or imported) have a
 *   640×400 `-card.webp` sibling,
 * - Cloudinary URLs get an on-the-fly transform,
 * - anything else is used as-is (the API converts outside links on save, so this is rare).
 */
const OWN = /^\/(media|api\/v1\/media)\/[a-z0-9][a-z0-9/_-]*\.webp$/i;

export function cardImage(url: string | null | undefined) {
  if (!url) return null;
  if (OWN.test(url) && !url.endsWith('-card.webp')) return url.replace(/\.webp$/, '-card.webp');
  const cloud = url.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/);
  if (cloud) return `${cloud[1]}c_fill,g_auto,w_640,h_400,f_auto,q_auto/${cloud[2]}`;
  return url;
}

/** Same rule as the API: an https URL, or one of our own image paths. */
export const isImageUrl = (v: string) => /^https:\/\/\S+$/.test(v) || /^\/(media|api\/v1\/media)\/[a-z0-9][a-z0-9/_-]*\.(webp|png|jpe?g|avif)$/i.test(v);

/** True for links to other sites (the server copies + resizes them when the form is saved). */
export const isExternalImage = (v: string) => /^https:\/\//.test(v);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
