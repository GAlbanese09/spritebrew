import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

// Everything may be read; the sitemap says where the public pages are
// (HQ 2026-11-15-098 item 2). Cloudflare's managed robots.txt, where it is on,
// is placed before this file's lines.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: '/' }, sitemap: SITE_URL + '/sitemap.xml' };
}
