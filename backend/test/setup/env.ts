import { randomBytes } from 'node:crypto';
import { inject } from 'vitest';

// Runs before each test file (before any app module is imported).
// `??=` lets an individual test file pre-set a value via vi.hoisted().
const uri = new URL(inject('mongoUri'));
uri.pathname = `/ems_test_${randomBytes(4).toString('hex')}`; // isolated DB per test file

const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  MONGODB_URI: uri.toString(),
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef0123456789',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef012345678',
  PASSWORD_PEPPER: 'test-pepper-0123456789',
  EMAIL_PROVIDER: 'console',
  WEB_BASE_URL: 'http://localhost:5173',
  SEED_SUPER_ADMIN_EMAIL: 'root@test.local',
  SEED_SUPER_ADMIN_PASSWORD: 'RootPass123',
};
for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v;
