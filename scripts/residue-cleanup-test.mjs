// scripts/residue-cleanup-test.mjs
//
// Offline tests for src/lib/residueCleanup.ts, the purple residue cleanup
// (George, Oct 31; HQ 2026-10-31-057): which colours count, that a run is
// judged whole by how far it reaches from the art, what happens to runs that
// touch the outside and to enclosed ones, and that pinks, skin, muted
// purples and thick violet art are never changed. Run from the repo root:
// `node scripts/residue-cleanup-test.mjs`. Bundles the module with esbuild
// into local/.residue-cleanup-test/ (gitignored); images are built here as
// RGBA arrays. Prints only case names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.residue-cleanup-test', 'residueCleanup.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/residueCleanup.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const {
  RESIDUE_REACH, RESIDUE_NONE, RESIDUE_CLEAR, RESIDUE_DESPILL, RESIDUE_KEEP, PROTECT_TOLERANCE, PROTECT_MAX, isResidueColour,
  characterPalette, scanResidue, cleanResidue,
} = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A W x H image: transparent, with pixels set by (x, y) -> [r, g, b, a].
function image(W, H, paint) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = paint(x, y);
    if (c) px.set(c, (y * W + x) * 4);
  }
  return px;
}
const at = (px, W, x, y) => Array.from(px.slice((y * W + x) * 4, (y * W + x) * 4 + 4));

// Residue measured on George's sheets, Oct 31 (goblin, skeleton) and Oct 28.
const RESIDUE = {
  goblinBright: [176, 41, 177], goblinMid: [133, 5, 137], goblinDark: [85, 1, 89], goblinA: [158, 12, 161], goblinB: [108, 3, 113],
  skeletonA: [209, 37, 202], skeletonB: [198, 41, 187], skeletonC: [225, 24, 218], skeletonD: [190, 58, 167],
  oct28A: [165, 22, 119], oct28B: [125, 24, 108], oct28C: [207, 67, 158],
};
// Never residue: ordinary pinks and skin (fillCleanup's set), a deep pink
// and a blue violet (red and blue too far apart), and the muted purples and
// crimsons of George's own art (Oct 31).
const NEVER = {
  pink: [255, 192, 203], hotPink: [255, 105, 180], salmon: [250, 128, 114], skin: [235, 170, 150], mauve: [224, 176, 255],
  lilac: [200, 162, 200], deepRose: [199, 90, 120], deepPink: [255, 20, 147], blueViolet: [138, 43, 226],
  loincloth: [66, 35, 57], loinclothB: [84, 27, 70], capeShade: [83, 15, 39], wizardShade: [83, 31, 48], robotViolet: [67, 50, 92],
  white: [255, 255, 255], black: [0, 0, 0], green: [60, 140, 50], brown: [120, 70, 30],
};
for (const [k, c] of Object.entries(RESIDUE)) check(`residue colour: ${k} ${c}`, isResidueColour(...c));
for (const [k, c] of Object.entries(NEVER)) check(`not residue: ${k} ${c}`, !isResidueColour(...c));

const GREEN = [60, 140, 50, 255];
const MAG = [...RESIDUE.goblinBright, 255];
const DARK = [...RESIDUE.goblinDark, 255];

// 1. A green body with a 1 px residue ring around it: the ring is cleared,
//    the body is untouched.
{
  const W = 16, H = 16;
  const px = image(W, H, (x, y) => (x >= 4 && x <= 11 && y >= 4 && y <= 11 ? GREEN : x >= 3 && x <= 12 && y >= 3 && y <= 12 ? MAG : null));
  const body = image(W, H, (x, y) => (x >= 4 && x <= 11 && y >= 4 && y <= 11 ? GREEN : null));
  const r = cleanResidue(px, W, H);
  check('ring: 36 cleared', same(r, { cleared: 36, despilled: 0, kept: 0 }), r);
  check('ring: the body is untouched and the ring is transparent', same(Array.from(px), Array.from(body)));
}

// 2. How far a run may reach: a band RESIDUE_REACH px thick is cleared, one
//    pixel thicker is kept, all of it.
for (const [thick, expect] of [[RESIDUE_REACH, 'cleared'], [RESIDUE_REACH + 1, 'kept']]) {
  const W = 20, H = 8;
  const px = image(W, H, (x, y) => (y >= 2 && y <= 5 ? (x < 8 ? GREEN : x < 8 + thick ? MAG : null) : null));
  const before = Array.from(px);
  const r = cleanResidue(px, W, H);
  const n = thick * 4;
  check(`band ${thick} px thick is ${expect}`, expect === 'cleared' ? same(r, { cleared: n, despilled: 0, kept: 0 }) : same(r, { cleared: 0, despilled: 0, kept: n }) && same(Array.from(px), before), r);
}

// 3. A violet cape (6 px thick, a residue colour) on the art's edge is art:
//    nothing changes.
{
  const W = 20, H = 12;
  const px = image(W, H, (x, y) => (y >= 2 && y <= 9 ? (x < 8 ? GREEN : x < 14 ? [148, 30, 150, 255] : null) : null));
  const before = Array.from(px);
  const r = cleanResidue(px, W, H);
  check('thick violet cape: kept, no pixel changed', r.cleared === 0 && r.despilled === 0 && r.kept === 48 && same(Array.from(px), before), r);
}

// 4. An enclosed run: bright pixels (fill left in a gap) are cleared, dark
//    ones (outline blended with the fill) keep their alpha and lose their
//    magenta.
{
  const W = 12, H = 12;
  const px = image(W, H, (x, y) => {
    if (x < 1 || x > 10 || y < 1 || y > 10) return null;
    if (y === 5 && x >= 4 && x <= 5) return MAG;
    if (y === 5 && x >= 6 && x <= 7) return DARK;
    return GREEN;
  });
  const r = cleanResidue(px, W, H);
  check('enclosed: 2 cleared, 2 despilled', same(r, { cleared: 2, despilled: 2, kept: 0 }), r);
  check('enclosed bright: transparent', at(px, W, 4, 5)[3] === 0 && at(px, W, 5, 5)[3] === 0);
  const ex = Math.min(85, 89) - 1;
  check('enclosed dark: magenta excess removed, alpha kept', same(at(px, W, 6, 5), [85 - ex, 1, 89 - ex, 255]), at(px, W, 6, 5));
  check('enclosed: the green around it is untouched', same(at(px, W, 3, 5), GREEN) && same(at(px, W, 8, 5), GREEN));
}

// 5. A run that reaches the image edge touches the outside, even with no
//    transparent pixel next to it.
{
  const W = 8, H = 8;
  const px = image(W, H, (x) => (x === 0 ? MAG : GREEN));
  const r = cleanResidue(px, W, H);
  check('image edge counts as outside: 8 cleared', same(r, { cleared: 8, despilled: 0, kept: 0 }), r);
}

// 5b. Audit r1 (BUILD-2, W2): the same with DARK residue, so "touches the
//     outside" is what clears it (an enclosed dark run is only despilled):
//     at the image edge, and on a rim next to transparency.
{
  const W = 8, H = 8;
  const edge = image(W, H, (x) => (x === 0 ? DARK : GREEN));
  const r = cleanResidue(edge, W, H);
  check('dark run at the image edge: cleared, not despilled', same(r, { cleared: 8, despilled: 0, kept: 0 }) && at(edge, W, 0, 3)[3] === 0, r);
  const rim = image(10, 10, (x, y) => (x >= 3 && x <= 6 && y >= 3 && y <= 6 ? GREEN : x >= 2 && x <= 7 && y >= 2 && y <= 7 ? DARK : null));
  const r2 = cleanResidue(rim, 10, 10);
  check('dark rim next to transparency: cleared, not despilled', same(r2, { cleared: 20, despilled: 0, kept: 0 }) && at(rim, 10, 2, 2)[3] === 0, r2);
}

// 6. A run with no art next to it at all (a floating violet shape) is kept.
{
  const W = 10, H = 10;
  const px = image(W, H, (x, y) => (x >= 3 && x <= 5 && y >= 3 && y <= 5 ? MAG : null));
  const r = cleanResidue(px, W, H);
  check('floating run with no art: kept', same(r, { cleared: 0, despilled: 0, kept: 9 }), r);
}

// 7. A run judged whole: thin where it meets the art, too thick further out
//    (an effect leaving the hand): all of it is kept.
{
  const W = 24, H = 10;
  const px = image(W, H, (x, y) => (y >= 3 && y <= 6 ? (x < 6 ? GREEN : x < 20 ? MAG : null) : null));
  const before = Array.from(px);
  const r = cleanResidue(px, W, H);
  check('run reaching past RESIDUE_REACH is kept whole', r.cleared === 0 && r.despilled === 0 && same(Array.from(px), before), r);
}

// 8. Never-residue colours on the rim, in every shape, are never changed.
{
  const W = 30, H = 30;
  const cols = Object.values(NEVER);
  const px = image(W, H, (x, y) => (x >= 5 && x <= 24 && y >= 5 && y <= 24 ? (x >= 7 && x <= 22 && y >= 7 && y <= 22 ? GREEN : [...cols[(x + y) % cols.length], 255]) : null));
  const before = Array.from(px);
  const r = cleanResidue(px, W, H);
  check('never-residue colours on the rim: nothing changes', r.cleared + r.despilled + r.kept === 0 && same(Array.from(px), before), r);
}

// 9. A half-transparent residue pixel on the outline is cleared too.
{
  const W = 6, H = 6;
  const px = image(W, H, (x, y) => (x >= 1 && x <= 4 && y >= 1 && y <= 4 ? (x === 4 && y === 2 ? [...RESIDUE.skeletonA, 128] : GREEN) : null));
  const r = cleanResidue(px, W, H);
  check('half-transparent residue on the outline: cleared', r.cleared === 1 && at(px, W, 4, 2)[3] === 0, r);
}

// 10. scanResidue reads only; cleanResidue a second time changes nothing.
{
  const W = 16, H = 16;
  const px = image(W, H, (x, y) => (x >= 4 && x <= 11 && y >= 4 && y <= 11 ? (y === 7 && x === 7 ? DARK : GREEN) : x >= 3 && x <= 12 && y >= 3 && y <= 12 ? MAG : null));
  const before = Array.from(px);
  const s = scanResidue(px, W, H);
  check('scan: counts and kinds, input unchanged', s.clear === 36 && s.despill === 1 && s.keep === 0 && s.kinds[7 * W + 7] === RESIDUE_DESPILL && s.kinds[3 * W + 3] === RESIDUE_CLEAR && s.kinds[5 * W + 5] === RESIDUE_NONE && same(Array.from(px), before), { clear: s.clear, despill: s.despill });
  cleanResidue(px, W, H);
  const again = Array.from(px);
  const r2 = cleanResidue(px, W, H);
  check('second clean: nothing more', same(r2, { cleared: 0, despilled: 0, kept: 0 }) && same(Array.from(px), again), r2);
  check('RESIDUE_KEEP is its own kind', RESIDUE_KEEP !== RESIDUE_CLEAR && RESIDUE_KEEP !== RESIDUE_DESPILL && RESIDUE_KEEP !== RESIDUE_NONE);
}

// 11. A character's own violet: the skeleton's loincloth (George's sheets,
//     Oct 31: 133,66,133 and 120,58,120) is as thin as residue. Its palette,
//     passed as `protect`, keeps it, and the fill's magenta is still cleaned.
{
  const BONE = [220, 200, 170, 255];
  const LOIN = [133, 66, 133, 255];
  const LOIN2 = [120, 58, 120, 255];
  const character = image(12, 12, (x, y) => (x >= 3 && x <= 8 && y >= 1 && y <= 10 ? (y >= 6 && y <= 7 ? (x === 3 ? LOIN2 : LOIN) : BONE) : null));
  const pal = characterPalette(character);
  check('characterPalette: the loincloth colours, most common first', same(pal, [[133, 66, 133], [120, 58, 120]]), pal);
  check('characterPalette: none for a character without residue colours', same(characterPalette(image(4, 4, () => GREEN)), []));
  const W = 14, H = 14;
  // The animation frame: the body, the loincloth drifted a little (within
  // PROTECT_TOLERANCE), and a ring of the fill's magenta round all of it.
  const DRIFT = [133 + 12, 66 - 9, 133 + 14, 255];
  const frame = () => image(W, H, (x, y) => (x >= 4 && x <= 9 && y >= 2 && y <= 11 ? (y >= 7 && y <= 8 ? DRIFT : BONE) : x >= 3 && x <= 10 && y >= 1 && y <= 12 ? [...RESIDUE.skeletonA, 255] : null));
  const px = frame();
  const r = cleanResidue(px, W, H, pal);
  const loinKept = [4, 5, 6, 7, 8, 9].every((x) => same(at(px, W, x, 7), DRIFT) && same(at(px, W, x, 8), DRIFT));
  check('protect: the ring cleared, the drifted loincloth kept', r.cleared === 36 && r.despilled === 0 && loinKept, r);
  const bare = frame();
  const r2 = cleanResidue(bare, W, H);
  check('without protect the loincloth counts as residue (why callers pass it)', r2.cleared > 36, r2);
  const far = image(W, H, (x, y) => (x >= 4 && x <= 9 && y >= 2 && y <= 11 ? (y >= 7 && y <= 8 ? [133 + PROTECT_TOLERANCE + 1, 66, 133, 255] : BONE) : null));
  const r3 = cleanResidue(far, W, H, pal);
  check('protect tolerance: a colour 17 away is not protected', r3.cleared === 12, r3);
  const many = image(64, 1, (x) => (x < 40 ? [150 + x, 40, 150 + x, 255] : GREEN));
  check(`characterPalette keeps at most ${PROTECT_MAX}`, characterPalette(many).length === PROTECT_MAX);
}

// 12. Empty and fully transparent images.
check('0 x 0: nothing', same(cleanResidue(new Uint8ClampedArray(0), 0, 0), { cleared: 0, despilled: 0, kept: 0 }));
check('transparent image: nothing', same(cleanResidue(new Uint8ClampedArray(64 * 4), 8, 8), { cleared: 0, despilled: 0, kept: 0 }));

// 13. A 2048 x 2048 sheet striped with residue fringe stays fast.
{
  const W = 2048, H = 2048;
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x >> 3) % 2 === 0) px.set((x & 7) < 2 ? MAG : GREEN, (y * W + x) * 4);
  const t0 = performance.now();
  const r = cleanResidue(px, W, H);
  const ms = performance.now() - t0;
  check(`2048 x 2048 stripes: ${r.cleared} cleared in under 3 s`, r.cleared === W * H / 8 && ms < 3000, { ms: Math.round(ms) });
}

console.log(failed ? `${failed} FAILED` : 'all pass');
process.exit(failed ? 1 : 0);
