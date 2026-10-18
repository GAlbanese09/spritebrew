// scripts/animate-character-test.mjs
//
// Offline tests for the Animate tab's character state
// (src/lib/animateCharacter.ts): an accepted character, pixel edits included,
// survives every resolution change and every cancelled re-prep, and is
// replaced only by Use This, Remove, a new upload or a handoff; Generate stays
// blocked while the sizes differ and says why. Second 049 (Oct 16, 2026).
// Run from the repo root: `node scripts/animate-character-test.mjs`. Bundles
// the module with esbuild into local/.animate-character-test/ (gitignored).
// Prints only case names and pass or fail. No network, no DOM.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.animate-character-test', 'animateCharacter.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/animateCharacter.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: OUT,
  logLevel: 'silent',
});
const {
  EMPTY_CHARACTER_STATE,
  DEFAULT_BG_TOLERANCE,
  startPrep,
  startReprep,
  acceptPrep,
  cancelPrep,
  removeCharacter,
  sizeMismatch,
  generateGate,
} = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Synthetic images: strings stand in for data URLs.
const RAW = 'data:raw-upload-512';
const PREP_64 = 'data:prepared-64';
const EDIT_64 = 'data:prepared-64-with-pixel-edits';
const PREP_128 = 'data:prepared-128';
const SIZES = [32, 64, 128, 256];

const upload = { dataUrl: RAW, width: 512, height: 512, skipBgRemoval: false, tolerance: DEFAULT_BG_TOLERANCE };
const gate = (character, selectedResolution, extra = {}) =>
  generateGate({
    character,
    selectedResolution,
    isCustomAction: false,
    motionPrompt: '',
    tokenBalance: 10,
    tokenCost: 1,
    isGenerating: false,
    ...extra,
  });

// ── 1. Accept a visibly edited character at 64 ──
let s = startPrep(upload);
check('upload opens Auto-Prep with no character', s.character === null && s.pending?.dataUrl === RAW);
s = acceptPrep(s, { dataUrl: EDIT_64, width: 64, height: 64, edited: true, skipBgRemoval: false, tolerance: 45 });
check('Use This lands the edited image as the character', s.character?.dataUrl === EDIT_64 && s.character.edited === true);
check('Use This closes Auto-Prep', s.pending === null);
check('the source is kept with the settings Use This ended on',
  s.character.source.dataUrl === RAW && s.character.source.tolerance === 45 && s.character.source.skipBgRemoval === false);
check('Generate enabled at 64', gate(s.character, 64).canGenerate === true && gate(s.character, 64).blockedReason === null);
const accepted = s;

// ── 2. Change the resolution: every path is the same input ──
// The picker, a template load, the restored config and the mode snap all end
// in a new selectedResolution; the state is not consulted, let alone changed.
for (const res of SIZES) {
  const mismatch = res !== 64;
  check(`${res}: mismatch is ${mismatch} and the character is untouched`,
    sizeMismatch(accepted.character, res) === mismatch && accepted.character.dataUrl === EDIT_64);
  const g = gate(accepted.character, res);
  check(`${res}: Generate ${mismatch ? 'blocked with the size' : 'enabled'}`,
    mismatch
      ? g.canGenerate === false && g.sizeWarning === true &&
        g.blockedReason === 'This character is 64x64. Choose 64 or prepare it again.'
      : g.canGenerate === true && g.sizeWarning === false && g.blockedReason === null);
}
check('64 -> 128 -> 64: the edit is still there (no state, nothing to lose)',
  gate(accepted.character, 128).canGenerate === false && gate(accepted.character, 64).canGenerate === true &&
  accepted.character.dataUrl === EDIT_64);

// ── 3. Prepare at 128, then keep the 64 ──
let r = startReprep(accepted);
check('Prepare at N reopens Auto-Prep on the kept source', r.pending?.dataUrl === RAW && r.pending.tolerance === 45);
check('the edited character stays while the re-prep is open', r.character?.dataUrl === EDIT_64 && r.character.edited === true);
check('Generate still blocked at 128 during the re-prep', gate(r.character, 128).canGenerate === false);
const kept = cancelPrep(r);
check('Keep 64x64 closes Auto-Prep and leaves the edit', kept.pending === null && kept.character?.dataUrl === EDIT_64 && kept.character.edited === true);
check('back at 64 after the cancel, Generate enabled with the edited image', gate(kept.character, 64).canGenerate === true);
check('cancel with nothing open is a no-op', cancelPrep(kept) === kept);

// ── 4. Prepare at 128, then Use This: the explicit replacement ──
r = startReprep(accepted);
const replaced = acceptPrep(r, { dataUrl: PREP_128, width: 128, height: 128, edited: false, skipBgRemoval: true, tolerance: 45 });
check('Use This on the re-prep replaces the character', replaced.character?.dataUrl === PREP_128 && replaced.character.width === 128 && replaced.character.edited === false);
check('the source carries the settings of the new prep', replaced.character.source.dataUrl === RAW && replaced.character.source.skipBgRemoval === true);
check('Generate enabled at 128 after the replacement', gate(replaced.character, 128).canGenerate === true);
check('the previous state object was not mutated', accepted.character.dataUrl === EDIT_64 && accepted.pending === null);

// ── 5. Ordinary unedited re-prep still works ──
let u = acceptPrep(startPrep(upload), { dataUrl: PREP_64, width: 64, height: 64, edited: false, skipBgRemoval: false, tolerance: DEFAULT_BG_TOLERANCE });
check('unedited 64 accepted', u.character?.edited === false && gate(u.character, 64).canGenerate === true);
check('unedited at 128: blocked, character kept', gate(u.character, 128).canGenerate === false && u.character.dataUrl === PREP_64);
u = acceptPrep(startReprep(u), { dataUrl: PREP_128, width: 128, height: 128, edited: false, skipBgRemoval: false, tolerance: DEFAULT_BG_TOLERANCE });
check('unedited re-prep at 128 accepted', u.character?.dataUrl === PREP_128 && gate(u.character, 128).canGenerate === true);

// ── 6. Remove, a new upload and a handoff are the explicit replacements ──
check('Remove empties everything, re-prep open or not', same(removeCharacter(), EMPTY_CHARACTER_STATE) && same(removeCharacter(startReprep(accepted)), EMPTY_CHARACTER_STATE));
const fresh = { dataUrl: 'data:another-upload', width: 100, height: 80, skipBgRemoval: true, tolerance: DEFAULT_BG_TOLERANCE };
const after = startPrep(fresh);
check('a new upload or handoff replaces the character and opens Auto-Prep on the new source',
  after.character === null && after.pending?.dataUrl === 'data:another-upload' && after.pending.skipBgRemoval === true);
check('Upload Different on a fresh prep leaves the form empty', same(cancelPrep(after), EMPTY_CHARACTER_STATE));
check('Prepare at N with no character is a no-op', startReprep(EMPTY_CHARACTER_STATE) === EMPTY_CHARACTER_STATE);
check('Use This with nothing open is a no-op', acceptPrep(EMPTY_CHARACTER_STATE, { dataUrl: PREP_64, width: 64, height: 64, edited: false, skipBgRemoval: false, tolerance: 30 }) === EMPTY_CHARACTER_STATE);

// ── 7. The Generate gate's other reasons, in order ──
check('no character: "Add a character first"', same(gate(null, 64), { canGenerate: false, sizeWarning: false, blockedReason: 'Add a character first' }));
check('size beats the motion prompt and tokens',
  gate(accepted.character, 128, { isCustomAction: true, tokenBalance: 0 }).blockedReason === 'This character is 64x64. Choose 64 or prepare it again.');
check('custom action without a prompt: "Describe the motion first"',
  gate(accepted.character, 64, { isCustomAction: true, motionPrompt: '  ' }).blockedReason === 'Describe the motion first');
check('custom action with a prompt is enabled',
  gate(accepted.character, 64, { isCustomAction: true, motionPrompt: 'waves' }).canGenerate === true);
check('not enough tokens: "Need N more tokens"',
  same(gate(accepted.character, 64, { tokenBalance: 2, tokenCost: 5 }), { canGenerate: false, sizeWarning: false, blockedReason: 'Need 3 more tokens' }));
check('exactly enough tokens is enabled', gate(accepted.character, 64, { tokenBalance: 5, tokenCost: 5 }).canGenerate === true);
check('while generating the reason is null even when blocked',
  gate(accepted.character, 128, { isGenerating: true }).blockedReason === null && gate(accepted.character, 128, { isGenerating: true }).canGenerate === false);

console.log(failed === 0 ? 'all pass' : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
