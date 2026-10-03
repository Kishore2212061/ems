import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  // SWC's native addon refuses some Windows user-cache folders (DACL check on AppData\Local\swc).
  // A project-local cache avoids that everywhere. Must be set before @swc/core loads.
  const cache = resolve('node_modules/.cache/swc');
  mkdirSync(cache, { recursive: true });
  process.env.SWC_NATIVE_BINDING_CACHE ??= cache;
  const { default: swc } = await import('unplugin-swc');

  return {
    // SWC instead of esbuild: Nest DI needs emitDecoratorMetadata, which esbuild doesn't support.
    plugins: [swc.vite({ module: { type: 'es6' } })],
    test: {
      environment: 'node',
      include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
      globalSetup: ['test/setup/global-setup.ts'], // one Mongo replica set for the whole run
      setupFiles: ['test/setup/env.ts'], // per test file: test env + its own database
      pool: 'forks',
      testTimeout: 20_000,
      hookTimeout: 90_000,
    },
  };
});
