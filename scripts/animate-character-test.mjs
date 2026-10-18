// scripts/animate-character-test.mjs
//
// Offline tests for the Animate tab's character state
// (src/lib/animateCharacter.ts): an accepted character, pixel edits included,
// survives every resolution change and every cancelled re-prep, and is
// replaced only by Use This, Remove, a new upload or a handoff; Generate stays
// blocked while the sizes differ and says why (Second 049, Oct 16, 2026). And
// an upload's or a handoff's late image decode never replaces a newer choice
// or a character accepted after it (Second 055, Oct 18): the form's own
// callbacks (beginHandoff, beginUpload, removeAll) run here with FileReader
// and Image decodes that the test releases in any order.
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
  createIntentClock,
  beginHandoff,
  beginUpload,
  removeAll,
  preparedIsCurrent,
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
check('a non-square character mismatches at either side',
  sizeMismatch({ ...accepted.character, width: 64, height: 128 }, 64) === true &&
  sizeMismatch({ ...accepted.character, width: 128, height: 64 }, 64) === true &&
  gate({ ...accepted.character, width: 64, height: 128 }, 64).blockedReason === 'This character is 64x128. Choose 64 or prepare it again.');
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
check('a balance that is not a number blocks nothing, as on base (audit r1)',
  gate(accepted.character, 64, { tokenBalance: NaN, tokenCost: 25 }).canGenerate === true &&
  gate(accepted.character, 64, { tokenBalance: NaN, tokenCost: 25 }).blockedReason === null);
check('while generating the reason is null even when blocked',
  gate(accepted.character, 128, { isGenerating: true }).blockedReason === null && gate(accepted.character, 128, { isGenerating: true }).canGenerate === false);

// ── 8. Ownership across late decodes: the form's own callbacks ──
// The form passes { clock, update: setCharState, decode: new Image() }; here
// update applies the same functional updates to a local state, and every
// FileReader read and Image decode waits until the test releases it.
function form() {
  let state = EMPTY_CHARACTER_STATE;
  const clock = createIntentClock();
  const decodes = [];
  const reads = [];
  const errors = [];
  const p = {
    clock,
    update: (fn) => { state = fn(state); },
    decode: (dataUrl, onLoad, onError) => { decodes.push({ dataUrl, onLoad, onError, done: false }); },
  };
  const pick = (list, dataUrl) => {
    const item = list.find((x) => x.dataUrl === dataUrl && !x.done);
    if (!item) throw new Error(`nothing pending for ${dataUrl}`);
    item.done = true;
    return item;
  };
  return {
    get state() { return state; },
    clock,
    errors,
    handoff: (dataUrl, skip) => beginHandoff(p, dataUrl, skip, () => errors.push(`handoff ${dataUrl}`)),
    upload: (dataUrl) =>
      beginUpload(p, (onRead, onReadError) => reads.push({ dataUrl, onRead, onReadError, done: false }), () => errors.push(`upload ${dataUrl}`)),
    remove: () => removeAll(p),
    unmount: () => clock.take(),
    finishRead: (dataUrl) => pick(reads, dataUrl).onRead(dataUrl),
    readFails: (dataUrl) => pick(reads, dataUrl).onReadError(),
    decoded: (dataUrl, w, h) => pick(decodes, dataUrl).onLoad(w, h),
    decodeFails: (dataUrl) => pick(decodes, dataUrl).onError(),
    pendingDecodes: () => decodes.filter((d) => !d.done).map((d) => d.dataUrl),
    useThis: (prep) => { state = acceptPrep(state, prep); },
  };
}
const SHEET_B = 'data:handoff-sheet-b';
const RAW_C = 'data:upload-c';
const EDIT_C = 'data:upload-c-prepared-64-with-pixel-edits';

// Second 055's ordering: handoff B's decode is held; the user uploads C,
// edits and accepts it; then B's decode finishes.
let f = form();
f.handoff(SHEET_B, true);
check('055: the handoff clears the form at once and its decode is pending', f.state.character === null && f.state.pending === null && same(f.pendingDecodes(), [SHEET_B]));
f.upload(RAW_C);
f.finishRead(RAW_C);
f.decoded(RAW_C, 512, 512);
check('055: the newer upload C opens its own prep', f.state.pending?.dataUrl === RAW_C && f.state.pending.skipBgRemoval === false);
f.useThis({ dataUrl: EDIT_C, width: 64, height: 64, edited: true, skipBgRemoval: false, tolerance: 45 });
const acceptedC = f.state.character;
check('055: C accepted with its pixel edits', acceptedC?.dataUrl === EDIT_C && acceptedC.edited === true && f.state.pending === null);
f.decoded(SHEET_B, 256, 256);
check('055: the late B decode leaves the accepted C object in place', f.state.character === acceptedC);
check('055: C keeps its pixels, size, edited flag and source',
  f.state.character?.dataUrl === EDIT_C && f.state.character.width === 64 && f.state.character.height === 64 &&
  f.state.character.edited === true && f.state.character.source.dataUrl === RAW_C && f.state.character.source.tolerance === 45);
check('055: no stale B prep installed over C', f.state.pending === null);
check('055: Generate still enabled with C at 64', gate(f.state.character, 64).canGenerate === true);

// The reverse order: upload C's decode is held, then a handoff B.
f = form();
f.upload(RAW_C);
f.finishRead(RAW_C);
f.handoff(SHEET_B, false);
f.decoded(SHEET_B, 256, 256);
check('newer handoff B opens its prep while the older C decode is pending', f.state.pending?.dataUrl === SHEET_B);
f.decoded(RAW_C, 512, 512);
check('the late C decode does not replace B', f.state.pending?.dataUrl === SHEET_B && f.state.character === null);

// C's file read is the slow part: it finishes after the handoff.
f = form();
f.upload(RAW_C);
f.handoff(SHEET_B, false);
f.decoded(SHEET_B, 256, 256);
f.finishRead(RAW_C);
f.decoded(RAW_C, 512, 512);
check('a late FileReader finish is stale too', f.state.pending?.dataUrl === SHEET_B);

// Two uploads, the older decode finishes last.
f = form();
f.upload('data:c1');
f.finishRead('data:c1');
f.upload('data:c2');
f.finishRead('data:c2');
f.decoded('data:c2', 40, 40);
f.decoded('data:c1', 50, 50);
check('two uploads: the newer one stands', f.state.pending?.dataUrl === 'data:c2' && f.state.pending.width === 40);

// Remove makes every decode in flight stale.
f = form();
f.upload(RAW_C);
f.finishRead(RAW_C);
f.decoded(RAW_C, 512, 512);
f.useThis({ dataUrl: PREP_64, width: 64, height: 64, edited: false, skipBgRemoval: false, tolerance: DEFAULT_BG_TOLERANCE });
f.upload('data:another');
f.finishRead('data:another');
f.remove();
f.decoded('data:another', 64, 64);
check('Remove during an upload decode: the form stays empty', same(f.state, EMPTY_CHARACTER_STATE));
f = form();
f.handoff(SHEET_B, false);
f.remove();
f.decoded(SHEET_B, 256, 256);
check('Remove during a handoff decode: the form stays empty', same(f.state, EMPTY_CHARACTER_STATE));

// Unmount: the form's cleanup takes a ticket.
f = form();
f.handoff(SHEET_B, false);
f.unmount();
f.decoded(SHEET_B, 256, 256);
check('a decode after unmount changes nothing', same(f.state, EMPTY_CHARACTER_STATE));

// The current choices still work.
f = form();
f.handoff(SHEET_B, true);
f.decoded(SHEET_B, 256, 256);
check('current handoff: its prep opens with its size and the skip choice',
  f.state.character === null && f.state.pending?.dataUrl === SHEET_B && f.state.pending.width === 256 &&
  f.state.pending.skipBgRemoval === true && f.state.pending.tolerance === DEFAULT_BG_TOLERANCE);
f = form();
f.upload(RAW_C);
f.finishRead(RAW_C);
f.decoded(RAW_C, 512, 512);
f.useThis({ dataUrl: PREP_64, width: 64, height: 64, edited: false, skipBgRemoval: false, tolerance: DEFAULT_BG_TOLERANCE });
f.handoff(SHEET_B, false);
check('a current handoff replaces an accepted character at once (unchanged policy)', f.state.character === null);
f.decoded(SHEET_B, 256, 256);
check('and opens its prep when decoded', f.state.pending?.dataUrl === SHEET_B);

// Decode errors call the form's error handler and start nothing.
f = form();
f.handoff(SHEET_B, false);
f.decodeFails(SHEET_B);
check('handoff decode error: reported once, form empty', same(f.errors, [`handoff ${SHEET_B}`]) && same(f.state, EMPTY_CHARACTER_STATE));
f = form();
f.upload(RAW_C);
f.finishRead(RAW_C);
f.decodeFails(RAW_C);
check('upload decode error: reported once, nothing opened', same(f.errors, [`upload ${RAW_C}`]) && same(f.state, EMPTY_CHARACTER_STATE));

// Errors of a stale choice are as stale as its success (audit r1).
f = form();
f.upload(RAW_C);
f.finishRead(RAW_C);
f.handoff(SHEET_B, false);
f.decodeFails(RAW_C);
check('a stale upload decode failure is not reported', f.errors.length === 0);
f.decodeFails(SHEET_B);
check('the current handoff decode failure is', same(f.errors, [`handoff ${SHEET_B}`]));
f = form();
f.handoff(SHEET_B, false);
f.upload(RAW_C);
f.decodeFails(SHEET_B);
check('a stale handoff decode failure is not reported', f.errors.length === 0);
f = form();
f.upload(RAW_C);
f.readFails(RAW_C);
check('a failed file read is reported and opens nothing', same(f.errors, [`upload ${RAW_C}`]) && same(f.state, EMPTY_CHARACTER_STATE));
f = form();
f.upload(RAW_C);
f.upload('data:c2');
f.readFails(RAW_C);
check('a stale file read failure is not reported', f.errors.length === 0);

// Auto-Prep's fit: Use This takes only a fit made for the current size, padding and base.
const fit = { dataUrl: PREP_64, size: 64, pct: 100, baseVersion: 1 };
check('fit current when size, padding and base match', preparedIsCurrent(fit, { size: 64, pct: 100, baseVersion: 1 }) === true);
check('fit stale after a size change (the audit r1 P2)', preparedIsCurrent(fit, { size: 256, pct: 100, baseVersion: 1 }) === false);
check('fit stale after a padding change', preparedIsCurrent(fit, { size: 64, pct: 75, baseVersion: 1 }) === false);
check('fit stale after a base change (tolerance or skip)', preparedIsCurrent(fit, { size: 64, pct: 100, baseVersion: 2 }) === false);
check('no fit yet is not current', preparedIsCurrent(null, { size: 64, pct: 100, baseVersion: 1 }) === false);

// The clock itself.
const clk = createIntentClock();
const t1 = clk.take();
const t2 = clk.take();
check('clock: only the latest ticket is current', t2 > t1 && clk.isCurrent(t2) && !clk.isCurrent(t1));

console.log(failed === 0 ? 'all pass' : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
