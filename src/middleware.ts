// Minimal pass-through middleware for Cloudflare Pages compatibility.
// Clerk's clerkMiddleware() pulls in Node-only dependencies that break the
// @cloudflare/next-on-pages adapter. Protection is still enforced by:
//   1. /api/generate route — calls `await auth()` and returns 401 if unauthenticated
//   2. /generate page — wraps content in <Show when="signed-in"> with a sign-in gate
//
// Note: Next.js 16 removed `runtime = 'edge'` export for middleware (forbidden
// in proxy.ts, rejected in middleware.ts). This file uses only edge-compatible
// APIs (NextResponse / NextRequest), so the Cloudflare adapter can run it on
// the edge regardless of the declared runtime.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export default function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
