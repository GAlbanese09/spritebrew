// scripts/mobile-nav-test.mjs
//
// The app's navigation drawer (external product audit r2, SB-18). Below
// 1024 px the closed drawer is out of the tab order and the accessibility
// tree; the menu buttons have names and the opener says whether the drawer
// is open; Escape, the close button and the backdrop close it and put focus
// back on the opener; while it is open the page behind it is inert. From
// 1024 px the drawer is the always-visible sidebar. Checks the source by
// text; the browser check is in BUILD's harness
// (build/harness/ext-highs/). Run from the repo root:
// `node scripts/mobile-nav-test.mjs`. Prints only case names and pass or
// fail.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const header = read('src/components/layout/Header.tsx');
const sidebar = read('src/components/layout/Sidebar.tsx');
const shell = read('src/components/layout/AppShell.tsx');

let pass = 0;
let fail = 0;
function check(name, ok) {
  if (ok) { pass++; console.log(`pass  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

check('1: the closed drawer is hidden below 1024 px (out of the tab order and the accessibility tree), and visible from 1024 px',
  /\$\{open \? 'visible translate-x-0 transition-transform' : 'max-lg:invisible -translate-x-full transition-\[transform,visibility\]'\}/.test(sidebar)
  && /lg:visible lg:translate-x-0/.test(sidebar));
check('2: the opener is named, says whether the drawer is open, and names what it opens',
  /aria-label="Open menu"/.test(header) && /aria-expanded=\{menuOpen\}/.test(header) && /aria-controls="app-sidebar"/.test(header) && /ref=\{menuButtonRef\}/.test(header));
check('3: the drawer has its id and name; the close button is named',
  /id="app-sidebar"/.test(sidebar) && /aria-label="Main navigation"/.test(sidebar) && /aria-label="Close menu"/.test(sidebar));
check('4: opening moves focus to the close button', /if \(open\) closeButtonRef\.current\?\.focus\(\);/.test(sidebar));
check('5: the close button and the backdrop close and put focus back on the opener; a link closes without it',
  (sidebar.match(/onClick=\{\(\) => onClose\(true\)\}/g) ?? []).length === 2 && !/onClick=\{onClose\}/.test(sidebar)
  && /onClose\(false\)/.test(sidebar));
check('6: Escape closes the open drawer and puts focus back on the opener',
  /if \(e\.key === 'Escape'\) closeSidebar\(true\);/.test(shell)
  && /if \(restoreFocus\) requestAnimationFrame\(\(\) => menuButtonRef\.current\?\.focus\(\)\);/.test(shell));
check('7: while the drawer is open below 1024 px, the page behind it is inert', /inert=\{drawerModal\}/.test(shell) && /const drawerModal = sidebarOpen && !wide;/.test(shell));

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nall pass (${pass} cases)`);
process.exit(fail ? 1 : 0);
