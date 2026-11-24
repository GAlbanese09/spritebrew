// scripts/animation-cleanup-test.mjs
//
// Animate results cleaned by default (HQ 2026-11-24-012; George, Oct 31;
// HQ 2026-10-31-057, -059): src/lib/animationCleanup.ts runs the pink
// cleanup and then, when the character sent is known to have had no
// mostly-magenta colours (`bright`), the purple residue cleanup.
// src/lib/jobGuards.ts keeps each finished Animate job's two guards on the
// device, so the Gallery cleans that job's sheet as the result card did (HQ
// 2026-11-24-018, B). Run from the repo root:
// `node scripts/animation-cleanup-test.mjs`. Bundles the modules with esbuild
// into local/.animation-cleanup-test/ (gitignored); images are built here as
// RGBA arrays; localStorage is a stand-in. Prints only case names and pass or
// fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'local', '.animation-cleanup-test');
const bundle = async (src, name) => {
  const out = path.join(DIR, name);
  await build({ entryPoints: [path.join(ROOT, src)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
  return import(pathToFileURL(out).href);
};
const { cleanAnimationSheet, cleanupChanged } = await bundle('src/lib/animationCleanup.ts', 'animationCleanup.mjs');
const { cleanAnimation } = await bundle('src/lib/fillCleanup.ts', 'fillCleanup.mjs');
const { cleanResidue } = await bundle('src/lib/residueCleanup.ts', 'residueCleanup.mjs');
const guardsMod = await bundle('src/lib/jobGuards.ts', 'jobGuards.mjs');
const { JOB_GUARDS_KEY, JOB_GUARDS_MAX, rememberJobGuards, jobGuards } = guardsMod;

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');

// A W x H image: transparent, with pixels set by (x, y) -> [r, g, b, a].
function image(W, H, paint) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = paint(x, y);
    if (c) px.set(c, (y * W + x) * 4);
  }
  return px;
}
const FILL = '#ff00ff';
const GREEN = [60, 140, 50, 255];
const RES = [176, 41, 177, 255]; // the goblin's bright residue (Oct 31)
const W = 16, H = 16;
// A green body with a 1 px residue ring around it, then transparency, and a
// 2 by 2 residue pocket inside the body, beyond the rim despill's 2 px reach.
// By default the ring goes and the pocket stays: an enclosed run may be a
// violet detail the model drew (AUDIT clean-default-r1 M1).
const inPocket = (x, y) => x >= 7 && x <= 8 && y >= 7 && y <= 8;
const ringed = () => image(W, H, (x, y) => (inPocket(x, y) ? RES : x >= 4 && x <= 11 && y >= 4 && y <= 11 ? GREEN : x >= 3 && x <= 12 && y >= 3 && y <= 12 ? RES : null));
const body = () => image(W, H, (x, y) => (inPocket(x, y) ? RES : x >= 4 && x <= 11 && y >= 4 && y <= 11 ? GREEN : null));
const pocketAlpha = (px) => [[7, 7], [8, 7], [7, 8], [8, 8]].map(([x, y]) => px[(y * W + x) * 4 + 3]);

// ---- C. The cleanup an Animate result gets ----
{
  const a = ringed();
  const c = cleanAnimationSheet(a, W, H, FILL, { key: true, bright: true });
  const greenKept = [[4, 4], [11, 11], [6, 9]].every(([x, y]) => same(Array.from(a.slice((y * W + x) * 4, (y * W + x) * 4 + 4)), GREEN));
  check('C1: bright (no magenta of its own): the ring touching the outside is cleared; the enclosed pocket and the body are kept as they were',
    c.residueCleared === 36 && same(pocketAlpha(a), [255, 255, 255, 255]) && greenKept && same(Array.from(a), Array.from(body())), c);
  const b = ringed();
  const d = cleanAnimationSheet(b, W, H, FILL, { key: true, bright: false });
  check('C2: not bright (the character had magenta of its own): no residue cleanup; the pocket stays', d.residueCleared === 0 && d.residueDespilled === 0 && same(pocketAlpha(b), [255, 255, 255, 255]), d);
  // The same as the two cleanups run one after the other.
  for (const bright of [false, true]) for (const key of [false, true]) {
    const x = ringed(), y = ringed();
    const got = cleanAnimationSheet(x, W, H, FILL, { key, bright });
    const pink = cleanAnimation(y, W, H, FILL, { key, bright });
    const res = bright ? cleanResidue(y, W, H, [], { enclosed: false }) : { cleared: 0, despilled: 0 };
    check(`C3: key ${key}, bright ${bright}: the pink cleanup, then the outside-touching residue only when bright, as run apart`,
      same(Array.from(x), Array.from(y)) && same(got, { keyed: pink.keyed, despilled: pink.despilled, residueCleared: res.cleared, residueDespilled: res.despilled }), got);
  }
  const clean = image(W, H, (x, y) => (x >= 4 && x <= 11 && y >= 4 && y <= 11 ? GREEN : null));
  const before = Array.from(clean);
  const e = cleanAnimationSheet(clean, W, H, FILL, { key: true, bright: true });
  check('C4: a clean sheet: nothing changes, cleanupChanged false', !cleanupChanged(e) && same(Array.from(clean), before), e);
  const twice = ringed();
  cleanAnimationSheet(twice, W, H, FILL, { key: true, bright: true });
  const again = cleanAnimationSheet(twice, W, H, FILL, { key: true, bright: true });
  check('C5: a second run changes nothing', !cleanupChanged(again), again);
  // AUDIT clean-default-r1 M1: details the model drew inside a character
  // with no magenta of its own.
  const GREY = [128, 128, 128, 255];
  const GEM = [200, 60, 205, 255];
  const SEAM = [90, 20, 95, 255];
  const drawn = () => image(W, H, (x, y) => (x >= 2 && x <= 13 && y >= 2 && y <= 13 ? ((x === 6 || x === 7) && (y === 6 || y === 7) ? GEM : x === 10 && y >= 4 && y <= 11 ? SEAM : GREY) : null));
  const m = drawn();
  const mBefore = Array.from(m);
  const mc = cleanAnimationSheet(m, W, H, FILL, { key: true, bright: true });
  check('C7: a violet gem and a dark violet seam the model drew inside the body are kept as they were', same(Array.from(m), mBefore) && !cleanupChanged(mc), mc);
  const ed = drawn();
  const er = cleanResidue(ed, W, H);
  check('C8: the editor\'s Clean residue (asked for, after Show residue) still cleans enclosed runs', er.cleared + er.despilled === 12, er);
  check('C6: cleanupChanged counts every kind', [{ keyed: 1, despilled: 0, residueCleared: 0, residueDespilled: 0 }, { keyed: 0, despilled: 1, residueCleared: 0, residueDespilled: 0 }, { keyed: 0, despilled: 0, residueCleared: 1, residueDespilled: 0 }, { keyed: 0, despilled: 0, residueCleared: 0, residueDespilled: 1 }].every(cleanupChanged));
}

// ---- G. The guards kept on this device ----
{
  const store = new Map();
  let blocked = false;
  globalThis.localStorage = {
    getItem: (k) => { if (blocked) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (blocked) throw new Error('blocked'); store.set(k, String(v)); },
  };
  rememberJobGuards('job-a', { fill: false, magenta: false });
  rememberJobGuards('job-b', { fill: true, magenta: true });
  check('G1: a job\'s two guards come back by its id; an unknown job gives null', same(jobGuards('job-a'), { fill: false, magenta: false }) && same(jobGuards('job-b'), { fill: true, magenta: true }) && jobGuards('job-x') === null);
  rememberJobGuards('job-c', { fill: false });
  rememberJobGuards('job-d', { fill: 'no', magenta: false });
  rememberJobGuards('', { fill: false, magenta: false });
  check('G2: both guards must be known booleans, and the id given; otherwise nothing is kept', jobGuards('job-c') === null && jobGuards('job-d') === null && Object.keys(JSON.parse(store.get(JOB_GUARDS_KEY))).length === 2);
  for (let i = 0; i < JOB_GUARDS_MAX + 20; i++) rememberJobGuards(`n-${i}`, { fill: false, magenta: i % 2 === 0 });
  const kept = Object.keys(JSON.parse(store.get(JOB_GUARDS_KEY)));
  check(`G3: at most ${JOB_GUARDS_MAX} jobs, the newest`, kept.length === JOB_GUARDS_MAX && kept[kept.length - 1] === `n-${JOB_GUARDS_MAX + 19}` && jobGuards('job-a') === null && jobGuards(`n-${JOB_GUARDS_MAX + 19}`) !== null);
  // A job kept again counts as the newest: it outlives the cap.
  const oldest = 'n-20';
  rememberJobGuards(oldest, { fill: true, magenta: false });
  for (let i = 0; i < JOB_GUARDS_MAX - 1; i++) rememberJobGuards(`m-${i}`, { fill: false, magenta: false });
  check('G3b: a job kept again moves to the newest end', same(jobGuards(oldest), { fill: true, magenta: false }) && jobGuards('n-21') === null);
  store.set(JOB_GUARDS_KEY, '{not json');
  check('G4: unreadable storage reads as nothing', jobGuards('n-1') === null);
  store.set(JOB_GUARDS_KEY, JSON.stringify({ a: [true, 'x'], b: [false, false, 1], c: [false, true] }));
  check('G5: a malformed entry is dropped, a good one kept', jobGuards('a') === null && jobGuards('b') === null && same(jobGuards('c'), { fill: false, magenta: true }));
  blocked = true;
  let threw = false;
  try { rememberJobGuards('job-z', { fill: false, magenta: false }); jobGuards('job-z'); } catch { threw = true; }
  check('G6: blocked storage: nothing kept, nothing thrown', !threw && jobGuards('job-z') === null);
  delete globalThis.localStorage;
  threw = false;
  try { rememberJobGuards('job-y', { fill: false, magenta: false }); jobGuards('job-y'); } catch { threw = true; }
  check('G7: no storage at all (a test or a worker): nothing thrown', !threw);
}

// ---- W. Wiring: where the cleanup and the guards are used ----
{
  const sprite = flat(read('src/lib/spriteUtils.ts'));
  check('W1: the canvas cleanup (both forms\' result card) runs the whole Animate cleanup',
    sprite.includes('if (!cleanupChanged(cleanAnimationSheet(imgData.data, W, H, fillHex, opts))) return false;') && !/\bcleanAnimation\(/.test(sprite));
  check('W2: the Gallery uses a job\'s guards when this device has them, else the key on and the bright rule and residue off',
    sprite.includes('export async function cleanGallerySheet(blob: Blob, guards: JobGuards | null = null): Promise<Blob | null> {')
    && sprite.includes('const opts = guards ? { key: !guards.fill, bright: !guards.magenta } : { key: true, bright: false };')
    && sprite.includes('if (!cleanAnimationCanvas(canvas, MAGENTA_FILL, opts)) return null;'));
  const job = flat(read('src/lib/jobResult.ts'));
  check('W3: a finished Animate job with its context and id keeps its guards; a Create job does not',
    job.includes("if (job.mode === 'animate' && job.jobId && isAnimateContext(job.context)) { rememberJobGuards(job.jobId, { fill: job.context.inputHasFill, magenta: job.context.inputHasMagenta }); }")
    && job.includes('bright: animate?.inputHasMagenta === false,'));
  const gallery = flat(read('src/app/gallery/page.tsx'));
  check('W4: the Gallery passes each job\'s guards to its cleanup', gallery.includes('const cleaned = await cleanGallerySheet(stored, jobGuards(jobId));'));
  const dash = String.fromCharCode(0x2014);
  check('W5: no em dash in the two new modules', !read('src/lib/animationCleanup.ts').includes(dash) && !read('src/lib/jobGuards.ts').includes(dash));
}

console.log(failed === 0 ? 'all pass' : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
