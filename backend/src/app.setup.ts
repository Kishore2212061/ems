import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { env } from './config/env';

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

  app.setGlobalPrefix('api/v1');
  // Prod traffic is same-origin via nginx; CORS only matters for direct API calls (local tools, previews).
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
  return app;
}
