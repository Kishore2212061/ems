import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Model, Schema } from 'mongoose';
import { Errors } from '../common/app-exception';
import { fetchImage, ImageError, makeVariants } from './image';

/**
 * Posters live in the database as small, ready-to-serve WebP files (~20 KB card + ~60 KB full).
 * Content-addressed (hash of the original bytes): the same poster uploaded twice is stored once,
 * and the URLs never change, so browsers can cache them forever.
 */
export interface MediaAsset {
  _id: string; // "p<hash>.webp" | "p<hash>-card.webp"
  data: Buffer;
  content_type: string;
  width: number;
  height: number;
  bytes: number;
  source: string | null;
  created_at: Date;
}
export const MEDIA_MODEL = 'MediaAsset';
export const MediaAssetSchema = new Schema<MediaAsset>(
  {
    _id: { type: String, required: true },
    data: { type: Buffer, required: true },
    content_type: { type: String, default: 'image/webp' },
    width: Number,
    height: Number,
    bytes: Number,
    source: { type: String, default: null },
  },
  { collection: 'media_assets', versionKey: false, timestamps: { createdAt: 'created_at', updatedAt: false } },
);

/** Public URL prefix of hosted media (served by MediaController). */
export const MEDIA_PREFIX = '/api/v1/media/';
export const MEDIA_FILE = /^p[a-f0-9]{24}(-card)?\.webp$/;

@Injectable()
export class MediaService {
  /** Images are processed one at a time (memory-bounded); everything else stays concurrent. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(@InjectModel(MEDIA_MODEL) private readonly assets: Model<MediaAsset>) {}

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Separate method so tests can stub the network. */
  fetchRemote(url: string) {
    return fetchImage(url);
  }

  /** Resize + store an image; returns the URL of the full-size variant (the card URL is derived). */
  async store(input: Buffer, source: string | null = null) {
    const name = `p${createHash('sha256').update(input).digest('hex').slice(0, 24)}`;
    if (!(await this.assets.exists({ _id: `${name}.webp` }))) {
      const v = await this.serial(() => makeVariants(input));
      const doc = (id: string, data: Buffer, width: number, height: number) => ({
        updateOne: {
          filter: { _id: id },
          update: { $setOnInsert: { _id: id, data, content_type: 'image/webp', width, height, bytes: data.length, source, created_at: new Date() } },
          upsert: true,
        },
      });
      await this.assets.bulkWrite([doc(`${name}-card.webp`, v.card, 640, 400), doc(`${name}.webp`, v.full, v.width, v.height)], { ordered: true });
    }
    return `${MEDIA_PREFIX}${name}.webp`;
  }

  /**
   * Make sure an image URL points at something we host: links to other sites are downloaded once
   * and resized, so pages never load someone's 2 MB / 27-megapixel original. Our own paths pass through.
   * Problems become a field error on `field`.
   */
  async ensureHosted(url: string | null | undefined, field = 'bannerUrl'): Promise<string | null | undefined> {
    if (!url || url.startsWith('/')) return url;
    try {
      return await this.store(await this.fetchRemote(url), url);
    } catch (e) {
      if (e instanceof ImageError) throw Errors.validation({ fields: { [field]: e.message } });
      throw e;
    }
  }

  async upload(input: Buffer) {
    try {
      return await this.store(input);
    } catch (e) {
      if (e instanceof ImageError) throw Errors.badRequest('NOT_AN_IMAGE', e.message);
      throw e;
    }
  }

  async find(file: string) {
    const a = await this.assets.findById(file).select('data content_type').lean();
    if (!a) return null;
    // Lean docs carry BSON Binary; hand the controller a plain Buffer of exactly the stored bytes.
    const d = a.data as unknown as Buffer | { buffer: Uint8Array; position: number };
    const data = Buffer.isBuffer(d) ? d : Buffer.from(d.buffer.buffer, d.buffer.byteOffset, d.position);
    return { data, contentType: a.content_type };
  }
}
