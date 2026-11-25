// scripts/rpg-directions-test.mjs
//
// RPG Maker's direction mapping on /export (external product audit r2,
// SB-02): a direction may only use a checked animation with frames; one set
// to an animation that is then unchecked reads as none; Download stays off
// until one direction has a checked animation, while a single mapped row
// still exports. Runs src/lib/rpgDirections.ts, and checks by text that
// ExportConfig.tsx uses it. Run from the repo root:
// `node scripts/rpg-directions-test.mjs`. Bundles with esbuild into
// local/.rpg-directions-test/ (gitignored). Prints only case names and pass
// or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'local', '.rpg-directions-test');
fs.mkdirSync(OUT_DIR, { recursive: true });
let R = null;
const src = path.join(ROOT, 'src/lib/rpgDirections.ts');
if (fs.existsSync(src)) {
  const outfile = path.join(OUT_DIR, 'rpgDirections.mjs');
  await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'neutral', outfile, logLevel: 'silent' });
  R = await import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
}

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`pass  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
}
const anim = (id, n) => ({ id, name: id, frames: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}` })) });
const idle = anim('idle', 2);
const walk = anim('walk', 3);
const empty = anim('empty', 0);

// ── 1. The audit's acceptance check ──

check('1a: rpgDirections.ts exists', R !== null);
if (R) {
  const map = ['walk', null, null, null];
  // Select Idle and Walk, map Down to Walk: a row.
  check('1b: Idle and Walk checked, Down set to Walk: Download is on', R.rpgHasRow(map, [idle, walk]) && JSON.stringify(R.rpgMapInUse(map, [idle, walk])) === '["walk",null,null,null]');
  // Then uncheck Walk.
  check('1c: Walk unchecked: Down reads as none, and with no direction left Download is off',
    JSON.stringify(R.rpgMapInUse(map, [idle])) === '[null,null,null,null]' && !R.rpgHasRow(map, [idle]));
  check('1d: a single mapped Idle row is enough', R.rpgHasRow(['idle', null, null, null], [idle]) && R.rpgHasRow([null, null, null, 'idle'], [idle]));
  check('1e: the menu offers only checked animations with frames',
    JSON.stringify(R.rpgChoices([idle, empty]).map((a) => a.id)) === '["idle"]' && R.rpgChoices([]).length === 0);
  check('1f: a direction set to an animation with no frames counts as none', !R.rpgHasRow(['empty', null, null, null], [idle, empty]));
}

// ── 2. ExportConfig uses it ──

{
  const cfg = fs.readFileSync(path.join(ROOT, 'src/components/sprites/ExportConfig.tsx'), 'utf8');
  check('2a: the map in use drops unchecked animations, and every direction menu shows it',
    /const rpgMap = useMemo\(\(\) => rpgMapInUse\(directionMap, activeAnimations\), \[directionMap, activeAnimations\]\);/.test(cfg)
    && /value=\{rpgMap\[idx\] \?\? ''\}/.test(cfg));
  check('2b: a change starts from the map in use, so stale choices are cleared', /const next = \[\.\.\.rpgMap\];/.test(cfg));
  check('2c: the menu lists only checked animations with frames', /\{rpgChoices\(activeAnimations\)\.map\(\(a\) => \(/.test(cfg));
  check('2d: the export gets the map in use', /directionMap: rpgMap,/.test(cfg));
  check('2e: Download stays off for RPG Maker with no direction set, and the card says why',
    /const rpgBlank = selectedEngine === 'rpgmaker' && !rpgHasRow\(directionMap, activeAnimations\);/.test(cfg)
    && /disabled=\{exporting \|\| totalFrames === 0 \|\| rpgBlank\}/.test(cfg)
    && /\{rpgBlank && \(/.test(cfg));
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nall pass (${pass} cases)`);
process.exit(fail ? 1 : 0);
