import { setServers } from 'node:dns';
import { existsSync } from 'node:fs';
import { z } from 'zod';

// Local dev convenience: load backend/.env if present. In Docker/Railway, vars come from the platform.
// Never under tests: they must not inherit real SMTP/Atlas settings.
if (process.env.NODE_ENV !== 'test' && existsSync('.env')) process.loadEnvFile('.env');

// Some Windows/VPN setups expose 127.0.0.1 as Node's resolver, which breaks Atlas SRV lookups
// (querySrv ECONNREFUSED). Optional override, e.g. DNS_SERVERS=8.8.8.8,1.1.1.1. Not needed on Railway.
if (process.env.DNS_SERVERS) setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()));

const int = (def: number) => z.coerce.number().int().positive().default(def);
const bool = (def: boolean) =>
  z
    .enum(['true', 'false'])
    .default(def ? 'true' : 'false')
    .transform((v) => v === 'true');

/** "15m" | "30d" | "3600" → seconds */
const duration = (def: string) =>
  z
    .string()
    .default(def)
    .transform((v, ctx) => {
      const m = /^(\d+)\s*([smhd]?)$/.exec(v.trim());
      if (!m) {
        ctx.addIssue({ code: 'custom', message: `Invalid duration "${v}"` });
        return z.NEVER;
      }
      const mult = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2] as '' | 's' | 'm' | 'h' | 'd'];
      return Number(m[1]) * mult;
    });

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
    PORT: int(4000),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
    WEB_BASE_URL: z.url().default('http://localhost:5173'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    DB_POOL_MAX: int(10),
    DB_STATEMENT_TIMEOUT_MS: int(10000),

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: duration('15m'),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_REFRESH_TTL: duration('30d'),
    /** How long revoked/rotated refresh tokens are kept for reuse detection before auto-delete. */
    REFRESH_REVOKED_RETENTION: duration('1d'),
    /** Refresh token is rotated (new row + new cookie) at most this often; refreshes in between reuse it. */
    REFRESH_ROTATE_AFTER: duration('1h'),
    /** A just-rotated token presented within this window is a benign multi-tab race, not theft. */
    REFRESH_REUSE_GRACE: duration('30s'),
    PASSWORD_PEPPER: z.string().min(16),

    OTP_LENGTH: int(6),
    OTP_TTL_MINUTES: int(10),
    OTP_MAX_ATTEMPTS: int(5),
    OTP_RESEND_COOLDOWN_SECONDS: int(60),
    OTP_MAX_PER_WINDOW: int(3),
    LOGIN_MAX_ATTEMPTS: int(5),
    LOGIN_LOCK_MINUTES: int(15),
    INVITE_TTL_HOURS: int(72),

    /** Background job worker (MongoDB queue). */
    JOBS_ENABLED: bool(true),
    JOBS_CONCURRENCY: int(4),
    JOBS_IDLE_POLL_MS: int(2000),
    JOBS_LEASE_SECONDS: int(60),

    EMAIL_PROVIDER: z.enum(['resend', 'smtp', 'console']).default('console'),
    RESEND_API_KEY: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: int(587),
    SMTP_SECURE: bool(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    EMAIL_FROM_ADDRESS: z.string().default('onboarding@resend.dev'),
    EMAIL_FROM_NAME: z.string().default('NEC Events'),
    EMAIL_REPLY_TO: z.string().optional(),

    // Payments. With no Razorpay keys, local dev/tests use a simulated gateway ("mock"); never in production.
    PAYMENTS_PROVIDER: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['razorpay', 'mock']).optional()),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

    // Ticket QR signing (HMAC). Unset secret → derived from JWT_ACCESS_SECRET. Rotate: new KID + SECRET, old pair into QR_PREVIOUS_KEYS (kid:secret,…).
    QR_SIGNING_KID: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/).default('k1'),
    QR_SIGNING_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(32).optional()),
    QR_PREVIOUS_KEYS: z.string().optional(),

    SEED_ORG_NAME: z.string().default('National Engineering College'),
    SEED_ORG_SLUG: z.string().default('nec'),
    SEED_TIMEZONE: z.string().default('Asia/Kolkata'),
    SEED_SUPER_ADMIN_EMAIL: z.email().optional(),
    SEED_SUPER_ADMIN_PASSWORD: z.string().min(8).optional(),
    SEED_SUPER_ADMIN_NAME: z.string().default('Super Admin'),
  })
  .superRefine((e, ctx) => {
    if (e.EMAIL_PROVIDER === 'resend' && !e.RESEND_API_KEY)
      ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'required when EMAIL_PROVIDER=resend' });
    if (e.EMAIL_PROVIDER === 'smtp' && !(e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASS))
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'SMTP_HOST/USER/PASS required when EMAIL_PROVIDER=smtp' });
    if (e.PAYMENTS_PROVIDER === 'razorpay' && !(e.RAZORPAY_KEY_ID && e.RAZORPAY_KEY_SECRET && e.RAZORPAY_WEBHOOK_SECRET))
      ctx.addIssue({ code: 'custom', path: ['RAZORPAY_KEY_ID'], message: 'RAZORPAY_KEY_ID/KEY_SECRET/WEBHOOK_SECRET required when PAYMENTS_PROVIDER=razorpay' });
    if (e.PAYMENTS_PROVIDER === 'mock' && e.NODE_ENV === 'production')
      ctx.addIssue({ code: 'custom', path: ['PAYMENTS_PROVIDER'], message: 'the simulated gateway is not allowed in production' });
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  for (const i of parsed.error.issues) console.error(`   ${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}

export const env = parsed.data;
/** Anything that isn't local dev runs behind HTTPS → secure cookies, no stack traces. */
export const isDeployed = env.NODE_ENV === 'staging' || env.NODE_ENV === 'production';
