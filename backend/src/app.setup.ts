import fastifyCookie from '@fastify/cookie';
import fastifyEtag from '@fastify/etag';
import fastifyHelmet from '@fastify/helmet';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { env } from './config/env';
import { MAX_IMAGE_BYTES } from './media/image';

/**
 * Shared by main.ts and the test harness, so tests exercise exactly the production HTTP stack.
 *
 * Fastify: ~2x Express throughput with lower per-request overhead.
 * trustProxy = number of proxy hops in front of us (Railway edge + nginx = 2). Trusting a fixed
 * hop count, not "true", stops clients spoofing X-Forwarded-For to dodge per-IP rate limits.
 */
export const createAdapter = () => new FastifyAdapter({ trustProxy: env.TRUST_PROXY_HOPS, bodyLimit: 100 * 1024 });

export async function configureApp(app: NestFastifyApplication) {
  await app.register(fastifyHelmet, { contentSecurityPolicy: false }); // JSON API: no HTML to protect
  await app.register(fastifyCookie);
  // ETag on every GET → unchanged lists/fest pages come back as 304 with no body (B7).
  await app.register(fastifyEtag, { weak: true });

  // Poster uploads arrive as the raw image body (no multipart parser). Only this parser gets the
  // 10 MB limit; JSON bodies stay capped at 100 KB.
  app
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser(/^image\/(jpeg|png|webp|avif)$/, { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES }, (_req, body, done) => done(null, body));

  app.setGlobalPrefix('api/v1');
  // Prod traffic is same-origin via nginx; CORS only matters for direct API calls (local tools, previews).
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
  return app;
}
