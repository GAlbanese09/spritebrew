// scripts/export-presets-test.mjs
//
// Offline tests for src/lib/exportPresets.ts (W3; HQ 2026-11-04-026, -028):
// the engine presets on the Export page, the whole-number rule for its
// number fields (fractional sizes put every format's rects half a pixel
// off, HQ 2026-11-04-004), and the tag ranges TexturePacker writes from the
// frames actually on the sheet. Run from the repo root:
// `node scripts/export-presets-test.mjs`. Bundles the modules with esbuild
// into local/.export-presets-test/ (gitignored). Prints only case names and
// pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'local', '.export-presets-test');

async function load(entry, name) {
  const outfile = path.join(OUT_DIR, `${name}.mjs`);
  await build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
    alias: { '@': path.join(ROOT, 'src') },
  });
  return import(pathToFileURL(outfile).href);
}

const { ENGINE_PRESETS, enginePreset, wholeNumberIn, tagRanges, wholePx, godotFloat, godotString, nextPresetId } = await load('src/lib/exportPresets.ts', 'exportPresets');
const { ENGINE_TARGETS } = await load('src/lib/constants.ts', 'constants');

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. The presets.
const targetIds = new Set(ENGINE_TARGETS.map((t) => t.id));
check('three presets: Godot 4, Unity, GameMaker, in that order',
  same(ENGINE_PRESETS.map((p) => p.id), ['godot', 'unity', 'gamemaker']), ENGINE_PRESETS.map((p) => p.id));
check('Godot 4 exports SpriteFrames (.tres)', enginePreset('godot')?.target === 'godot-tres');
check('Unity exports the .aseprite file (Aseprite Importer)', enginePreset('unity')?.target === 'aseprite');
check('GameMaker exports strips', enginePreset('gamemaker')?.target === 'gamemaker');
check('every preset names an existing export target',
  ENGINE_PRESETS.every((p) => targetIds.has(p.target)), ENGINE_PRESETS.map((p) => p.target));
check('every preset: no padding, no power of two, data file on',
  ENGINE_PRESETS.every((p) => p.padding === 0 && p.powerOfTwo === false && p.includeMetadata === true));
check('every preset has a label and an import note',
  ENGINE_PRESETS.every((p) => p.label.length > 0 && p.note.length > 40));
check('the Unity note names the package to add',
  /2D Aseprite Importer/.test(enginePreset('unity').note) && /com\.unity\.2d\.aseprite/.test(enginePreset('unity').note));
check('the Unity note names the PNG grid fallback', /slice the PNG by cell size/.test(enginePreset('unity').note));
check('the GameMaker note explains the _stripN name', /_strip8/.test(enginePreset('gamemaker').note));
check('no em or en dash in any note or label',
  ENGINE_PRESETS.every((p) => !/[\u2013\u2014]/.test(p.note + p.label)));
check('an unknown preset id finds nothing', enginePreset('rpgmaker') === undefined && enginePreset('') === undefined);

// 2. Whole numbers.
check('32.5 rounds to 33', wholeNumberIn('32.5', 1) === 33);
check('32.4 rounds to 32', wholeNumberIn('32.4', 1) === 32);
check('a whole number is kept', wholeNumberIn('48', 1) === 48 && wholeNumberIn(64, 1) === 64);
check('empty becomes the minimum', wholeNumberIn('', 1) === 1 && wholeNumberIn('', 0, 4) === 0);
check('unreadable becomes the minimum', wholeNumberIn('abc', 1) === 1 && wholeNumberIn(Number.NaN, 1) === 1);
check('below the minimum is raised to it', wholeNumberIn('-3', 1) === 1 && wholeNumberIn('0.4', 1) === 1);
check('padding stays within 0 to 4', wholeNumberIn('9', 0, 4) === 4 && wholeNumberIn('2.6', 0, 4) === 3 && wholeNumberIn('-1', 0, 4) === 0);
check('infinity becomes the minimum', wholeNumberIn('Infinity', 1) === 1);

// 3. Tag ranges from the frames written.
check('two animations, all frames written',
  same(tagRanges([4, 3]), [{ index: 0, from: 0, to: 3 }, { index: 1, from: 4, to: 6 }]), tagRanges([4, 3]));
check('a missing frame shortens only its own tag (4 frames, 1 without an image)',
  same(tagRanges([3, 4]), [{ index: 0, from: 0, to: 2 }, { index: 1, from: 3, to: 6 }]), tagRanges([3, 4]));
check('an animation with nothing written gets no tag, the next starts where the last ended',
  same(tagRanges([2, 0, 5]), [{ index: 0, from: 0, to: 1 }, { index: 2, from: 2, to: 6 }]), tagRanges([2, 0, 5]));
check('no frames at all, no tags', same(tagRanges([]), []) && same(tagRanges([0, 0]), []));
check('the last tag ends on the last frame written',
  (() => { const c = [5, 1, 7]; const t = tagRanges(c); return t[t.length - 1].to === c.reduce((a, b) => a + b, 0) - 1; })());

// 4. Whole pixels, Godot literals, the preset that stays chosen.
check('wholePx truncates like a canvas (32.5 to 32, 32.9 to 32)', wholePx(32.5) === 32 && wholePx(32.9) === 32 && wholePx(48) === 48);
check('wholePx is at least 1, and 1 for nonsense', wholePx(0.4) === 1 && wholePx(-5) === 1 && wholePx(Number.NaN) === 1);
check('godotFloat: 8 is 8.0, 12.5 is 12.5', godotFloat(8) === '8.0' && godotFloat(12.5) === '12.5' && godotFloat(30) === '30.0');
check('godotString escapes backslash, quote and line breaks',
  godotString('a"b\\c') === 'a\\"b\\\\c' && godotString('x\ny') === 'x\\ny' && godotString('Walk') === 'Walk');
check('a preset pick chooses it', nextPresetId(null, { type: 'pickPreset', id: 'unity' }) === 'unity');
check('an unknown preset pick changes nothing', nextPresetId('godot', { type: 'pickPreset', id: 'rpgmaker' }) === 'godot');
check('a format picked by hand clears the preset', nextPresetId('godot', { type: 'pickFormat' }) === null);
check('a setting changed by hand clears the preset', nextPresetId('unity', { type: 'changeSetting' }) === null);

// 5. Wiring, read from the sources.
const exportConfig = fs.readFileSync(path.join(ROOT, 'src/components/sprites/ExportConfig.tsx'), 'utf8');
const exportEngine = fs.readFileSync(path.join(ROOT, 'src/lib/exportEngine.ts'), 'utf8');
check('no number field on Export keeps a raw Number() of its input',
  !/set\w+\([^)]*Number\(e\.target\.value\)/.test(exportConfig));
check('the five number fields use wholeNumberIn',
  (exportConfig.match(/wholeNumberIn\(e\.target\.value/g) ?? []).length === 5);
check('TexturePacker tags come from tagRanges, not anim.frames.length',
  /tagRanges\(written\)/.test(exportEngine) && !/const count = anim\.frames\.length;/.test(exportEngine));
const slicerConfig = fs.readFileSync(path.join(ROOT, 'src/components/sprites/SlicerConfig.tsx'), 'utf8');
check('the slicer\'s frame width and height take whole numbers',
  (slicerConfig.match(/wholeNumberIn\(e\.target\.value, 1\)/g) ?? []).length === 2 && !/setFrame(Width|Height)\(Math\.max\(1, Number\(/.test(slicerConfig));
check('a format card click and the three settings clear the preset',
  (exportConfig.match(/presetEvent\(\{ type: 'pickFormat' \}\)/g) ?? []).length === 1 &&
  (exportConfig.match(/presetEvent\(\{ type: 'changeSetting' \}\)/g) ?? []).length === 3);
check('the format cards say which one is chosen (aria-pressed, type button)', /type="button"\s+aria-pressed=\{active\}/.test(exportConfig));
check('the note is one live region that is always rendered', (exportConfig.match(/aria-live="polite"/g) ?? []).length === 1 && !/activePreset \? \(/.test(exportConfig));
check('every exporter draws whole-pixel frame sizes', (exportEngine.match(/= wholePx\(opts\.resize(Width|Height) \?\? opts\.frame(Width|Height)\)/g) ?? []).length === 10);
check('the presets row is on the Export page', /ENGINE_PRESETS\.map/.test(exportConfig) && /Quick setup: pick your engine/.test(exportConfig));
check('the format cards read as the other way in (George, Nov 4)', /Or pick a format yourself/.test(exportConfig) && !/>\s*Export Format\s*</.test(exportConfig));

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall pass');
