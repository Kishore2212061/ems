import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import { Errors } from '../common/app-exception';
import { Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { MEDIA_FILE, MediaService } from './media.service';

const ImportDto = z.object({ url: z.url({ protocol: /^https$/, message: 'Use an https:// image link' }).max(500) });

@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** Content-addressed → the bytes behind a URL never change: cache for a year. */
  @Public()
  @Get('media/:file')
  async get(@Param('file') file: string, @Res({ passthrough: true }) reply: FastifyReply) {
    if (!MEDIA_FILE.test(file)) throw Errors.notFound();
    const a = await this.media.find(file);
    if (!a) throw Errors.notFound();
    reply.header('Content-Type', a.contentType).header('Cache-Control', 'public, max-age=31536000, immutable');
    return a.data;
  }

  /**
   * Upload a poster: the raw image is the request body (Content-Type image/jpeg|png|webp|avif, ≤ 10 MB).
   * No multipart parser needed. Returns the hosted URL to put in `bannerUrl`.
   */
  @RequirePermission('local_event.manage')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('admin/media/posters')
  async upload(@Body() body: unknown) {
    if (!Buffer.isBuffer(body) || body.length === 0) throw Errors.badRequest('NOT_AN_IMAGE', 'Choose a JPG, PNG or WebP image');
    return { url: await this.media.upload(body) };
  }

  /**
   * Import a poster from a link the moment it's pasted: downloaded once (public https only, ≤ 10 MB),
   * compressed to the two WebP variants, and our URL returned, so the form never holds a raw link.
   */
  @RequirePermission('local_event.manage')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('admin/media/posters/import')
  async importLink(@Body(new ZodPipe(ImportDto)) dto: z.infer<typeof ImportDto>) {
    return { url: await this.media.ensureHosted(dto.url, 'url') };
  }
}
