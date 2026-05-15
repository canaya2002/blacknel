/**
 * Vitest shim for the `'server-only'` import marker shipped by Next.js.
 * In production builds Next rejects this module when bundled into a
 * client component; in tests we just want a no-op so any
 * `import 'server-only'` line at the top of a server module is silent.
 */
export {};
