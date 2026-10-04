import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // Same-origin in dev too, so the SameSite=Strict refresh cookie behaves exactly like prod.
    proxy: { '/api': process.env.API_PROXY ?? 'http://localhost:4000' },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // React rarely changes → long-lived cache separate from app code.
        manualChunks: (id) => (/node_modules[\/](react|react-dom|scheduler)[\/]/.test(id) ? 'react' : undefined),
      },
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    // Full runs start ~16 happy-dom environments in parallel; 5 s was too tight for the slowest form tests on CI-class machines.
    testTimeout: 15_000,
  },
});
