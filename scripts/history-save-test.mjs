// scripts/history-save-test.mjs
//
// Offline tests for the local generation history (src/lib/generationHistory.ts),
// which feeds Recent on /generate: addToHistory resolves whether it saved,
// and tells its listeners either way, so Recent shows a new entry once it is
// saved and the result card can say when it was not (history gap, HQ
// 2026-10-27-017). Run from the repo root: `node scripts/history-save-test.mjs`.
// Bundles the module with esbuild into local/.history-save-test/ (gitignored),
// with localStorage and Image scripted. Prints only case names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.history-save-test', 'generationHistory.mjs');

// localStorage refuses a value longer than `limit`, a stand-in for the quota.
// Image never loads, so a thumbnail falls back to the image itself.
const store = new Map();
let limit = Infinity;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    if (String(v).length > limit) throw new Error('QuotaExceededError');
    store.set(k, String(v));
  },
  removeItem: (k) => { store.delete(k); },
};
globalThis.window = globalThis;
globalThis.Image = class {
  set src(_value) { queueMicrotask(() => this.onerror && this.onerror()); }
};

await build({
  entryPoints: [path.join(ROOT, 'src/lib/generationHistory.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const { addToHistory, loadHistory, onHistoryChange, failedSaveAfter } = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

const USER = 'user_1';
const KEY = `spritebrew_generations_${USER}`;
const image = (n) => `data:image/png;base64,${String(n).repeat(4000)}`;
const input = (prompt, n) => ({ userId: USER, prompt, style: 'plus-classic', mode: 'create', fullImageDataUrl: image(n) });
const prompts = () => loadHistory(USER).map((e) => e.prompt).join();
const heard = [];
const off = onHistoryChange((change) => heard.push(change));

// 1. A save that fits.
let saved = await addToHistory(input('first', 1));
check('a save that fits resolves true, and the entry is in the history', saved === true && prompts() === 'first', { saved, prompts: prompts() });
const told = (c, saved, n) => c !== undefined && c.saved === saved && c.image === image(n) && c.userId === USER;
check('... and the listeners hear it: saved, with its user and image', heard.length === 1 && told(heard[0], true, 1), heard.length);

// 2. Room only for a history without full images: saved, without them.
limit = store.get(KEY).length + 6000;
saved = await addToHistory(input('second', 2));
const entries = loadHistory(USER);
check('a save that fits only without full images resolves true, and keeps the thumbnails',
  saved === true && prompts() === 'second,first' && entries.every((e) => e.fullImageDataUrl === undefined && e.thumbnailDataUrl),
  { saved, prompts: prompts(), full: entries.map((e) => e.fullImageDataUrl !== undefined) });
check('... and the listeners hear it saved', heard.length === 2 && told(heard[1], true, 2), heard.length);

// 3. No room at all: nothing changes, and the failure names the image.
limit = 100;
const before = store.get(KEY);
saved = await addToHistory(input('third', 3));
check('a save that cannot fit resolves false, and the history is unchanged', saved === false && store.get(KEY) === before, { saved });
check('... and the listeners hear the failure, for that user and image', heard.length === 3 && told(heard[2], false, 3),
  { heard: heard.length, saved: heard[2] && heard[2].saved });

// 4. An unsubscribed listener hears nothing more.
off();
limit = Infinity;
await addToHistory(input('fourth', 4));
check('an unsubscribed listener hears nothing more', heard.length === 3 && prompts().startsWith('fourth'), { heard: heard.length, prompts: prompts() });

// 5. One entry per job: when two tabs of this browser finish the same job,
// the second save is skipped.
const heardAgain = [];
const offAgain = onHistoryChange((change) => heardAgain.push(change));
const count = () => loadHistory(USER).length;
const before5 = count();
const first = await addToHistory({ ...input('job a', 5), jobId: 'job-a' });
const second = await addToHistory({ ...input('job a, other tab', 5), jobId: 'job-a' });
const withA = loadHistory(USER).filter((e) => e.jobId === 'job-a');
check('a second save for the same job is skipped: one entry, kept with its job id, and both resolve true',
  first === true && second === true && withA.length === 1 && withA[0].prompt === 'job a' && count() === before5 + 1,
  { first, second, withA: withA.length, added: count() - before5 });
check('... and the listeners hear both as saved', heardAgain.length === 2 && heardAgain.every((c) => c.saved === true), heardAgain.length);
await addToHistory({ ...input('job b', 6), jobId: 'job-b' });
await addToHistory(input('stream path', 7));
await addToHistory(input('stream path', 7));
check('another job, and each save with no job id (the stream path), get their own entries', count() === before5 + 4, { added: count() - before5 });
offAgain();

// 6. What a result card notes (failedSaveAfter), in the two delayed-save
// orders Second 094 found: only outcomes for the card's user count, and a
// save clears the note only for the same image.
const A = 'user_a';
const B = 'user_b';
const outcome = (userId, n, saved) => ({ userId, image: image(n), saved });
let noted = failedSaveAfter(null, outcome(A, 8, false), A);
check("notes: a failure for the card's user is noted, with its image", noted !== null && noted.userId === A && noted.image === image(8), noted && noted.userId);
check("notes: A's late failure, heard by a card now showing B, is not noted for B",
  failedSaveAfter(null, outcome(A, 8, false), B) === null);
noted = failedSaveAfter(null, outcome(A, 9, false), A);
noted = failedSaveAfter(noted, outcome(A, 8, true), A);
check("notes: an older sheet's slower save that succeeds leaves the newer sheet's note", noted !== null && noted.image === image(9), noted && noted.image.slice(0, 25));
check('notes: a save of the noted image clears it', failedSaveAfter(noted, outcome(A, 9, true), A) === null);
check('notes: a signed-out card (no user) counts outcomes with no user',
  failedSaveAfter(null, outcome(null, 10, false), undefined)?.image === image(10));

if (failed > 0) {
  console.log(`${failed} FAIL`);
  process.exit(1);
}
console.log('all pass');
