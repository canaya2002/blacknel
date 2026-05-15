import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Next 16 promoted typedRoutes out of `experimental`. Leave the
  // `tsconfig.json` JSX setting for Next to manage (Next 16's build
  // step rewrites it to `react-jsx` and adds `.next/dev/types/**`).
  typedRoutes: true,
};

export default nextConfig;
