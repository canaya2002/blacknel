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
