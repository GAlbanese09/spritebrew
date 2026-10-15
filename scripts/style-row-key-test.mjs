// scripts/style-row-key-test.mjs
//
// Offline test for resolveStyleRowKey (src/lib/styleRowKey.ts). Run from the
// repo root: `node scripts/style-row-key-test.mjs`. Writes only its esbuild
// bundle, to local/.style-row-key-test (gitignored), and prints only case
// names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.style-row-key-test', 'styleRowKey.mjs');
await build({
  entryPoints: [path.join(ROOT, 'src', 'lib', 'styleRowKey.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const { resolveStyleRowKey } = await import(pathToFileURL(OUT).href);

// The table keys AnimationPanel.tsx looks up (a subset is enough here).
const KEYS = new Set(['four_angle_walking', 'walking_and_idle', 'small_sprites', 'any_animation', '8_dir_rotation', 'vfx']);

const cases = [
  ['anim-4angle-walking resolves to four_angle_walking', () => resolveStyleRowKey('anim-4angle-walking') === 'four_angle_walking'],
  ['animation__walking_and_idle resolves to walking_and_idle', () => resolveStyleRowKey('animation__walking_and_idle') === 'walking_and_idle'],
  ['any_animation_walking is unchanged', () => resolveStyleRowKey('any_animation_walking') === 'any_animation_walking'],
  ['pro-default matches no table key', () => !KEYS.has(resolveStyleRowKey('pro-default'))],
];
let failed = 0;
for (const [name, fn] of cases) {
  const ok = fn();
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
}
process.exit(failed ? 1 : 0);
