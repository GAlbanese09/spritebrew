// scripts/residue-overlay-test.mjs
//
// Offline tests for the editor's "Show residue" layer: residueOverlay in
// src/lib/residueCleanup.ts (BUILD-2, W2; HQ 2026-11-03-007). The layer must
// mark exactly the pixels "Clean residue" changes (cleared in cyan, despilled
// in yellow), nothing it keeps, and nothing on clean art. Run from the repo
// root: `node scripts/residue-overlay-test.mjs`. Bundles the module with
// esbuild into local/.residue-overlay-test/ (gitignored). Prints only case
// names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.residue-overlay-test', 'residueCleanup.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/residueCleanup.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const {
  RESIDUE_REACH, RESIDUE_CLEAR, RESIDUE_DESPILL, RESIDUE_KEEP, OVERLAY_CLEAR, OVERLAY_DESPILL,
  scanResidue, cleanResidue, residueOverlay,
} = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
function image(W, H, f) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = f(x, y);
    if (c) px.set(c, (y * W + x) * 4);
  }
  return px;
}
// Pixels whose bytes differ between two RGBA images.
function changed(a, b) {
  const out = new Set();
  for (let p = 0; p < a.length / 4; p++) {
    for (let k = 0; k < 4; k++) if (a[p * 4 + k] !== b[p * 4 + k]) { out.add(p); break; }
  }
  return out;
}
// Pixels the overlay marks, by colour.
function marks(ov) {
  const clear = new Set(), despill = new Set(), other = new Set();
  for (let p = 0; p < ov.length / 4; p++) {
    const i = p * 4;
    if (ov[i + 3] === 0) continue;
    const c = [ov[i], ov[i + 1], ov[i + 2]];
    if (c.every((v, k) => v === OVERLAY_CLEAR[k]) && ov[i + 3] === 255) clear.add(p);
    else if (c.every((v, k) => v === OVERLAY_DESPILL[k]) && ov[i + 3] === 255) despill.add(p);
    else other.add(p);
  }
  return { clear, despill, other };
}
const eqSet = (a, b) => a.size === b.size && [...a].every((v) => b.has(v));

const GREEN = [60, 140, 50, 255];
const MAG = [176, 41, 177, 255];
const DARK = [85, 1, 89, 255];
const VIOLET = [176, 41, 177, 255];

// 1. Clean art: no marks at all.
{
  const W = 12, H = 12;
  const px = image(W, H, (x, y) => (x >= 3 && x <= 8 && y >= 3 && y <= 8 ? GREEN : null));
  const ov = residueOverlay(scanResidue(px, W, H).kinds, W, H);
  check('clean art: overlay is fully transparent', ov.every((v, i) => i % 4 !== 3 || v === 0));
  check('clean art: overlay is W x H RGBA', ov.length === W * H * 4, ov.length);
}

// 2. A body with an outside residue ring and an enclosed dark pocket: the
//    cyan marks are exactly what a clean clears, the yellow marks exactly
//    what it despills, and nothing else is marked.
{
  const W = 20, H = 20;
  const f = (x, y) => {
    if (x === 10 && y === 10) return DARK; // enclosed, dark: despilled
    if (x >= 5 && x <= 14 && y >= 5 && y <= 14) return GREEN;
    if (x >= 4 && x <= 15 && y >= 4 && y <= 15) return MAG; // outside ring: cleared
    return null;
  };
  const before = image(W, H, f);
  const scan = scanResidue(before, W, H);
  const ov = residueOverlay(scan.kinds, W, H);
  const after = new Uint8ClampedArray(before);
  const r = cleanResidue(after, W, H);
  const diff = changed(before, after);
  const m = marks(ov);
  check('ring and pocket: a clean changes some pixels', r.cleared > 0 && r.despilled > 0, r);
  check('ring and pocket: marks cover exactly the changed pixels', eqSet(new Set([...m.clear, ...m.despill]), diff),
    { marked: m.clear.size + m.despill.size, changed: diff.size });
  check('ring and pocket: cyan count = cleared', m.clear.size === r.cleared, { cyan: m.clear.size, cleared: r.cleared });
  check('ring and pocket: yellow count = despilled', m.despill.size === r.despilled, { yellow: m.despill.size, despilled: r.despilled });
  check('ring and pocket: no other colour is drawn', m.other.size === 0, m.other.size);
  check('ring and pocket: the pocket pixel is yellow', m.despill.has(10 * W + 10));
  // After the clean, the layer has nothing left to mark.
  const ov2 = residueOverlay(scanResidue(after, W, H).kinds, W, H);
  const m2 = marks(ov2);
  check('ring and pocket: after the clean the layer is empty', m2.clear.size + m2.despill.size + m2.other.size === 0);
}

// 3. A run too thick to be residue (a violet cape) is kept by the clean and
//    is not marked.
{
  const W = 24, H = 24;
  const T = RESIDUE_REACH + 3;
  const px = image(W, H, (x, y) => (x >= 4 && x <= 9 && y >= 4 && y <= 19 ? GREEN : x >= 10 && x < 10 + T && y >= 4 && y <= 19 ? VIOLET : null));
  const scan = scanResidue(px, W, H);
  check('thick violet: the scan keeps it', scan.keep > 0 && scan.clear === 0 && scan.despill === 0, scan);
  const m = marks(residueOverlay(scan.kinds, W, H));
  check('thick violet: nothing is marked', m.clear.size + m.despill.size + m.other.size === 0);
}

// 4. The kinds map straight to the marks, one pixel each, and the input
//    kinds array is not changed.
{
  const kinds = new Uint8Array([0, RESIDUE_CLEAR, RESIDUE_DESPILL, RESIDUE_KEEP]);
  const copy = Uint8Array.from(kinds);
  const ov = residueOverlay(kinds, 4, 1);
  check('kinds: none is transparent', ov[3] === 0);
  check('kinds: clear is opaque cyan', [ov[4], ov[5], ov[6], ov[7]].join() === [...OVERLAY_CLEAR, 255].join());
  check('kinds: despill is opaque yellow', [ov[8], ov[9], ov[10], ov[11]].join() === [...OVERLAY_DESPILL, 255].join());
  check('kinds: keep is transparent', ov[15] === 0);
  check('kinds: the input is unchanged', kinds.every((v, i) => v === copy[i]));
  check('kinds: the two mark colours differ', OVERLAY_CLEAR.join() !== OVERLAY_DESPILL.join());
}

// 5. A short kinds array never reads past its end; an empty image gives an
//    empty layer.
{
  const ov = residueOverlay(new Uint8Array([RESIDUE_CLEAR]), 2, 2);
  check('short kinds: one mark, the rest transparent', ov.length === 16 && ov[3] === 255 && ov[7] === 0 && ov[11] === 0 && ov[15] === 0);
  check('empty image: empty layer', residueOverlay(new Uint8Array(0), 0, 0).length === 0);
}

console.log(failed ? `${failed} failed` : 'all pass');
process.exit(failed ? 1 : 0);
