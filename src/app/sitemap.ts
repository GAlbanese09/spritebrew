import type { MetadataRoute } from 'next';
import { SITE_URL, SITEMAP_PATHS } from '@/lib/seo';

// The public pages search engines are asked to list (HQ 2026-11-15-098 item 2,
// 2026-11-17-101). /editor, /preview and /export stay out: they are empty
// until a sheet is loaded, or hold drafts.
export default function sitemap(): MetadataRoute.Sitemap {
  return SITEMAP_PATHS.map((path) => ({ url: path === '/' ? SITE_URL : SITE_URL + path }));
}
