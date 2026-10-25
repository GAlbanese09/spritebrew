// scripts/changelog-test.mjs
//
// Offline tests for the release notes (src/lib/changelog.ts) that the What's
// New pop-up and the /updates page share. Run from the repo root:
// `node scripts/changelog-test.mjs`. Bundles the module with esbuild into
// local/.changelog-test/ (gitignored). Prints only case names and pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.changelog-test', 'changelog.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/changelog.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const { RELEASES, CURRENT_VERSION, releaseLabel, parseVersion, compareVersions, releasesSince } =
  await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
const versions = (list) => list.map((r) => r.version).join(',');

// ── The list itself ──
check('every release has a valid version, a date, a title and at least one entry',
  RELEASES.every((r) => parseVersion(r.version) && r.date && r.title && r.entries.length > 0));
check('versions are unique and strictly decreasing, newest first',
  RELEASES.every((r, i) => i === 0 || compareVersions(parseVersion(RELEASES[i - 1].version), parseVersion(r.version)) > 0));
check('CURRENT_VERSION is the first release', CURRENT_VERSION === RELEASES[0].version);
check('every entry has an emoji, a title and a description',
  RELEASES.every((r) => r.entries.every((e) => e.emoji && e.title && e.description)));
check('no release label has a dash between date and title, and none has an em dash',
  RELEASES.every((r) => /^[^:]+: \S/.test(releaseLabel(r)) && !releaseLabel(r).includes('\u2014')));
check('entry titles are unique within each release',
  RELEASES.every((r) => new Set(r.entries.map((e) => e.title)).size === r.entries.length));

// ── Versions ──
check('parseVersion reads dotted numbers and rejects anything else',
  JSON.stringify(parseVersion('0.6.2')) === '[0,6,2]' && JSON.stringify(parseVersion(' 1.10 ')) === '[1,10]'
    && [null, undefined, '', 'v0.6.2', '0.6.x', '0..6', '.6', 'latest'].every((v) => parseVersion(v) === null));
check('compareVersions orders by number, not text, and pads missing parts',
  compareVersions([0, 5, 13], [0, 5, 9]) > 0 && compareVersions([0, 6], [0, 6, 0]) === 0 && compareVersions([0, 4, 0], [0, 5, 0]) < 0);

// ── What the pop-up shows ──
const second = RELEASES[1].version;
check('seen at the previous release: only the newest release', versions(releasesSince(second)) === RELEASES[0].version);
check('seen three releases back: the three newer releases, newest first',
  versions(releasesSince(RELEASES[3].version)) === versions(RELEASES.slice(0, 3)));
check('seen at the current version: nothing', releasesSince(CURRENT_VERSION).length === 0);
check('seen at a version newer than this build (after a rollback): nothing', releasesSince('99.0.0').length === 0);
check('seen at a version that is not in the list: every release newer than it',
  versions(releasesSince('0.5.95')) === versions(RELEASES.filter((r) => compareVersions(parseVersion(r.version), [0, 5, 95]) > 0)));
check('seen value that is not a version: the newest release alone',
  ['garbage', '', 'v0.6.1'].every((v) => versions(releasesSince(v)) === RELEASES[0].version));
check('seen before the oldest release: everything', releasesSince('0.0.1').length === RELEASES.length);

// ── The pop-up and the page read the shared list ──
{
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const modal = read('src/components/layout/WhatsNew.tsx');
  const page = read('src/app/updates/page.tsx');
  check('the pop-up has no list of its own and filters with releasesSince',
    !/const CHANGELOG/.test(modal) && modal.includes('releasesSince(stored)'));
  check('the pop-up links to /updates ("See all updates")', modal.includes('href="/updates"') && modal.includes('See all updates'));
  check('the /updates page renders RELEASES with releaseLabel', page.includes('RELEASES.map') && page.includes('releaseLabel(release)'));
  check('the sidebar version line and the landing footer link to /updates',
    read('src/components/layout/Sidebar.tsx').includes('href="/updates"') && read('src/app/page.tsx').includes('href="/updates"'));
}

console.log(failed ? `${failed} failed` : 'all pass');
process.exit(failed ? 1 : 0);
