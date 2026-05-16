import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'dist'],
    setupFiles: ['./tests/helpers/react-act-setup.ts'],
    // pglite spins up a WASM Postgres per test file. Letting Vitest run
    // many files in parallel inside a tinypool worker triggers an
    // intermittent "Worker exited unexpectedly" on Windows: pglite's
    // async WASM teardown is racing the worker shutdown signal. Running
    // every test file inside a single forked process — and serializing
    // file-level execution — eliminates the cross-file teardown race
    // entirely. Each `createTestDb()` still gets a fresh pglite, and
    // we lose ~1–2s of parallelism for ~zero flake.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
      // `'server-only'` is a Next-only marker. Vitest can't resolve it
      // out of the box — alias it to an empty shim so server modules
      // remain importable from tests.
      'server-only': path.resolve(import.meta.dirname, 'tests/helpers/server-only-shim.ts'),
    },
  },
});
