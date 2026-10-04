import { PipeTransform } from '@nestjs/common';
import { Types } from 'mongoose';
import { z } from 'zod';
import { Errors } from './app-exception';

/** Route param → ObjectId. Malformed ids are a 404 (same as missing), never a 500. */
export class ObjectIdPipe implements PipeTransform<string, Types.ObjectId> {
  transform(v: string) {
    if (!Types.ObjectId.isValid(v) || String(new Types.ObjectId(v)) !== v) throw Errors.notFound();
    return new Types.ObjectId(v);
  }
}

export const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Invalid id')
  .transform((v) => new Types.ObjectId(v));

/** Cursor pagination (B5): `_id < cursor`, newest first, limit ≤ 100. */
export const PageQuery = z.object({
  cursor: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof PageQuery>;

export function pageFilter(q: PageQuery) {
  return q.cursor ? { _id: { $lt: new Types.ObjectId(q.cursor) } } : {};
}

export function pageResult<T extends { _id: Types.ObjectId }, R>(rows: T[], limit: number, map: (r: T) => R) {
  const items = rows.slice(0, limit);
  return { items: items.map(map), nextCursor: rows.length > limit ? String(items[items.length - 1]._id) : null };
}

/** "NEC Tech Fest '25" → "nec-tech-fest-25". Long names are cut at a word boundary (≤ 60 chars). */
export function slugify(s: string) {
  const full = s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-|-$/g, '');
  if (full.length <= 60) return full;
  const cut = full.slice(0, 61);
  return cut.slice(0, cut.lastIndexOf('-') > 20 ? cut.lastIndexOf('-') : 60);
}

/** Escape user input for an anchored, index-friendly prefix regex. */
export const prefixRegex = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
