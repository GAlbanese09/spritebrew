// scripts/muted-text-test.mjs
//
// Offline tests for the dim text's contrast (the external product audit's
// SB-11, DESIGN 2026-11-25-117). Run from the repo root:
// `node scripts/muted-text-test.mjs`. Reads the theme tokens in
// src/app/globals.css and the class names in the files below; prints only
// case names and pass or fail.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

// WCAG 2.2 relative luminance and contrast ratio.
function lum(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const css = read('src/app/globals.css');
// The theme's :root (the one under "Theme tokens"; an earlier :root holds
// runtime values).
const themeAt = css.indexOf(':root {', css.indexOf('Theme tokens'));
const root = css.slice(themeAt, css.indexOf('}', themeAt));
const token = (name) => (root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`)) || [])[1];

// The backgrounds dim text sits on: the five surface tokens and the
// homepage's own #0a0a0a.
const BACKGROUNDS = ['bg-primary', 'bg-secondary', 'bg-surface', 'bg-elevated', 'bg-hover'].map(token);
BACKGROUNDS.push('#0a0a0a');
const muted = token('text-muted');

// ── 1. The token ──
check('every background token is read', BACKGROUNDS.every(Boolean) && BACKGROUNDS.length === 6);
check('--text-muted reaches 4.5:1 on every background',
  Boolean(muted) && BACKGROUNDS.every((bg) => contrast(muted, bg) >= 4.5));
check('--text-muted stays dimmer than --text-secondary',
  Boolean(muted) && lum(muted) < lum(token('text-secondary')));
check('--text-disabled keeps the old #5c5550 and is a theme colour',
  token('text-disabled')?.toLowerCase() === '#5c5550' && /--color-text-disabled:\s*var\(--text-disabled\);/.test(css));

// ── 2. No dim text typed by hand ──
const LITERAL = /(?:^|[\s'"`])(?:[a-z-]+:)*text-\[#5c5550\]/m;
const literalFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(e.name) && LITERAL.test(read(p))) literalFiles.push(p);
  }
})('src');
check('no text, hover or placeholder colour is typed as #5c5550', literalFiles.length === 0);

// ── 3. The homepage (SB-11's rows) ──
const home = read('src/app/page.tsx');
const footer = home.slice(home.indexOf('<footer'), home.indexOf('</footer>'));
const links = [...footer.matchAll(/<a\b[\s\S]*?className="([^"]*)"/g)].map((m) => m[1]);
check('the footer has its seven links', links.length === 7);
check('each footer link is muted, and turns primary on hover and on focus',
  links.length === 7 && links.every((c) => /hover:text-text-primary/.test(c) && /focus-visible:text-text-primary/.test(c))
    && /<div className="[^"]*text-text-muted[^"]*">\s*<a/.test(footer) && /<p className="[^"]*text-text-muted[^"]*">\s*<a href="\/updates"/.test(footer));
check('the free-start note is muted text',
  /<p className="[^"]*text-text-muted[^"]*">\s*Start free\./.test(home));

// ── 4. Disabled text keeps the old colour (DESIGN 2026-11-25-117) ──
const DISABLED = [
  ['src/components/sprites/GenerationResult.tsx', /\? 'bg-bg-elevated text-text-disabled border border-border-subtle cursor-not-allowed'/],
  ['src/components/layout/Sidebar.tsx', /\? 'text-text-disabled cursor-default'/],
  ['src/components/layout/Sidebar.tsx', /soon \? 'text-text-disabled' :/],
  ['src/components/sprites/SlicerConfig.tsx', /\? 'bg-bg-elevated text-text-disabled cursor-not-allowed border border-border-subtle\/50'/],
  ['src/components/sprites/ReferenceImagesPanel.tsx', /size=\{20\} className=\{enabled \? 'text-text-secondary' : 'text-text-disabled'\}/],
  ['src/components/sprites/ReferenceImagesPanel.tsx', /size=\{16\} className=\{enabled \? 'text-text-secondary' : 'text-text-disabled'\}/],
];
for (const [file, re] of DISABLED) check(`disabled text stays dim: ${path.basename(file)} ${re.source.slice(0, 40)}`, re.test(read(file)));

// ── 5. Round 1's Lows (AUDIT lows-1 r1) ──
// Every source file, with its text.
const SOURCES = [];
(function walk(dir) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) SOURCES.push([p, read(p)]);
  }
})('src');
// L1: an opacity on dim text takes it back under 4.5:1. Only a separator
// (a middot) may stay faded.
const faded = [];
for (const [p, t] of SOURCES) {
  for (const m of t.matchAll(/<(\w+) className="[^"]*\btext-text-muted\/\d+[^"]*">([^<]*)</g)) {
    if (!/^\s*(&middot;|·)\s*$/.test(m[2])) faded.push(`${p}: ${m[2].trim().slice(0, 30)}`);
  }
  for (const m of t.matchAll(/\btext-text-muted\/\d+/g)) {
    const at = t.lastIndexOf('<', m.index);
    const tag = t.slice(at, t.indexOf('</', m.index));
    if (!/>\s*(&middot;|·)\s*$/.test(tag)) faded.push(`${p}@${m.index}`);
  }
}
check('no dim text is faded by an opacity, separators aside', faded.length === 0);
// L2: on the export page's chosen tint, the small lines turn primary.
const exp = read('src/components/sprites/ExportConfig.tsx');
check('a chosen format card\'s engine line is primary on the amber tint',
  /<p className=\{`text-\[10px\] font-mono leading-relaxed \$\{active \? 'text-text-primary' : 'text-text-muted'\}`\}>\s*\{engine\.engines\.join\(', '\)\}/.test(exp));
check('a chosen animation\'s frame count is primary on the amber tint',
  /<span className=\{checked \? 'text-text-primary' : 'text-text-muted'\}>\(\{a\.frames\.length\}\)<\/span>/.test(exp));
// L3: a dim control's hover must show; secondary is too close to dim now.
const flat = [];
for (const [p, t] of SOURCES) {
  for (const m of t.matchAll(/(?:className=|['"`?:]\s*)(["'`])((?:(?!\1)[\s\S]){0,400}?)\1/g)) {
    const c = m[2];
    if (/\btext-text-muted\b(?!\/)/.test(c) && /\b(?:group-)?hover:text-text-secondary\b/.test(c)) flat.push(`${p}: ${c.trim().slice(0, 50)}`);
  }
}
check('no dim control hovers to secondary (it hovers to primary)', flat.length === 0);

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
