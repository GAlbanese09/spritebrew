// scripts/search-basics-test.mjs
//
// The site's search and share words (HQ room 2026-11-17-101, DESIGN's
// attachment to 2026-11-17-099): each public page carries its approved title
// and description, word for word; the share picture is the approved file;
// /gallery and /buy-tokens stay out of search; the sitemap lists the public
// pages and no others. Reads the source; writes nothing. Run from the repo
// root: `node scripts/search-basics-test.mjs`.

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

let failed = 0;
let passed = 0;
const check = (name, ok) => {
  if (ok) { passed++; console.log(`pass ${name}`); } else { failed++; console.log(`FAIL ${name}`); }
};
const read = (p) => readFileSync(p, 'utf8');
const DASH = String.fromCharCode(0x2014);

const seo = read('src/lib/seo.ts');
const APPROVED = {
  'src/lib/seo.ts': ['SpriteBrew: AI Sprite Sheet Generator for Pixel Art', 'Describe a character and get pixel art sprites and animated sprite sheets for your game. Slice, edit and export for Unity, Godot or GameMaker. Start free.'],
  'src/app/upload/layout.tsx': ['Sprite Sheet Slicer: Cut a Sheet into Frames | SpriteBrew', 'Upload a sprite sheet and slice it into frames by grid or automatically, then preview, edit and export them. Free, no account needed.'],
  'src/app/generate/layout.tsx': ['AI Pixel Art Sprite and Animation Generator | SpriteBrew', 'Describe a character and get a pixel art sprite, or animate it into a walk, idle or attack sprite sheet. Bring your own character too. Start free.'],
  'src/app/resize/layout.tsx': ['Free Pixel Art Resizer | SpriteBrew', 'Resize pixel art and sprite sheets without blurring. Shrink or grow by whole steps, free, no account, and your image never leaves your browser.'],
  'src/app/updates/page.tsx': ['Updates | SpriteBrew', 'Every SpriteBrew update, newest first.'],
  'src/app/terms/page.tsx': ['Terms of Service | SpriteBrew', 'The terms for using SpriteBrew: your account, the free tier, who owns what you make, refunds and acceptable use.'],
  'src/app/privacy/page.tsx': ['Privacy Policy | SpriteBrew', 'What SpriteBrew collects, why, the services it uses, and how to delete your data.'],
  'src/app/refund-policy/page.tsx': ['Refund Policy | SpriteBrew', 'When you can get a refund on SpriteBrew token purchases, the 14-day window, and how to ask for one.'],
};
for (const [file, [title, description]] of Object.entries(APPROVED)) {
  const src = read(file);
  check(`1: ${file} carries its approved title`, src.includes(`'${title}'`));
  check(`2: ${file} carries its approved description`, src.includes(`'${description}'`));
  check(`3: ${file}: title within 60 and description within 155 characters, no em dash`, title.length <= 60 && description.length <= 155 && !title.includes(DASH) && !description.includes(DASH));
}

const PATTERN = {
  'src/app/gallery/layout.tsx': 'Gallery | SpriteBrew',
  'src/app/buy-tokens/layout.tsx': 'Buy Tokens | SpriteBrew',
  'src/app/editor/layout.tsx': 'Edit | SpriteBrew',
  'src/app/preview/layout.tsx': 'Preview | SpriteBrew',
  'src/app/export/layout.tsx': 'Export | SpriteBrew',
  'src/app/sign-in/layout.tsx': 'Sign In | SpriteBrew',
  'src/app/sign-up/layout.tsx': 'Sign Up | SpriteBrew',
};
for (const [file, title] of Object.entries(PATTERN)) {
  check(`4: ${file} is titled "{Page} | SpriteBrew"`, existsSync(file) && read(file).includes(`pageMetadata('${title}')`));
}

check('5a: /gallery is kept out of search', read('src/app/gallery/layout.tsx').includes('robots: NOINDEX'));
check('5b: /buy-tokens is kept out of search', read('src/app/buy-tokens/layout.tsx').includes('robots: NOINDEX'));
const indexed = [...Object.keys(APPROVED).filter((f) => f !== 'src/lib/seo.ts'), ...Object.keys(PATTERN).filter((f) => !/gallery|buy-tokens/.test(f))];
check('5c: no other page is kept out of search', indexed.every((f) => !read(f).includes('NOINDEX')));
check('5d: NOINDEX is index false, follow true', /NOINDEX[^=]*=\s*\{\s*index: false, follow: true\s*\}/.test(seo));

const paths = (seo.match(/SITEMAP_PATHS = \[([^\]]*)\]/) || [])[1];
check('6a: the sitemap lists the eight public pages, no others', paths && JSON.stringify(paths.split(',').map((s) => s.trim().replace(/'/g, ''))) === JSON.stringify(['/', '/upload', '/generate', '/resize', '/updates', '/terms', '/privacy', '/refund-policy']));
check('6b: robots allows all and names the sitemap', /allow: '\/'/.test(read('src/app/robots.ts')) && read('src/app/robots.ts').includes("SITE_URL + '/sitemap.xml'"));

const png = readFileSync('public/og-share.png');
check('7a: the share picture is the approved file (sha256 b49fd457)', createHash('sha256').update(png).digest('hex') === 'b49fd457150fd71cc725601f416681f3ce7604ac06a3cb19f8a00ab86d6cce6e');
check('7b: it is a 1200 by 630 PNG', png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630);
check('7c: every page shares it, with its approved alt text', seo.includes("url: '/og-share.png'") && seo.includes("alt: 'SpriteBrew: a 16-frame pixel art wizard walk sheet, beside the words AI sprite sheet generator for pixel art.'"));
check('7d: the share card follows each page\'s own words', /openGraph: \{[^}]*title, description, images: \[SHARE_IMAGE\]/.test(seo) && /twitter: \{ card: 'summary_large_image', title, description, images: \[SHARE_IMAGE\]/.test(seo));

const home = read('src/app/page.tsx');
check('8a: the home page carries its structured data', home.includes('application/ld+json') && home.includes('HOME_JSON_LD'));
const jsonLd = (seo.match(/HOME_JSON_LD = \{[\s\S]*?\n\};/) || [''])[0];
check('8b: the structured data claims no rating or review', jsonLd.length > 0 && !/aggregateRating|ratingValue|"?review"?\s*:/i.test(jsonLd));
check('8c: the structured data makes no price claim (AUDIT search-basics-r1, L1)', jsonLd.length > 0 && !/offers|price/i.test(jsonLd));
check('9: the old shared title is gone from the source', !/AI-Powered Pixel Art Sprite Sheets/.test(read('src/app/layout.tsx')));

console.log(`[search-basics-test] ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
