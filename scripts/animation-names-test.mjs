// scripts/animation-names-test.mjs
//
// Offline tests for the names and types of animations the user creates in
// Sheet Tools (src/lib/animationNames.ts). Run from the repo root:
// `node scripts/animation-names-test.mjs`. Bundles the module with esbuild
// into local/.animation-names-test/ (gitignored). Prints only case names and
// pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.animation-names-test', 'animationNames.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/animationNames.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: OUT,
  logLevel: 'silent',
});
const { nextAnimationName, defaultAnimationType, animationPreset } = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

check('first name is the base', nextAnimationName('Idle', []) === 'Idle');
check('second gets 2', nextAnimationName('Idle', ['Idle']) === 'Idle 2');
check('third gets 3', nextAnimationName('Idle', ['Idle', 'Idle 2']) === 'Idle 3');
check('fills a gap', nextAnimationName('Idle', ['Idle', 'Idle 3']) === 'Idle 2');
check('other names do not count', nextAnimationName('Idle', ['Walk', 'Run']) === 'Idle');
check('case and spaces count as taken', nextAnimationName('Idle', ['idle ', ' IDLE 2']) === 'Idle 3');
check('empty base falls back to Animation', nextAnimationName('   ', []) === 'Animation');
check('existing names may be any iterable', nextAnimationName('Walk', new Set(['Walk'])) === 'Walk 2');

check('no metadata: idle', defaultAnimationType(null) === 'idle');
check('unknown type: idle', defaultAnimationType({ animationType: 'nope' }) === 'idle');
check('known type is kept', defaultAnimationType({ animationType: 'walk' }) === 'walk');
check('undefined type: idle', defaultAnimationType({}) === 'idle');

check('preset for a known id', animationPreset('run').label === 'Run' && animationPreset('run').defaultFps === 10);
check('preset for an unknown id is Idle', animationPreset('zzz').id === 'idle');

process.exit(failed ? 1 : 0);
