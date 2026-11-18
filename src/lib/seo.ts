import type { Metadata } from 'next';

// Search and share words for the site's pages: HQ room 2026-11-17-101
// approved DESIGN's drafts (room/attachments/2026-11-17-099_design_to_build.seo.md)
// word for word. Every page shares one picture, and its og: and twitter:
// title and description follow the page's own words.

export const SITE_URL = 'https://spritebrew.com';

export const SHARE_IMAGE = {
  url: '/og-share.png',
  width: 1200,
  height: 630,
  alt: 'SpriteBrew: a 16-frame pixel art wizard walk sheet, beside the words AI sprite sheet generator for pixel art.',
};

export const HOME_TITLE = 'SpriteBrew: AI Sprite Sheet Generator for Pixel Art';
export const HOME_DESCRIPTION =
  'Describe a character and get pixel art sprites and animated sprite sheets for your game. Slice, edit and export for Unity, Godot or GameMaker. Start free.';

/** The public pages search engines are asked to list (`/sitemap.xml`). */
export const SITEMAP_PATHS = ['/', '/upload', '/generate', '/resize', '/updates', '/terms', '/privacy', '/refund-policy'];

/** A page's title and description, with its share card in the same words.
 *  With no description, the page keeps the home description. */
export function pageMetadata(title: string, description: string = HOME_DESCRIPTION): Metadata {
  return {
    title,
    description,
    openGraph: { type: 'website', siteName: 'SpriteBrew', url: './', title, description, images: [SHARE_IMAGE] },
    twitter: { card: 'summary_large_image', title, description, images: [SHARE_IMAGE] },
  };
}

/** A page that holds a person's own work or account: kept out of search. */
export const NOINDEX: Metadata['robots'] = { index: false, follow: true };

/** The home page's structured data: what SpriteBrew is, with no rating and
 *  no price line (AUDIT search-basics-r1, L1). */
export const HOME_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'SpriteBrew',
  url: SITE_URL,
  applicationCategory: 'DesignApplication',
  operatingSystem: 'Web browser',
  description: HOME_DESCRIPTION,
  image: SITE_URL + SHARE_IMAGE.url,
};
