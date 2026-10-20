// scripts/export-names-test.mjs
//
// Offline tests for the unique export names of a sheet's animation groups
// (src/lib/exportNames.ts). Run from the repo root:
// `node scripts/export-names-test.mjs`. Bundles the module with esbuild into
// local/.export-names-test/ (gitignored). Prints only case names and pass or
// fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.export-names-test');

await build({
  entryPoints: {
    exportNames: path.join(ROOT, 'src/lib/exportNames.ts'),
    downloadUtils: path.join(ROOT, 'src/lib/downloadUtils.ts'),
  },
  bundle: true, format: 'esm', platform: 'node', outdir: OUT, logLevel: 'silent',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
  external: ['jszip'],
});
const load = (name) => import(pathToFileURL(path.join(OUT, `${name}.mjs`)).href);
const { exportNames } = await load('exportNames');
const { sanitizeFilename } = await load('downloadUtils');

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
const files = (names) => exportNames(names).map((n) => n.file);
const labels = (names) => exportNames(names).map((n) => n.label);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unique = (xs) => new Set(xs).size === xs.length;

// ── No repeats: today's names, byte for byte ──
{
  const names = ['Walk', 'Idle Loop', 'Attack-1', 'jump.up'];
  check('no repeats: file bases are sanitizeFilename of each name',
    eq(files(names), names.map(sanitizeFilename)));
  check('no repeats: labels are the original names', eq(labels(names), names));
  check('a single group keeps its name', eq(exportNames(['Idle']), [{ file: 'idle', label: 'Idle' }]));
  check('no groups gives no names', eq(exportNames([]), []));
}

// ── Two "Idle" groups ──
{
  const names = ['Idle', 'Idle'];
  check('two Idle groups: file bases idle and idle_2', eq(files(names), ['idle', 'idle_2']));
  check('two Idle groups: labels Idle and Idle 2', eq(labels(names), ['Idle', 'Idle 2']));
  check('three Idle groups count up', eq(files(['Idle', 'Idle', 'Idle']), ['idle', 'idle_2', 'idle_3']));
}

// ── "Idle" and "idle" (sanitizeFilename lowercases) ──
{
  const names = ['Idle', 'idle'];
  check('Idle and idle: file bases do not collide', eq(files(names), ['idle', 'idle_2']));
  check('Idle and idle: labels are not exact repeats, so both stay as typed', eq(labels(names), ['Idle', 'idle']));
  check('Idle, idle and IDLE: three distinct bases', eq(files(['Idle', 'idle', 'IDLE']), ['idle', 'idle_2', 'idle_3']));
}

// ── A group literally named "Idle 2" next to two "Idle" groups ──
{
  const after = ['Idle', 'Idle', 'Idle 2'];
  check('Idle, Idle, Idle 2: the second Idle skips idle_2, which the third group owns',
    eq(files(after), ['idle', 'idle_3', 'idle_2']));
  check('Idle, Idle, Idle 2: labels never take another group\'s own name',
    eq(labels(after), ['Idle', 'Idle 3', 'Idle 2']));
  const before = ['Idle 2', 'Idle', 'Idle'];
  check('Idle 2, Idle, Idle: same rule when the owner comes first',
    eq(files(before), ['idle_2', 'idle', 'idle_3']) && eq(labels(before), ['Idle 2', 'Idle', 'Idle 3']));
  const between = ['Idle', 'Idle 2', 'Idle'];
  check('Idle, Idle 2, Idle: the owner in the middle keeps its name',
    eq(files(between), ['idle', 'idle_2', 'idle_3']) && eq(labels(between), ['Idle', 'Idle 2', 'Idle 3']));
  const twoOfEach = ['Idle', 'Idle', 'Idle 2', 'Idle 2'];
  check('two Idle and two Idle 2: all four unique',
    unique(files(twoOfEach)) && unique(labels(twoOfEach)) && eq(files(twoOfEach), ['idle', 'idle_3', 'idle_2', 'idle_2_2']));
}

// ── All-symbol names ──
{
  check('an all-symbol name gets the base "animation"', eq(files(['***']), ['animation']));
  check('an all-symbol name keeps its label', eq(labels(['***']), ['***']));
  check('two all-symbol names: animation and animation_2', eq(files(['***', '???']), ['animation', 'animation_2']));
  check('an all-symbol name beside a group named "animation": no collision',
    eq(files(['animation', '***']), ['animation', 'animation_2']));
  check('an empty name also gets "animation"', eq(files(['']), ['animation']));
}

// ── Mixed sheet: everything unique, order preserved ──
{
  const names = ['Walk', 'Idle', 'walk', 'Idle', 'Walk 2', 'Run', 'run!', 'Run'];
  const out = exportNames(names);
  check('mixed sheet: file bases unique', unique(out.map((n) => n.file)));
  check('mixed sheet: labels unique', unique(out.map((n) => n.label)));
  check('mixed sheet: one entry per group, in order', out.length === names.length && out[5].label === 'Run' && out[7].label === 'Run 2');
  check('mixed sheet: a repeat compared on the sanitized form (run! is run)', out[6].file === 'run_2' && out[7].file === 'run_3');
}

process.exit(failed ? 1 : 0);
