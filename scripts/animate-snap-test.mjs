// scripts/animate-snap-test.mjs
//
// Offline tests for the Animate form's snap-skip decision
// (src/lib/animateConfig.ts: snapSkips, resolutionModeForAction). Run from
// the repo root: `node scripts/animate-snap-test.mjs`. Bundles the module
// with esbuild into local/.animate-snap-test/ (gitignored). Prints only case
// names and pass or fail.
//
// Background: AnimateForm arms one skip ref per snap effect when it restores
// a saved config or loads a template. A ref armed for an effect that never
// fires (the restored action equals the current one, so React drops the
// identical set) stays armed and swallows the user's next action change.
// snapSkips must therefore say "padding" only when the action changes and
// "resolution" only when the resolution mode object changes.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.animate-snap-test', 'animateConfig.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/animateConfig.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: OUT,
  logLevel: 'silent',
  tsconfig: path.join(ROOT, 'tsconfig.json'),
});
const { snapSkips, resolutionModeForAction, ACTION_STYLE_MAP, DEFAULT_ACTION } =
  await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

const same = (a, b) => a.padding === b.padding && a.resolution === b.resolution;
const NONE = { padding: false, resolution: false };
const PADDING_ONLY = { padding: true, resolution: false };

// ── Real registry ──

check('default action is walking', DEFAULT_ACTION === 'walking');
check('same action: no skips', same(snapSkips('walking', 'walking'), NONE));
check('same non-default action: no skips', same(snapSkips('attack', 'attack'), NONE));
check('different action, same mode: padding only', same(snapSkips('attack', 'walking'), PADDING_ONLY));
check('different action the other way: padding only', same(snapSkips('walking', 'attack'), PADDING_ONLY));

const actions = Object.keys(ACTION_STYLE_MAP);
check('registry has the eight Animate actions', actions.length === 8);
const walkingMode = resolutionModeForAction('walking');
check('every action maps to one mode object today',
  actions.every((a) => resolutionModeForAction(a) === walkingMode));
check('that mode is variable 32 to 256',
  walkingMode.kind === 'variable' && walkingMode.min === 32 && walkingMode.max === 256);
check('an unknown action falls back to the walking mode object',
  resolutionModeForAction('not_an_action') === walkingMode);
check('every pair of real actions: resolution never, padding only when different',
  actions.every((a) => actions.every((b) => same(snapSkips(a, b), a === b ? NONE : PADDING_ONLY))));

// ── Stubbed resolver: a future action with its own mode ──

const LOCKED = { kind: 'locked', size: 64 };
const stub = (a) => (a === 'future_locked' ? LOCKED : walkingMode);
check('stub: different action, different mode: both skips',
  same(snapSkips('future_locked', 'walking', stub), { padding: true, resolution: true }));
check('stub: same locked action: no skips',
  same(snapSkips('future_locked', 'future_locked', stub), NONE));
check('stub: two actions sharing the variable mode: padding only',
  same(snapSkips('attack', 'walking', stub), PADDING_ONLY));
check('stub: an equal but distinct mode object counts as a change (identity, as useMemo sees it)',
  same(snapSkips('attack', 'walking', (a) => (a === 'attack' ? { ...walkingMode } : walkingMode)),
    { padding: true, resolution: true }));

process.exit(failed ? 1 : 0);
