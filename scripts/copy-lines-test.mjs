// scripts/copy-lines-test.mjs
//
// Pins for small copy changes that have no test of their own. Reads the
// files and checks the words; writes nothing. Run from the repo root:
// `node scripts/copy-lines-test.mjs`.
//
// 1. README: the official-site line (HQ 2026-11-17-235, 2026-11-18-008); no
//    count of styles, which went stale (COM 2026-11-18-016); no hidden style
//    in its list.
// 2. The generation poll's 8-minute stop says DESIGN's words (HQ
//    2026-11-18-008).

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok) => {
  if (ok) { pass++; console.log(`pass  ${name}`); } else { fail++; console.log(`FAIL  ${name}`); }
};

const readme = read('README.md');
check('1a: README says the only official site is spritebrew.com', readme.includes('The only official SpriteBrew site is [spritebrew.com](https://spritebrew.com).'));
check('1b: README gives no count of styles', !/\b\d+ (?:visual )?styles\b/i.test(readme) && !/\b\d+ categories\b/i.test(readme));
check('1c: README does not list the hidden 8-Direction Rotation', !readme.includes('8-Direction Rotation'));

const poll = read('src/hooks/useGenerationPoll.ts');
check('2a: the 8-minute stop says DESIGN\'s words', poll.includes("'This is taking much longer than usual. If it finishes, it will be in your gallery. If your balance looks wrong after a day, contact support.'"));
check('2b: ... and no longer promises the tokens back', !poll.includes('If it fails, your tokens come back automatically.'));

const DASH = String.fromCharCode(0x2014);
check('3: no em dash in this test or in the README lines it pins', !read('scripts/copy-lines-test.mjs').includes(DASH) && !readme.split('\n').filter((l) => /official SpriteBrew site|Text-to-Sprite Generation|pick a visual style|Phase 2: AI integration|try it now/.test(l)).some((l) => l.includes(DASH)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
