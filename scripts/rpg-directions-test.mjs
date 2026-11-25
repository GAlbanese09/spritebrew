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
  check('2e: Download stays off for RPG Maker with no direction set (aria-disabled, so it keeps its place in the Tab order and its reason is heard: REV-L1), and the card says why',
    /const rpgBlank = selectedEngine === 'rpgmaker' && !rpgHasRow\(directionMap, activeAnimations\);/.test(cfg)
    && /disabled=\{exporting \|\| totalFrames === 0\}/.test(cfg) && /aria-disabled=\{rpgBlank \|\| undefined\}/.test(cfg)
    && /if \(rpgBlank\) return;/.test(cfg)
    && /\{rpgBlank && \(/.test(cfg));
  // DESIGN 2026-11-25-042: the line sits under the off button, names where
  // the menus are, is tied to the button, and is 12 px.
  const line = 'Set at least one direction under Direction mapping to a checked animation to download the sheet.';
  const iLine = cfg.indexOf(line);
  const iButton = cfg.indexOf('aria-disabled={rpgBlank || undefined}');
  check('2f: the line\'s words, once, under the Download button', iLine > 0 && cfg.indexOf(line, iLine + 1) < 0 && iButton > 0 && iLine > iButton
    && !/Set at least one direction to a checked animation/.test(cfg));
  check('2g: the Download button is described by the line while it is off, and the line is 12 px',
    /aria-describedby=\{rpgBlank \? rpgBlankId : undefined\}/.test(cfg)
    && /<p id=\{rpgBlankId\} className="text-xs font-mono text-accent-amber/.test(cfg)
    && /const rpgBlankId = useId\(\);/.test(cfg));
}


// ── 3. The preview and the download draw the same 3 x 4 sheet (SB-07) ──

if (R) {
  const four = { id: 'four', name: 'four', frames: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] };
  const one = { id: 'one', name: 'one', frames: [{ id: 'z' }] };
  const rows = typeof R.rpgRows === 'function' ? R.rpgRows(['four', null, null, null], [four, one]) : null;
  check('3a: four frames mapped Down: row 1 holds the first three, the other rows are empty',
    !!rows && JSON.stringify(rows) === JSON.stringify([{ animId: 'four', frameIds: ['a', 'b', 'c'] }, null, null, null]), rows);
  const up = typeof R.rpgRows === 'function' ? R.rpgRows([null, null, null, 'four'], [four]) : null;
  check('3b: moved to Up, the same three are in row 4', !!up && up[3]?.frameIds.join() === 'a,b,c' && up.slice(0, 3).every((r) => r === null), up);
  const rep = typeof R.rpgRows === 'function' ? R.rpgRows(['one', null, null, null], [one]) : null;
  check('3c: a one-frame animation repeats its frame across the row', !!rep && rep[0]?.frameIds.join() === 'z,z,z', rep);
  const gaps = typeof R.rpgRows === 'function' ? R.rpgRows(['four', 'one', null, null], [four, one], (id) => id !== 'a' && id !== 'z') : null;
  check('3d: frames with no image are skipped as the exporter skips them; a row with none is empty',
    !!gaps && gaps[0]?.frameIds.join() === 'b,c,d' && gaps[1] === null, gaps);
  const two = { id: 'two', name: 'two', frames: [{ id: 'p' }, { id: 'q' }] };
  const short = typeof R.rpgRows === 'function' ? R.rpgRows(['two', null, null, null], [two]) : null;
  check('3g: a two-frame animation repeats from its start across the row (AUDIT ext-mediums r1 L7)', !!short && short[0]?.frameIds.join() === 'p,q,p', short);
  check('3h: the cut line, one wording for the card and the exporter (AUDIT ext-mediums r1 L9)', typeof R.rpgCutNote === 'function'
    && R.rpgCutNote('Idle', 4) === '"Idle" has 4 frames but RPG Maker uses 3 per direction. Extra frames ignored.' && R.rpgCutNote('Idle', 3) === null);
}
{
  const cfg = fs.readFileSync(path.join(ROOT, 'src/components/sprites/ExportConfig.tsx'), 'utf8');
  const eng = fs.readFileSync(path.join(ROOT, 'src/lib/exportEngine.ts'), 'utf8');
  check('3i: the exporter warns with rpgCutNote, and the card shows it under the direction while it is mapped (L9)',
    /rpgCutNote\(anim\.name, withImage\)/.test(eng) && /const cut = mapped \? rpgCutNote\(mapped\.name, /.test(cfg) && /\{cut && \(/.test(cfg));
  check('3k: after Download the cut line is not shown again in the warning list, and the list clears when the map changes (AUDIT ext-mediums r2 L9)',
    typeof R.isRpgCutNote === 'function' && R.isRpgCutNote(R.rpgCutNote('Idle', 4)) && !R.isRpgCutNote('Something else.')
    && /setWarnings\(selectedEngine === 'rpgmaker' \? result\.warnings\.filter\(\(w\) => !isRpgCutNote\(w\)\) : result\.warnings\)/.test(cfg)
    && /useEffect\(\(\) => \{\s*setWarnings\(\[\]\);\s*\}, \[rpgMap\]\);/.test(cfg));
  check('3j: each direction list is named by its word: a label tied to it (L10)',
    /<label htmlFor=\{`\$\{dirFieldId\}-\$\{idx\}`\}/.test(cfg) && /id=\{`\$\{dirFieldId\}-\$\{idx\}`\}/.test(cfg) && /const dirFieldId = useId\(\);/.test(cfg));
  check('3e: the download lays out its rows with rpgRows', /const rows = rpgRows\(directionMap, animations, \(id\) => frameDataUrls\.has\(id\)\);/.test(eng));
  check('3f: the RPG Maker preview lays out its rows with rpgRows too, at the RPG frame size',
    /if \(selectedEngine === 'rpgmaker'\) \{\s*const rows = rpgRows\(rpgMap, activeAnimations, \(id\) => frameDataUrls\.has\(id\)\);/.test(cfg)
    && /assembled\.width = rpgFrameW \* RPG_COLS;/.test(cfg) && /assembled\.height = rpgFrameH \* RPG_ROWS;/.test(cfg));
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nall pass (${pass} cases)`);
process.exit(fail ? 1 : 0);
