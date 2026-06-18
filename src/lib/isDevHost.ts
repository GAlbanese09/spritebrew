/**
 * True on dev / preview / localhost, false on the production domain.
 *
 * Cloudflare Pages builds EVERY deployment with `next build`, so
 * process.env.NODE_ENV is 'production' even on dev.spritebrew.pages.dev.
 * Gate dev-only diagnostics on the hostname instead.
 */
export function isDevHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h !== 'spritebrew.com' && h !== 'www.spritebrew.com';
}
