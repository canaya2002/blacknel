import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Next 16 promoted typedRoutes out of `experimental`. Leave the
  // `tsconfig.json` JSX setting for Next to manage (Next 16's build
  // step rewrites it to `react-jsx` and adds `.next/dev/types/**`).
  typedRoutes: true,
  // pglite ships a WASM bundle that Turbopack tries to relocate behind
  // a virtual `turbopack:///` URL — Node's fs rejects non-file URLs.
  // Externalising pglite (server-only by `import 'server-only'`) keeps
  // its asset resolution as plain CommonJS. Removed at Phase-11 cutover
  // when postgres-js replaces pglite in production.
  serverExternalPackages: ['@electric-sql/pglite'],
};

export default nextConfig;
