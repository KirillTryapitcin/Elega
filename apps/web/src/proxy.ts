import { type NextRequest, NextResponse } from 'next/server';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Per-request CSP nonce (brief §21). Next reads the nonce from the request's CSP header and
 * puts it on its own scripts; 'strict-dynamic' lets those scripts load the page chunks.
 * Styles keep 'unsafe-inline': a nonce there would also block style attributes, and
 * injected CSS cannot run code.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const https = (request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol).startsWith(
    'https',
  );
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? ' ws:' : ''}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    // Upgrading on plain-http origins (the local stack) would break every subresource.
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: the API sets its own headers, and static files need no CSP.
      source:
        '/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|healthz).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
