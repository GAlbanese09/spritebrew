// Minimal pass-through middleware for Cloudflare Pages compatibility, with a
// global POST catch for Clerk's sign-out flow.
//
// Clerk's sign-out POSTs to the current page URL before redirecting. Static
// pages (Upload, Preview, Export, Gallery, Home, etc.) have no POST handler,
// so Cloudflare Pages returns 405. Intercept any POST to a non-API route and
// redirect to `/` — this covers every page globally without per-page
// `route.ts` handlers.
//
// Protection for the Generate feature is enforced at:
//   1. /api/generate route — calls `await auth()` and returns 401 if unauthenticated
//   2. /generate page — wraps content in <Show when="signed-in"> with a sign-in gate
//
// Note: Next.js 16 rejects `export const runtime = 'edge'` on middleware
// ("edge runtime for rendering is currently experimental"). This file uses
// only edge-compatible APIs (NextResponse / NextRequest), so the Cloudflare
// adapter can run it on the edge regardless of the declared runtime.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export default function middleware(request: NextRequest) {
  // Handle Clerk sign-out POST requests on static pages.
  // Any non-API POST is Clerk's sign-out flow — redirect to home.
  if (request.method === 'POST' && !request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.redirect(new URL('/', request.url));
  }

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
