import type { Route } from 'next';

/**
 * Cast a dynamically-built path to a typed `Route` for `router.push` /
 * `router.replace` under Next's `typedRoutes` (next.config.ts:typedRoutes).
 *
 * typedRoutes only types statically-known route literals; paths built at
 * runtime (query strings, `[id]` segments) cannot be inferred, so an
 * assertion is unavoidable. This helper localises that assertion to ONE
 * audited place and keeps the value typed as `Route` — far safer than the
 * blanket `as never` it replaces, which disabled all type-checking on the
 * navigation argument (a typo'd route would compile clean and only fail at
 * runtime).
 */
export function dynamicRoute(path: string): Route {
  return path as Route;
}
