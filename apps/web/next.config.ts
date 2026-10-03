import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// In `pnpm dev` the API runs on its own port; in Compose and production Caddy serves both
// from one origin, which the refresh cookie and the CSRF origin check rely on.
const devApiUrl = process.env.DEV_API_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Trace files from the monorepo root so workspace packages land in the standalone output.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@elega/ui'],
  async rewrites() {
    if (process.env.NODE_ENV === 'production') return [];
    return [{ source: '/api/v1/:path*', destination: `${devApiUrl}/api/v1/:path*` }];
  },
  // The Content-Security-Policy header is set per request in src/proxy.ts (it carries a nonce).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
