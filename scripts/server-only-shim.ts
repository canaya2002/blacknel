/**
 * tsx-specific shim for the `'server-only'` import marker shipped by
 * Next.js. Mirrors `tests/helpers/server-only-shim.ts` and is wired
 * via `tsconfig.scripts.json` `paths.server-only`. Both shims exist
 * because the two runtimes (vitest + tsx) configure module aliases
 * through different mechanisms — duplicating the trivial export
 * costs less than coupling them.
 *
 * In production Next builds, `'server-only'` resolves to the real
 * package vendored at `next/dist/compiled/server-only/` and STILL
 * blocks client imports the way it always did. This shim is for
 * standalone scripts and tests only.
 */
export {};
