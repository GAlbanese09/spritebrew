// scripts/key-residue-test.mjs
//
// Offline tests for src/lib/keyResidue.ts, the leftover background scan
// behind the Frames card's one-click clean on /upload (George, Nov 11, 2026;
// HQ 2026-11-11-046): which colors are key colors, that a run is judged
// whole by how far it reaches from the art, what counts as evidence across
// the sheet, what a clean changes, the "Show where" marks and the strip's
// words. Run from the repo root: `node scripts/key-residue-test.mjs`.
// Bundles the modules with esbuild into local/.key-residue-test/
// (gitignored); images are built here as RGBA arrays. Prints only case names
// and pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.key-residue-test');

async function load(rel) {
  const outfile = path.join(OUT, path.basename(rel).replace(/\.ts$/, '.mjs'));
  await build({ entryPoints: [path.join(ROOT, rel)], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}
const K = await load('src/lib/keyResidue.ts');
const R = await load('src/lib/residueCleanup.ts');
const {
  KEY_NAMES, KEY_HIGH, KEY_LOW, MAGENTA_HIGH, MAGENTA_LOW, KEY_THICK_SHARE, KEY_SHARE_MAX, keyIndexOf, scanKeyFrame, keyFindings, keyTotals, cleanKeyFrame,
  keyMarkKinds, tickedRows, hexOf, pixelsWord, framesWord, foundOneTail, foundManyLine, rowCount, ART_LINE,
  NONE_TICKED, foundAnnouncement, cleanedLine, undoneLine, possibleLine, possibleAnnouncement, sheetIsOpaque,
  artPixelSize, ART_PIXEL_MAX, ART_PIXEL_FIT, ART_PIXEL_MIN_EDGES, ART_PIXEL_MIN_LINES,
  ROW_IDS, ROW_KEY, rowIndexOf, KEY_ALPHA_SURE, KEY_PLACES_EDGE, KEY_PLACES_INSIDE, KEY_PLACES_MANY, KEY_EVIDENCE_SHARE,
  artPixelRead, sheetArtPixel, scanKeySheet, CLEAN_STALE, UNDO_STALE, CLEAN_FAILED, UNDO_FAILED, EMPTY_SCOPE,
  UNSURE_LINE, unsureLine, quietKind, rowLine,
} = K;

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
const inBox = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const M = [255, 0, 255, 255];
const G = [0, 255, 0, 255];
const B = [0, 0, 255, 255];
const C = [0, 255, 255, 255];
const ART = [60, 90, 140, 255];
const SKIN = [253, 190, 173, 255];
// One row's pixel counts in a frame (the run counts apart).
const counts = (scan, row) => { const c = scan.counts[ROW_IDS.indexOf(row)]; return { edge: c.edge, inside: c.inside, thick: c.thick }; };
const runs = (scan, row) => { const c = scan.counts[ROW_IDS.indexOf(row)]; return [c.edgeRuns, c.insideRuns]; };
const marked = (scan) => scan.marks.reduce((n, m) => n + (m ? 1 : 0), 0);

// ---- A. which colors are key colors ----
{
  const name = (r, g, b) => { const k = keyIndexOf(r, g, b); return k < 0 ? null : KEY_NAMES[k]; };
  check('A1: the four pure keys', same([name(255, 0, 255), name(0, 255, 0), name(0, 0, 255), name(0, 255, 255)], ['magenta', 'green', 'blue', 'cyan']));
  check('A2: green, blue and cyan count when near-pure, out to the limits', name(KEY_LOW, KEY_HIGH, KEY_LOW) === 'green' && name(KEY_LOW, KEY_LOW, KEY_HIGH) === 'blue' && name(KEY_LOW, KEY_HIGH, KEY_HIGH) === 'cyan');
  check('A2: one step past a limit they do not', name(0, KEY_HIGH - 1, 0) === null && name(KEY_LOW + 1, 255, 0) === null && name(0, 0, KEY_HIGH - 1) === null && name(0, KEY_HIGH - 1, 255) === null);
  check('A2: the limits are 224 and 48: (0, 223, 0) is not green, (0, 224, 0) is; (49, 255, 0) is not', KEY_HIGH === 224 && KEY_LOW === 48 && name(0, 223, 0) === null && name(0, 224, 0) === 'green' && name(49, 255, 0) === null && name(48, 255, 48) === 'green');
  const row = (r, g, b) => { const i = rowIndexOf(r, g, b); return i < 0 ? null : ROW_IDS[i]; };
  check('A5: rows: near-pure magenta and blended magenta apart; green, blue and cyan one row each; each row\'s key', same([row(255, 0, 255), row(224, 48, 224), row(223, 0, 255), row(180, 40, 190), row(209, 37, 202), row(0, 255, 0), row(0, 0, 255), row(0, 255, 255), row(128, 128, 128)], ['magenta', 'magenta', 'magenta-blend', 'magenta-blend', 'magenta-blend', 'green', 'blue', 'cyan', null]) && same(ROW_KEY.map((k) => KEY_NAMES[k]), ['magenta', 'magenta', 'green', 'blue', 'cyan']));
  check('A2: everyday vivid greens, blues and teals are not keys', [[40, 200, 60], [50, 205, 50], [30, 60, 200], [0, 128, 255], [0, 180, 180], [55, 116, 100]].every(([r, g, b]) => name(r, g, b) === null));
  check('A3: magenta may be a little off, out to its limits: the colors left between the bones of George\'s skeleton sheet count', [[209, 37, 202], [198, 41, 187], [225, 24, 218], [190, 58, 167], [176, 41, 177], [MAGENTA_HIGH, MAGENTA_LOW, MAGENTA_HIGH]].every(([r, g, b]) => name(r, g, b) === 'magenta'));
  check('A3: one step past a magenta limit does not, nor a red or a blue that leans away', name(MAGENTA_HIGH - 1, 0, 255) === null && name(255, 0, MAGENTA_HIGH - 1) === null && name(255, MAGENTA_LOW + 1, 255) === null && name(255, 0, 164) === null && name(164, 0, 255) === null);
  check('A3: art colors are never keys: skin, hot pink, the loincloth purple and its shade, a lightning purple, dark outline residue, red, yellow, white, black, grey',
    [[253, 190, 173], [255, 105, 180], [133, 66, 133], [120, 58, 120], [161, 34, 173], [85, 1, 89], [255, 0, 0], [255, 255, 0], [255, 255, 255], [0, 0, 0], [128, 128, 128]].every(([r, g, b]) => name(r, g, b) === null));
  check('A4: the limits: near-pure for green, blue and cyan; looser for magenta; small shares', KEY_HIGH >= 200 && KEY_LOW <= 64 && MAGENTA_HIGH < KEY_HIGH && MAGENTA_HIGH >= 160 && MAGENTA_LOW >= KEY_LOW && MAGENTA_LOW <= 64 && KEY_SHARE_MAX > 0 && KEY_SHARE_MAX <= 0.1 && KEY_THICK_SHARE > 0 && KEY_THICK_SHARE <= 0.25);
}

// ---- B. the shape rule, one frame ----
{
  // A 20 x 20 body with a 2 px magenta fringe on its right side, touching
  // transparency: leftover on the cut edge.
  const W = 32, H = 32;
  const fringe = image(W, H, (x, y) => (inBox(x, y, 4, 4, 21, 23) ? ART : inBox(x, y, 22, 8, 23, 15) ? M : null));
  const s1 = scanKeyFrame(fringe, W, H);
  check('B1: a thin run on the cut edge is leftover, all of it marked; one run on the edge', same(counts(s1, 'magenta'), { edge: 16, inside: 0, thick: 0 }) && marked(s1) === 16 && s1.marks[10 * W + 22] === 1 && same(runs(s1, 'magenta'), [1, 0]) && ['magenta-blend', 'green', 'blue', 'cyan'].every((r) => same(runs(s1, r), [0, 0])));
  check('B1: the frame\'s visible pixels are counted', s1.visible === 18 * 20 + 16, s1.visible);

  // A pocket the art closes in.
  const pocket = image(W, H, (x, y) => (inBox(x, y, 10, 10, 13, 12) ? M : inBox(x, y, 4, 4, 23, 23) ? ART : null));
  const s2 = scanKeyFrame(pocket, W, H);
  check('B2: a closed pocket is leftover too, counted as inside; one run inside', same(counts(s2, 'magenta'), { edge: 0, inside: 12, thick: 0 }) && marked(s2) === 12 && same(runs(s2, 'magenta'), [0, 1]));
  // Two pixels that touch only at a corner are one run, and a pixel that
  // touches art only at a corner is beside it (8-way, as residueCleanup).
  const diagonal = image(W, H, (x, y) => (x === 22 && y === 8 ? M : x === 23 && y === 9 ? M : inBox(x, y, 4, 4, 21, 23) ? ART : null));
  const sd = scanKeyFrame(diagonal, W, H);
  check('B2: corner neighbours join: two pixels touching at a corner are one run, beside the art by its corner', same(runs(sd, 'magenta'), [1, 0]) && same(counts(sd, 'magenta'), { edge: 2, inside: 0, thick: 0 }));
  const cornerArt = image(W, H, (x, y) => (inBox(x, y, 22, 24, 23, 25) ? M : inBox(x, y, 4, 4, 21, 23) ? ART : null));
  check('B2: a run that touches the art only at a corner is beside it', same(counts(scanKeyFrame(cornerArt, W, H), 'magenta'), { edge: 4, inside: 0, thick: 0 }));

  // Thick art in a key color, with a thin tail: judged whole, all kept.
  const cape = image(W, H, (x, y) => (inBox(x, y, 12, 6, 21, 15) || inBox(x, y, 22, 10, 26, 10) ? M : inBox(x, y, 4, 4, 11, 23) ? ART : null));
  const s3 = scanKeyFrame(cape, W, H);
  check('B3: a thick shape is art, its thin tail included: nothing marked', same(counts(s3, 'magenta'), { edge: 0, inside: 0, thick: 105 }) && marked(s3) === 0);

  // A band between art on both sides: 6 px is within reach of both, 7 is not.
  const band = (w) => image(W, H, (x, y) => (inBox(x, y, 10, 4, 10 + w - 1, 23) ? M : inBox(x, y, 4, 4, 27, 23) ? ART : null));
  check('B4: a band 6 px across with art on both sides is leftover (it reaches the cut edge at its ends)', same(counts(scanKeyFrame(band(6), W, H), 'magenta'), { edge: 6 * 20, inside: 0, thick: 0 }));
  check('B4: a band 7 px across is art', same(counts(scanKeyFrame(band(7), W, H), 'magenta'), { edge: 0, inside: 0, thick: 7 * 20 }));

  // A run that only touches the frame's edge counts as the cut edge.
  const atEdge = image(W, H, (x, y) => (inBox(x, y, 0, 10, 1, 12) ? G : inBox(x, y, 2, 4, 23, 23) || inBox(x, y, 0, 4, 1, 9) || inBox(x, y, 0, 13, 1, 23) ? ART : null));
  check('B5: a run at the frame\'s edge is on the cut edge', same(counts(scanKeyFrame(atEdge, W, H), 'green'), { edge: 6, inside: 0, thick: 0 }));

  // A speck with no art beside it is not leftover: it clings to nothing.
  const speck = image(W, H, (x, y) => (inBox(x, y, 28, 28, 29, 28) ? M : inBox(x, y, 4, 4, 21, 23) ? ART : null));
  check('B6: a speck with no art beside it is left alone', same(counts(scanKeyFrame(speck, W, H), 'magenta'), { edge: 0, inside: 0, thick: 2 }));

  // Two keys in one frame are judged apart; touching runs of different keys
  // do not join.
  const two = image(W, H, (x, y) => (inBox(x, y, 22, 8, 22, 11) ? M : inBox(x, y, 22, 12, 22, 15) ? G : inBox(x, y, 4, 4, 21, 23) ? ART : null));
  const s7 = scanKeyFrame(two, W, H);
  check('B7: two keys in one frame, each its own run and mark (1 + its row)', same([counts(s7, 'magenta'), counts(s7, 'green')], [{ edge: 4, inside: 0, thick: 0 }, { edge: 4, inside: 0, thick: 0 }]) && s7.marks[9 * W + 22] === 1 && s7.marks[13 * W + 22] === 3);

  const cool = image(W, H, (x, y) => (inBox(x, y, 22, 8, 22, 11) ? B : inBox(x, y, 22, 12, 22, 15) ? C : inBox(x, y, 4, 4, 21, 23) ? ART : null));
  const s7b = scanKeyFrame(cool, W, H);
  check('B7: blue and cyan are found the same way', same([counts(s7b, 'blue'), counts(s7b, 'cyan')], [{ edge: 4, inside: 0, thick: 0 }, { edge: 4, inside: 0, thick: 0 }]) && s7b.marks[9 * W + 22] === 4 && s7b.marks[13 * W + 22] === 5);
  // A run of near-pure and blended magenta is judged whole as one shape; its
  // pixels are counted by row.
  const mixed = image(W, H, (x, y) => (inBox(x, y, 22, 8, 22, 11) ? M : inBox(x, y, 22, 12, 22, 15) ? [200, 40, 190, 255] : inBox(x, y, 4, 4, 21, 23) ? ART : null));
  const sm = scanKeyFrame(mixed, W, H);
  check('B7: near-pure and blended magenta in one run: one shape, counted in two rows, each with the run as a place', same([counts(sm, 'magenta'), counts(sm, 'magenta-blend')], [{ edge: 4, inside: 0, thick: 0 }, { edge: 4, inside: 0, thick: 0 }]) && same([runs(sm, 'magenta'), runs(sm, 'magenta-blend')], [[1, 0], [1, 0]]) && sm.marks[9 * W + 22] === 1 && sm.marks[13 * W + 22] === 2);
  const thickMixed = image(W, H, (x, y) => (inBox(x, y, 22, 6, 29, 17) ? ((x + y) % 2 ? M : [200, 40, 190, 255]) : inBox(x, y, 4, 4, 21, 23) ? ART : null));
  const stm = scanKeyFrame(thickMixed, W, H);
  check('B7: a thick shape shaded in both is still one thick shape, never cut into thin runs', counts(stm, 'magenta').thick + counts(stm, 'magenta-blend').thick === 96 && marked(stm) === 0);

  // A hidden pixel (alpha 0) with a key color under it is not there.
  const hidden = image(W, H, (x, y) => (inBox(x, y, 22, 8, 23, 15) ? [255, 0, 255, 0] : inBox(x, y, 4, 4, 21, 23) ? ART : null));
  check('B8: a fully transparent pixel is never leftover, whatever color it hides', marked(scanKeyFrame(hidden, W, H)) === 0);
  check('B8: a faint run (alpha 1) alone is not: a browser rounds any color toward a key at that alpha (AUDIT clean-frames r1 L2)', marked(scanKeyFrame(image(W, H, (x, y) => (inBox(x, y, 22, 8, 23, 15) ? [255, 0, 255, 1] : inBox(x, y, 4, 4, 21, 23) ? ART : null)), W, H)) === 0);
  const halo = image(W, H, (x, y) => (inBox(x, y, 22, 8, 22, 15) ? M : inBox(x, y, 23, 8, 23, 15) ? [255, 0, 255, KEY_ALPHA_SURE - 1] : inBox(x, y, 24, 8, 24, 15) ? [255, 0, 255, 1] : inBox(x, y, 4, 4, 21, 23) ? ART : null));
  check('B8: faint pixels that join a sure one of the same key are leftover with it, however far the chain', same(counts(scanKeyFrame(halo, W, H), 'magenta'), { edge: 24, inside: 0, thick: 0 }));
  const glow = image(W, H, (x, y) => (inBox(x, y, 22, 8, 22, 15) ? [90, 120, 235, 200] : inBox(x, y, 23, 8, 23, 15) ? [0, 0, 255, 1] : inBox(x, y, 4, 4, 21, 23) ? ART : null));
  check('B8: a glow rounded to the key at its faint edge is not leftover', marked(scanKeyFrame(glow, W, H)) === 0);
  check('B8: the sure alpha is 16', KEY_ALPHA_SURE === 16);

  check('B9: an empty frame and a frame with no key color scan clean', marked(scanKeyFrame(new Uint8ClampedArray(0), 0, 0)) === 0 && marked(scanKeyFrame(image(8, 8, () => ART), 8, 8)) === 0);
  const opaqueKeyed = image(W, H, (x, y) => (inBox(x, y, 4, 4, 21, 23) ? ART : x === 22 ? M : G));
  const so = scanKeyFrame(opaqueKeyed, W, H);
  check('B9: a fully opaque frame is the banner\'s: every pixel visible, nothing looked into (AUDIT clean-frames r1 L3)', so.visible === W * H && marked(so) === 0 && so.counts.every((c) => c.edge + c.inside + c.thick === 0));

  // The exact colors of a key are counted, leftover only.
  const shades = image(W, H, (x, y) => (inBox(x, y, 22, 8, 22, 13) ? M : inBox(x, y, 22, 14, 22, 15) ? [250, 4, 248, 255] : inBox(x, y, 4, 4, 21, 23) ? ART : null));
  const s10 = scanKeyFrame(shades, W, H);
  check('B10: each exact color of a key is counted', same([...s10.exact[0].entries()].sort((a, b) => b[1] - a[1]), [[0xff00ff, 6], [0xfa04f8, 2]]));
}

// ---- C. the same pixels residueCleanup clears (pure magenta, no protect) ----
{
  const W = 40, H = 40;
  const sheet = image(W, H, (x, y) => {
    if (inBox(x, y, 12, 12, 14, 13)) return M; // pocket
    if (inBox(x, y, 26, 8, 27, 20)) return M; // fringe
    if (inBox(x, y, 6, 26, 9, 27)) return M; // under the feet
    if (inBox(x, y, 30, 30, 37, 37)) return M; // a thick block of its own
    return inBox(x, y, 6, 6, 25, 25) ? (x + y) % 7 === 0 ? SKIN : ART : null;
  });
  const mine = scanKeyFrame(sheet, W, H);
  const theirs = R.scanResidue(sheet, W, H);
  let agree = true;
  for (let p = 0; p < W * H; p++) if ((mine.marks[p] !== 0) !== (theirs.kinds[p] === R.RESIDUE_CLEAR)) agree = false;
  check('C1: on pure magenta the marks are exactly the pixels scanResidue would clear', agree && marked(mine) === theirs.clear && theirs.despill === 0, { mine: marked(mine), theirs: theirs.clear });
  check('C1: and the thick block is kept by both', counts(mine, 'magenta').thick === 64 && theirs.keep === 64);
}

// ---- D. evidence across the sheet ----
{
  const W = 32, H = 32;
  const body = (x, y) => inBox(x, y, 4, 4, 21, 23);
  const fringed = image(W, H, (x, y) => (inBox(x, y, 22, 8, 23, 15) ? M : body(x, y) ? ART : null)); // 16 on the edge, one place
  const pocketed = image(W, H, (x, y) => (inBox(x, y, 10, 10, 13, 12) ? M : body(x, y) ? ART : null)); // 12 inside
  // What a fill leaves: a fringe, a run under the feet, and a pocket.
  const fill = (x, y) => inBox(x, y, 22, 8, 23, 15) || inBox(x, y, 6, 24, 9, 24) || inBox(x, y, 10, 10, 13, 12);
  const filled = image(W, H, (x, y) => (fill(x, y) ? M : body(x, y) ? ART : null)); // 16 + 4 on the edge, 12 inside
  // A halo: four runs on the cut edge, none inside.
  const haloed = image(W, H, (x, y) => (inBox(x, y, 22, 6, 22, 9) || inBox(x, y, 22, 14, 22, 17) || inBox(x, y, 3, 8, 3, 11) || inBox(x, y, 8, 24, 11, 24) ? M : body(x, y) ? ART : null));
  const plain = image(W, H, (x, y) => (body(x, y) ? ART : null));
  const gem = image(W, H, (x, y) => (inBox(x, y, 12, 12, 13, 13) ? G : body(x, y) ? ART : null)); // 4 green inside
  const caped = image(W, H, (x, y) => (inBox(x, y, 22, 6, 29, 17) ? M : body(x, y) ? ART : null)); // thick magenta
  const scans = (frames) => new Map(Object.entries(frames).map(([id, px]) => [id, scanKeyFrame(px, W, H)]));
  // The keys the page knows were the background: all of them here, so these
  // checks are the shape rule's; D11 checks what the page knows.
  const ALL = new Set(KEY_NAMES);
  const view = (s) => keyFindings(s, undefined, ALL).map((f) => [f.row, f.pixels, f.frames, f.art]);

  const a = scans({ f1: filled, f2: pocketed, f3: plain });
  check('D1: a color on the edge in two places and closed in, in at least half the frames that hold it, is ticked; pockets in other frames included', same(keyFindings(a, undefined, ALL), [{ row: 'magenta', key: 'magenta', rgb: [255, 0, 255], hex: '#FF00FF', pixels: 44, frames: 2, art: null }]), keyFindings(a, undefined, ALL));
  check('D1: the limits: 2 places on the edge and 1 closed in, or 4 on the edge; in half the frames', KEY_PLACES_EDGE === 2 && KEY_PLACES_INSIDE === 1 && KEY_PLACES_MANY === 4 && KEY_EVIDENCE_SHARE === 0.5);
  check('D1: a halo, four places on the edge with none inside, is ticked', same(view(scans({ f1: haloed, f2: haloed })), [['magenta', 32, 2, null]]), view(scans({ f1: haloed, f2: haloed })));
  check('D1: one accent on the outline in every frame (a headband, a bow, a blade) is listed but starts unticked (AUDIT clean-frames r1 H1)', same(view(scans({ f1: fringed, f2: fringed, f3: fringed })), [['magenta', 48, 3, 'few']]));
  const threePlaces = image(W, H, (x, y) => (inBox(x, y, 22, 6, 22, 9) || inBox(x, y, 22, 14, 22, 17) || inBox(x, y, 3, 8, 3, 11) ? M : body(x, y) ? ART : null));
  check('D1: three places on the edge with none inside is not enough', same(view(scans({ f1: threePlaces })), [['magenta', 12, 1, 'few']]));
  const eyesAndBand = image(W, H, (x, y) => (inBox(x, y, 22, 8, 22, 11) || inBox(x, y, 10, 10, 10, 10) || inBox(x, y, 14, 10, 14, 10) ? M : body(x, y) ? ART : null));
  check('D1: one place on the edge with closed-in eyes is not enough', same(view(scans({ f1: eyesAndBand, f2: eyesAndBand })), [['magenta', 12, 2, 'few']]));
  check('D1: in half the frames that hold it is enough; in fewer it is not', same(view(scans({ f1: filled, f2: fringed })), [['magenta', 48, 2, null]]) && same(view(scans({ f1: filled, f2: fringed, f3: fringed })), [['magenta', 64, 3, 'few']]) && same(view(scans({ f1: filled, f2: plain, f3: plain })), [['magenta', 32, 1, null]]));

  const b = scans({ f1: pocketed, f2: plain });
  check('D2: a color found only inside the art starts unticked', same(view(b), [['magenta', 12, 1, 'inside']]));

  const c = scans({ f1: filled, f2: caped });
  check('D3: a color the art also draws thick shapes in starts unticked, thin runs elsewhere included', same(view(c), [['magenta', 32, 1, 'thick']]));
  // A few wisps that stray from the art do not make the color art: on
  // George's green sheet they are 73 of 4,224 pixels.
  const wisp = image(W, H, (x, y) => (fill(x, y) || inBox(x, y, 28, 28, 29, 28) ? M : body(x, y) ? ART : null));
  const w = scans({ f1: wisp, f2: filled });
  check('D3: a small share in stray or thick runs leaves it ticked; the strays are not counted as leftover', same(view(w), [['magenta', 64, 2, null]]) && counts(w.get('f1'), 'magenta').thick === 2 && 2 < KEY_THICK_SHARE * 66);
  const quarter = image(W, H, (x, y) => (inBox(x, y, 22, 8, 22, 13) || inBox(x, y, 28, 28, 29, 28) ? M : body(x, y) ? ART : null));
  check('D3: at a quarter of its pixels it is art', same(keyFindings(scans({ f1: quarter }), undefined, ALL).map((f) => [f.pixels, f.art]), [[6, 'thick']]));

  // A thin magenta outline round the whole body: thin, on the edge, but a
  // large share of the frame.
  const outlined = image(W, H, (x, y) => (inBox(x, y, 6, 6, 19, 21) ? ART : inBox(x, y, 4, 4, 21, 23) ? M : null));
  const d = scans({ f1: outlined, f2: filled });
  const share = counts(d.get('f1'), 'magenta').edge / d.get('f1').visible;
  check('D4: a color that is a large share of a frame starts unticked', share > KEY_SHARE_MAX && same(keyFindings(d, undefined, ALL).map((f) => [f.row, f.art]), [['magenta', 'share']]), share);

  const e = scans({ f1: filled, f2: gem });
  check('D5: two colors, listed in row order, each on its own evidence', same(keyFindings(e, undefined, ALL).map((f) => [f.row, f.hex, f.pixels, f.frames, f.art]), [['magenta', '#FF00FF', 32, 1, null], ['green', '#00FF00', 4, 1, 'inside']]));
  // A fill of #FF00FF and a purple trim drawn in every frame are two rows:
  // ticking one never takes the other (AUDIT clean-frames r1 H1).
  const trim = (x, y) => inBox(x, y, 3, 6, 3, 20);
  const fillAndTrim = image(W, H, (x, y) => (fill(x, y) ? M : trim(x, y) ? [180, 40, 190, 255] : body(x, y) ? ART : null));
  check('D5: a near-pure fill and a blended purple trim are two rows: the fill ticked, the trim not', same(view(scans({ f1: fillAndTrim, f2: fillAndTrim })), [['magenta', 64, 2, null], ['magenta-blend', 30, 2, 'few']]));

  check('D6: the counts follow the scope; the evidence stays the whole sheet\'s', same(keyFindings(a, new Set(['f2']), ALL).map((f) => [f.pixels, f.frames, f.art]), [[12, 1, null]]) && same(keyFindings(a, new Set(['f3']), ALL), []));
  check('D6: totals for the given rows, all frames and a scope', same(keyTotals(e, new Set(['magenta', 'green'])), { pixels: 36, frames: 2 }) && same(keyTotals(e, new Set(['magenta'])), { pixels: 32, frames: 1 }) && same(keyTotals(e, new Set(['magenta', 'green']), new Set(['f2'])), { pixels: 4, frames: 1 }) && same(keyTotals(e, new Set()), { pixels: 0, frames: 0 }));
  check('D6: totals never count a thick shape', same(keyTotals(scans({ f1: caped }), new Set(['magenta'])), { pixels: 0, frames: 0 }) && same(keyTotals(c, new Set(['magenta'])), { pixels: 32, frames: 1 }));

  const shades = image(W, H, (x, y) => (inBox(x, y, 22, 8, 22, 9) ? M : inBox(x, y, 22, 10, 22, 15) ? [250, 4, 248, 255] : body(x, y) ? ART : null));
  check('D7: the row shows the most common exact color, as capitals with #', same(keyFindings(scans({ f1: shades }), undefined, ALL).map((f) => [f.hex, f.rgb, f.pixels]), [['#FA04F8', [250, 4, 248], 8]]) && hexOf([0, 171, 9]) === '#00AB09');

  check('D8: nothing found, nothing listed', same(keyFindings(scans({ f1: plain }), undefined, ALL), []) && same(keyFindings(new Map(), undefined, ALL), []));

  const opaque = image(W, H, (x, y) => (body(x, y) ? ART : G));
  const holed = image(W, H, (x, y) => (x === 0 && y === 0 ? null : body(x, y) ? ART : G));
  check('D10: a sheet whose every frame is fully opaque is the banner\'s, not the strip\'s; one transparent pixel and it is not', sheetIsOpaque(scans({ f1: opaque, f2: opaque })) === true && sheetIsOpaque(scans({ f1: opaque, f2: holed })) === false && sheetIsOpaque(scans({ f1: plain })) === false && sheetIsOpaque(new Map()) === false);

  const found = keyFindings(e, undefined, ALL);
  check('D9: ticked by default: what does not look like art; the person\'s own ticks win both ways', same([...tickedRows(found, new Map())], ['magenta']) && same([...tickedRows(found, new Map([['green', true]]))], ['magenta', 'green']) && same([...tickedRows(found, new Map([['magenta', false]]))], []));
  check('D9: a remembered default wins over a new scan\'s, and the person\'s own ticks win over both', same([...tickedRows(found, new Map(), new Map([['magenta', false], ['green', true]]))], ['green']) && same([...tickedRows(found, new Map([['magenta', true]]), new Map([['magenta', false]]))], ['magenta']));

  // What the page knows (AUDIT clean-frames r2 H1; HQ 2026-11-24-109, C).
  const known = (keys) => keyFindings(scans({ f1: filled, f2: filled }), undefined, keys).map((f) => [f.row, f.art]);
  check('D11: a row that sits as leftover starts ticked only when the page knows its key was the background', same(known(new Set(['magenta'])), [['magenta', null]]) && same(known(new Set(['green'])), [['magenta', 'unknown']]) && same(known(new Set()), [['magenta', 'unknown']]) && same(known(undefined), [['magenta', 'unknown']]));
  check('D11: knowing the key never ticks a row that does not sit as leftover: a headband, a trim, a pocket alone', same(view(scans({ f1: fringed, f2: fringed })), [['magenta', 32, 2, 'few']]) && same(view(scans({ f1: fillAndTrim })), [['magenta', 32, 1, null], ['magenta-blend', 15, 1, 'few']]) && same(view(b), [['magenta', 12, 1, 'inside']]));
  check('D11: a known magenta covers both its rows; green is its own', same(keyFindings(scans({ f1: fillAndTrim, f2: filled }), undefined, new Set(['magenta'])).map((f) => [f.row, f.art]), [['magenta', null], ['magenta-blend', 'few']]) && same(keyFindings(scans({ f1: fillAndTrim }), undefined, new Set(['green'])).map((f) => [f.row, f.art]), [['magenta', 'unknown'], ['magenta-blend', 'few']]));
}

// ---- E. cleaning ----
{
  const W = 32, H = 32;
  const px = image(W, H, (x, y) => {
    if (inBox(x, y, 22, 8, 23, 15)) return M; // edge
    if (inBox(x, y, 10, 10, 13, 12)) return M; // pocket
    if (inBox(x, y, 12, 18, 13, 19)) return G; // a green gem inside
    if (inBox(x, y, 24, 24, 31, 31)) return C; // thick cyan, its own shape
    return inBox(x, y, 4, 4, 21, 23) ? ART : null;
  });
  const before = px.slice();
  const scan = scanKeyFrame(px, W, H);
  const { data, cleared } = cleanKeyFrame(px, scan, new Set(['magenta']));
  check('E1: a clean clears the ticked key\'s leftover, edge and pocket, to transparent black', cleared === 28 && same(at(data, W, 22, 8), [0, 0, 0, 0]) && same(at(data, W, 11, 11), [0, 0, 0, 0]));
  check('E1: and nothing else: the art, the unticked key and the thick shape are byte for byte', (() => {
    for (let p = 0; p < W * H; p++) {
      if (scan.marks[p] === 1) continue;
      for (let j = 0; j < 4; j++) if (data[p * 4 + j] !== before[p * 4 + j]) return false;
    }
    return same(at(data, W, 12, 18), G) && same(at(data, W, 28, 28), C);
  })());
  check('E2: the frame passed in is not changed', same(Array.from(px), Array.from(before)));
  const again = scanKeyFrame(data, W, H);
  check('E3: a second scan finds none of that key; the other key is still listed', same(counts(again, 'magenta'), { edge: 0, inside: 0, thick: 0 }) && counts(again, 'green').inside === 4);
  const both = cleanKeyFrame(px, scan, new Set(['magenta', 'green', 'cyan']));
  check('E4: ticking a key cleans its thin runs only; a thick shape stays whatever is ticked', both.cleared === 32 && same(at(both.data, W, 12, 18), [0, 0, 0, 0]) && same(at(both.data, W, 28, 28), C));
  const strayed = image(W, H, (x, y) => (inBox(x, y, 22, 8, 23, 15) || inBox(x, y, 28, 28, 29, 28) ? M : inBox(x, y, 4, 4, 21, 23) ? ART : null));
  const strayClean = cleanKeyFrame(strayed, scanKeyFrame(strayed, W, H), new Set(['magenta']));
  check('E4: a run that strays from the art stays too', strayClean.cleared === 16 && same(at(strayClean.data, W, 28, 28), M) && same(at(strayClean.data, W, 22, 8), [0, 0, 0, 0]));
  check('E5: no key ticked, nothing cleared, a copy all the same', (() => { const r = cleanKeyFrame(px, scan, new Set()); return r.cleared === 0 && r.data !== px && same(Array.from(r.data), Array.from(before)); })());
}

// ---- F. the "Show where" marks ----
{
  const W = 16, H = 16;
  const px = image(W, H, (x, y) => (x === 10 && y === 8 ? M : x === 10 && y === 3 ? G : inBox(x, y, 2, 2, 9, 13) ? ART : null));
  const scan = scanKeyFrame(px, W, H);
  const sum = (kinds) => kinds.reduce((n, k) => n + (k ? 1 : 0), 0);
  const k0 = keyMarkKinds(scan, new Set(['magenta']));
  check('F1: one mark per pixel a clean would clear, of the ticked keys only', sum(k0) === 1 && k0[8 * W + 10] === R.RESIDUE_CLEAR && k0[3 * W + 10] === 0);
  const k1 = keyMarkKinds(scan, new Set(['magenta']), 1);
  check('F2: grown by 1 px so it shows on a small thumbnail', sum(k1) === 9 && k1[7 * W + 9] === R.RESIDUE_CLEAR && k1[9 * W + 11] === R.RESIDUE_CLEAR);
  const corner = scanKeyFrame(image(8, 8, (x, y) => (x === 0 && y === 0 ? M : inBox(x, y, 1, 0, 5, 5) || inBox(x, y, 0, 1, 0, 5) ? ART : null)), 8, 8);
  check('F2: growing stops at the frame\'s edge', sum(keyMarkKinds(corner, new Set(['magenta']), 2)) === 9);
  check('F3: the kinds feed residueOverlay: cyan where marked, clear elsewhere', (() => {
    const overlay = R.residueOverlay(k0, W, H);
    return same(at(overlay, W, 10, 8), [...R.OVERLAY_CLEAR, 255]) && same(at(overlay, W, 10, 3), [0, 0, 0, 0]);
  })());
  check('F4: no key ticked, no mark', sum(keyMarkKinds(scan, new Set())) === 0);
  const cyanScan = scanKeyFrame(image(W, H, (x, y) => (x === 10 && y === 8 ? C : inBox(x, y, 2, 2, 9, 13) ? ART : null)), W, H);
  check('F5: on a cyan row the marks are yellow, so they show against it (AUDIT clean-frames r1 L11)', keyMarkKinds(cyanScan, new Set(['cyan']))[8 * W + 10] === R.RESIDUE_DESPILL && keyMarkKinds(scan, new Set(['magenta']))[8 * W + 10] === R.RESIDUE_CLEAR);
}

// ---- G. the strip's words (DESIGN ticket upload-residue-clean) ----
{
  const f = (pixels, frames) => ({ row: 'magenta', key: 'magenta', rgb: [255, 0, 255], hex: '#FF00FF', pixels, frames, art: null });
  check('G1: pixels and frames, singular and plural, with thousands separators', same([pixelsWord(1), pixelsWord(407), pixelsWord(1204), framesWord(1), framesWord(12)], ['1 pixel', '407 pixels', '1,204 pixels', '1 frame', '12 frames']));
  check('G2: one color found', foundOneTail(f(407, 12), 12) === '407 pixels in 12 of 12 frames.' && foundOneTail(f(1, 1), 12) === '1 pixel in 1 of 12 frames.' && foundOneTail(f(3, 1), 1) === '3 pixels in 1 of 1 frame.');
  check('G3: several colors found: the line and a row', foundManyLine(10, 12) === 'Leftover background found in 10 of 12 frames:' && rowCount(f(407, 12)) === `407 pixels ${String.fromCharCode(0xb7)} 12 frames` && rowCount(f(1, 1)) === `1 pixel ${String.fromCharCode(0xb7)} 1 frame`);
  check('G4: the art line and the reason Clean is off', ART_LINE === 'Looks like part of your art, so it is left alone. Check it to clean it too.' && NONE_TICKED === 'Check a color to clean.');
  check('G5: what is announced', foundAnnouncement(12) === 'Leftover background found in 12 frames.' && foundAnnouncement(1) === 'Leftover background found in 1 frame.' && cleanedLine(407, 12) === 'Cleaned 407 pixels in 12 frames.' && cleanedLine(1, 1) === 'Cleaned 1 pixel in 1 frame.' && undoneLine(12) === 'Undone. 12 frames restored.' && undoneLine(1) === 'Undone. 1 frame restored.');
  check('G7: every color looks like art: the quiet line and what is announced', possibleLine(2, 4) === 'Possible leftover background in 2 of 4 frames. It looks like part of your art, so it is left alone.' && possibleLine(1, 1) === 'Possible leftover background in 1 of 1 frame. It looks like part of your art, so it is left alone.' && possibleAnnouncement(2) === 'Possible leftover background in 2 frames.' && possibleAnnouncement(1) === 'Possible leftover background in 1 frame.');
  check('G9: a row the page cannot vouch for (with "too": it shows only beside a ticked row), and the quiet line when any row is one, with its one-row form (DESIGN -114)', UNSURE_LINE === 'Could be leftover background or part of your art. Check it to clean it too.' && unsureLine(12, 12, 2) === 'Possible leftover background in 12 of 12 frames. Check a color to clean it.' && unsureLine(12, 12, 1) === 'Possible leftover background in 12 of 12 frames. Check it to clean it.' && unsureLine(1, 1, 3) === 'Possible leftover background in 1 of 1 frame. Check a color to clean it.');
  {
    const u = { row: 'green', key: 'green', rgb: [0, 255, 0], hex: '#00FF00', pixels: 9, frames: 2, art: 'unknown' };
    const a = { row: 'magenta-blend', key: 'magenta', rgb: [180, 40, 190], hex: '#B428BE', pixels: 9, frames: 2, art: 'few' };
    const n = { row: 'magenta', key: 'magenta', rgb: [255, 0, 255], hex: '#FF00FF', pixels: 9, frames: 2, art: null };
    check('G10: which line a quiet strip says: its own when any row cannot be placed, the art line only when every row looks like art (DESIGN -114)', quietKind([u]) === 'unsure' && quietKind([u, a]) === 'unsure' && quietKind([a]) === 'art' && quietKind([a, { ...a, row: 'cyan' }]) === 'art');
    check('G11: the line under a row (DESIGN -114): quiet and all unknown, none; quiet and all art, none; quiet and mixed, the art line on the art row only; found strip, each row left alone its own; a ticked row, none',
      rowLine(u, true, 'unsure', true) === null && rowLine(a, true, 'art', true) === null
      && rowLine(a, true, 'unsure', true) === ART_LINE && rowLine(u, true, 'unsure', true) === null
      && rowLine(u, false, 'unsure', true) === UNSURE_LINE && rowLine(a, false, 'unsure', true) === ART_LINE && rowLine(a, false, 'art', true) === ART_LINE
      && rowLine(n, false, 'unsure', true) === ART_LINE
      && rowLine(u, false, 'unsure', false) === null && rowLine(a, false, 'art', false) === null && rowLine(a, true, 'unsure', false) === null);
  }
  check('G8: the refusals and failures, as DESIGN accepted them (2026-11-11-014), and Undo\'s own failure', CLEAN_STALE === 'The sheet changed, so nothing was cleaned. Press Clean again.' && UNDO_STALE === 'The sheet changed, so nothing was undone.' && CLEAN_FAILED === 'Could not clean these frames. Please try again.' && UNDO_FAILED === 'Could not undo. Please try again.' && EMPTY_SCOPE === 'No leftover background in the selected frames.');
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/keyResidue.ts'), 'utf8');
  check('G6: no em dash in the module', !src.includes(String.fromCharCode(0x2014)));
}

// ---- H. the wiring (source with comments stripped) ----
{
  const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
  const read = (rel) => strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const page = read('src/app/upload/page.tsx');
  const grid = read('src/components/sprites/FrameGrid.tsx');
  const band = read('src/components/sprites/LeftoverBackground.tsx');
  // Whitespace-blind: every run of white space is one space.
  const flat = (s) => s.replace(/\s+/g, ' ');
  const has = (src, snippet) => flat(src).includes(flat(snippet));
  // The text of one `const name = useCallback(...)` up to its dependency list.
  const fn = (src, name) => {
    const at = src.indexOf(`const ${name} = useCallback(`);
    if (at < 0) return '';
    const end = src.indexOf('\n  }, [', at);
    return end < 0 ? '' : src.slice(at, src.indexOf(']);', end) + 3);
  };

  check('H1: the page hands the frame grid its guarded commit, the one Align frames uses, and the keys it knows were the background', /<FrameGrid frameDataUrls=\{frameDataUrls\} onCommit=\{handleAlignCommit\} knownBackground=\{knownBackground\} \/>/.test(page) && /<AlignFramesPanel[\s\S]*?onCommit=\{handleAlignCommit\}/.test(page));
  check('H1: the page knows magenta for a sheet Send to Slicer brought, and the key of the color Remove background took from the image now loaded, and nothing else (AUDIT clean-frames r2 H1; HQ 2026-11-24-109)', has(page, "if (fromSlicerHandoff) keys.add('magenta');") && has(page, 'if (bgRemoved && uploaded && bgRemoved.url === uploaded.blobUrl) { const k = keyIndexOf(bgRemoved.color.r, bgRemoved.color.g, bgRemoved.color.b); if (k >= 0) keys.add(KEY_NAMES[k]); }') && (flat(page).match(/keys\.add\(/g) ?? []).length === 2 && has(page, 'setBgRemoved({ url: cleanedDataUrl, color });') && (flat(page).match(/setBgRemoved\(/g) ?? []).length === 1);
  const banner = read('src/components/sprites/BgRemovalBanner.tsx');
  check('H1: the banner reports the color it took with the image it made', has(banner, 'if (previewUrl && bgColor) { onRemoved(previewUrl, bgColor); }') && has(page, '(cleanedDataUrl: string, color: { r: number; g: number; b: number }) => {'));
  check('H1: the grid passes the keys on, and knows none without them', has(grid, 'const NOTHING_KNOWN: ReadonlySet<KeyName> = new Set();') && has(grid, 'knownBackground = NOTHING_KNOWN }: FrameGridProps)') && has(grid, 'knownBackground={knownBackground}'));
  check('H2: the strip sits in the Frames card between the tip line and the thumbnails, only with a commit', (() => {
    const tip = grid.indexOf('Tip: drag a frame into Animations');
    const mount = grid.indexOf('{onCommit && spriteSheet && (');
    const thumbs = grid.indexOf('<div className="grid gap-2"');
    return tip > 0 && tip < mount && mount < thumbs
      && /\{onCommit && spriteSheet && \(\s*<LeftoverBackground\s+key=\{spriteSheet\.id\}\s+sheet=\{spriteSheet\}\s+frameDataUrls=\{frameDataUrls\}\s+selectedFrames=\{selectedFrames\}\s+onCommit=\{onCommit\}\s+onMarks=\{setLeftoverMarks\}\s+knownBackground=\{knownBackground\}\s+\/>/.test(grid);
  })());
  check('H3: the marks are drawn over a thumbnail, hidden from readers and from the pointer', /\{leftoverMarks\?\.get\(frame\.id\) && \(\s*<span\s+aria-hidden\s+data-leftover-marks\s+className="absolute inset-0 pointer-events-none[^"]*"/.test(grid));

  const clean = fn(band, 'handleClean');
  const undo = fn(band, 'handleUndo');
  const dismiss = fn(band, 'handleDismiss');
  const take = fn(band, 'takeRead');
  check('H4: Clean writes through the page\'s commit and gives up when a pixel edit landed meanwhile', has(clean, 'const applied = await onCommit(async () => { await nextTask(); const built = await buildCleanedSheet(sheet, changed, frameDataUrls); committed = built.urls; committedRef.current = built.urls; return stillCurrent() ? built : null; });') && has(band, 'const stillCurrent = useCallback( () => useSpriteStore.getState().frameDataUrls === frameDataUrls, [frameDataUrls] );') && !/replaceSheetSource|updateFrameData|setFrameDataUrls/.test(band));
  check('H4: the cleaned sheet is built on a copy of the frame map, never the store\'s own; a padded frame goes back only as its data URL', has(band, 'const urls = new Map(frameDataUrls);') && has(band, 'if (pixels.width === frame.width && pixels.height === frame.height) { sheetContext.putImageData(image, frame.x, frame.y); }'));
  check('H4: Clean clears only the ticked rows, in scope, each frame once, and only on a read of the frames as they are', has(clean, 'if (done.has(frame.id) || (scope && !scope.has(frame.id))) continue;') && has(clean, 'cleanKeyFrame(before.data, scan, ticked)') && has(clean, 'if (!read || !fresh || ticked.size === 0) return;') && has(band, 'const fresh = read !== null && read.urls === frameDataUrls;'));
  check('H4: the read skips the map the strip itself committed, and drops a read the frames moved on from', has(band, 'if (committedRef.current === frameDataUrls) { committedRef.current = null; return; }') && (flat(band).match(/if \(cancelled\) return;/g) ?? []).length === 2 && has(band, 'return () => { cancelled = true; clearTimeout(timer); };'));
  check('H4: the whole sheet is scanned at one art pixel size, and a cleaned frame at the size it was read in (AUDIT clean-frames r1 M5)', has(band, 'const scans = scanKeySheet(frames);') && has(clean, 'scans.set(frame.id, scanKeyFrame(after.data, after.width, after.height, was?.artPixel));'));
  check('H5: Undo puts back the sheet from before the Clean, through the same commit', has(undo, 'const applied = await onCommit(async () => { await nextTask(); return stillCurrent() ? last.before : null; });') && has(clean, 'before: { sourceImage: sheet.sourceImage, urls: frameDataUrls },') && has(undo, 'takeRead(last.beforeRead, false);'));
  check('H5: Undo is offered only for the frame map the Clean committed, on the same sheet version', has(band, 'const cleanedOpen = cleaned !== null && cleaned.version === sheetVersion && cleaned.urls === frameDataUrls && closed.cleaned !== frameDataUrls;') && has(clean, 'if (now.frameDataUrls === committed) { setCleaned({'));
  check('H5: the Clean, the ticks, each row\'s first default, what was closed and the announcement are kept for the sheet while the card is away, newest sheet only (AUDIT clean-frames r1 M1, M2)', has(band, 'let memory: SheetMemory | null = null;') && has(band, "if (!memory || memory.sheetId !== sheetId) { memory = { sheetId, toggled: new Map(), defaults: new Map(), defaultsKnown: new Set(), cleaned: null, closed: { cleaned: null, found: null }, announced: false }; }") && has(band, 'const [closed, setClosedState] = useState<Closed>(() => mem.closed);') && has(band, 'memoryFor(sheet.id).closed = next;') && has(band, 'const [cleaned, setCleanedState] = useState<Cleaned | null>(() => mem.cleaned);') && has(band, 'const [toggled, setToggledState] = useState<Map<RowId, boolean>>(() => mem.toggled);') && has(band, 'memoryFor(sheet.id).cleaned = next;') && has(band, 'memoryFor(sheet.id).toggled = next;') && !/localStorage|sessionStorage/.test(band));
  check('H5: a Clean or Undo keeps the person\'s ticks; a tick is dropped only when its row is gone from the sheet (M2)', !/setToggled\(new Map\(\)\)/.test(band) && has(take, 'if (prune && [...m.toggled.keys()].some((row) => !present.has(row))) { setToggled(new Map([...m.toggled].filter(([row]) => present.has(row)))); }') && has(band, 'takeRead({ urls: frameDataUrls, frames, scans }, true);') && has(clean, 'takeRead({ urls: committed, frames, scans }, false);') && has(undo, 'takeRead(last.beforeRead, false);'));
  check('H5: a row\'s default is recorded once per sheet, so a Clean cannot turn art into leftover (H1)', has(band, 'if (!m.defaults.has(f.row) || (known.has(f.key) && !m.defaultsKnown.has(f.key))) m.defaults.set(f.row, f.art === null);') && has(band, 'for (const k of known) m.defaultsKnown.add(k);') && has(take, 'const all = keyFindings(next.scans, undefined, knownBackground); rememberDefaults(m, all, knownBackground);') && has(band, 'const findings = useMemo(() => (read ? keyFindings(read.scans, scope, knownBackground) : []), [read, scope, knownBackground]);') && has(band, 'const quietly = tickedRows(keyFindings(scans, undefined, knownBackground), new Map(), m.defaults).size === 0;') && has(band, 'const ticked = useMemo(() => tickedRows(findings, toggled, defaults), [findings, toggled, defaults]);'));
  check('H6: one press at a time', has(band, 'if (busyRef.current) return; busyRef.current = true;') && /void runPress\(async \(\) => \{/.test(clean) && /void runPress\(async \(\) => \{/.test(undo));
  check('H7: the strip is a named region with one polite status line, which speaks only while a strip is there (L9)', (band.match(/role="region"\s+aria-label="Leftover background"/g) ?? []).length === 2 && has(band, '<p className="sr-only" role="status">{status}</p>') && has(band, "const status = cleanedOpen || foundOpen ? said : '';") && (band.match(/role="status"/g) ?? []).length === 1);
  check('H7: found is announced once per sheet, as possible when nothing is ticked by default; Clean, Undo and every refusal say their line', has(band, 'if (found > 0 && !m.announced) { m.announced = true;') && has(band, 'setSaid(quietly ? possibleAnnouncement(found) : foundAnnouncement(found));') && has(clean, 'setSaid(cleanedLine(pixels, changed.length));') && has(undo, 'setSaid(undoneLine(last.frames));') && has(band, 'const refuse = useCallback((text: string) => { setNote(text); setSaid(text); }, []);') && has(clean, 'refuse(CLEAN_STALE);') && has(undo, 'refuse(UNDO_STALE);') && has(band, '}, CLEAN_FAILED);') && has(band, '}, UNDO_FAILED);'));
  check('H8: Clean keeps its focus when it cannot act and says why; Show where is a pressed toggle that turns off after Clean', has(band, 'aria-disabled={noneTicked || emptyScope || dim || undefined} aria-describedby={noneTicked ? reasonId : undefined}') && has(band, '{noneTicked && !quiet && <p id={reasonId} className="mt-2 text-xs text-text-secondary">{NONE_TICKED}</p>}') && /aria-pressed=\{showWhere\}/.test(band) && /setShowWhere\(false\);/.test(clean));
  check('H8: focus moves to the control that replaces a pressed one: Undo after Clean, Clean after Undo, what follows after Dismiss (L1)', has(clean, "focusNextRef.current = 'undo';") && has(undo, "focusNextRef.current = 'clean';") && has(band, "if (target === 'undo' && cleanedOpen) { focusNextRef.current = null; undoButtonRef.current?.focus(); }") && has(dismiss, 'const next = nextFocusable(strip);') && has(dismiss, "if (which === 'cleaned' && cleanButtonRef.current) cleanButtonRef.current.focus(); else next?.focus();"));
  check('H9: a row that starts unticked has its art line tied to its checkbox, only while it is unticked (L9)', has(band, 'const artLine = rowLine(f, quiet, kind, !byDefault(f) && !on);') && has(band, 'aria-describedby={artLine ? `${artNoteId}-${f.row}` : undefined}') && has(band, "{artLine && ( <p id={`${artNoteId}-${f.row}`} className=\"pl-6 text-xs text-text-secondary\"> {artLine} </p> )}"));
  check('H9: one row ticked by default and still ticked is the single line; anything else has a box to untick (L7)', has(band, 'const single = findings.length === 1 && byDefault(findings[0]) && ticked.has(findings[0].row) ? findings[0] : null;'));
  check('H10: the scope switch shows only with a selection, as two pressed buttons in a named group, and goes back to all frames when the selection empties (L6)', has(band, '{hasSelection && ( <div className={`${SCOPE_TRACK} mt-3`} role="group" aria-label="Frames to clean">') && /aria-pressed=\{scope === undefined\}/.test(band) && /aria-pressed=\{scope !== undefined\}/.test(band) && has(band, "if (hadSelection !== hasSelection) { setHadSelection(hasSelection); if (!hasSelection) setScopeMode('all'); }"));
  check('H10: it is the app\'s one switch style, and wraps rather than leave the card (L5)', has(band, "const SCOPE_TRACK = 'flex flex-wrap gap-1 rounded-lg bg-bg-secondary p-1 w-fit max-w-full';") && /const SCOPE_ON = 'bg-accent-amber text-bg-primary';/.test(band) && /className=\{`\$\{SCOPE_BUTTON\} \$\{scope === undefined \? SCOPE_ON : SCOPE_OFF\}`\}/.test(band) && /className=\{`\$\{SCOPE_BUTTON\} \$\{scope !== undefined \? SCOPE_ON : SCOPE_OFF\}`\}/.test(band));
  check('H13: Show where looks pressed when it is: amber border and text', /aria-pressed:border-accent-amber aria-pressed:text-accent-amber/.test(band));
  check('H14: when no row starts ticked and none is ticked the strip is quiet: neutral, one line, no Clean; ticking a row makes it the found strip (L9)', has(band, 'const quiet = findings.length > 0 && findings.every((f) => !byDefault(f)) && ticked.size === 0;') && has(band, "${quiet ? 'border-border-default bg-bg-secondary' : 'border-accent-amber/40 bg-accent-amber/5'}") && has(band, 'const kind = quietKind(findings);') && has(band, "{!quiet ? foundManyLine(listed.frames, scopeTotal) : kind === 'unsure' ? unsureLine(listed.frames, scopeTotal, findings.length) : possibleLine(listed.frames, scopeTotal)}") && has(band, '{!quiet && ( <button ref={cleanButtonRef} type="button" onClick={handleClean}'));
  check('H14: every strip can be closed, for that frame map only; closing the Cleaned line brings back the found strip for what is left (L8); with nothing ticked Show where marks every listed row', (flat(band).match(/aria-label="Dismiss"/g) ?? []).length === 2 && has(band, `<button type="button" onClick={() => handleDismiss(foundRef.current, 'found')} aria-label="Dismiss" className={ICON_BUTTON} >`) && has(band, `<button type="button" onClick={() => handleDismiss(cleanedRef.current, 'cleaned')} aria-label="Dismiss" className={ICON_BUTTON} >`) && has(band, 'const foundOpen = !cleanedOpen && anyOnSheet && closed.found !== frameDataUrls;') && has(band, "setClosed({ ...memoryFor(sheet.id).closed, [which]: frameDataUrls });") && has(band, '(ticked.size === 0 ? new Set(findings.map((f) => f.row)) : ticked)') && has(band, 'marksImage(scan, markRows)') && has(band, 'if (scope && !scope.has(id)) continue; const image = marksImage(scan, markRows);'));
  check('H15: an opaque sheet shows no strip and says nothing (HQ 2026-11-11-051, ruling 2)', has(band, 'read !== null && !sheetIsOpaque(read.scans) && keyTotals(read.scans, ALL_ROWS).frames > 0') && has(band, 'const found = sheetIsOpaque(scans) ? 0 : keyTotals(scans, ALL_ROWS).frames;'));
  check('H16: while a new map is read the last strip stays, still: nothing in it acts and no marks are drawn (L4)', has(band, 'const stale = read !== null && !fresh;') && has(band, 'const marksOn = showWhere && foundOpen && fresh;') && has(band, 'const dim = busy || stale;') && has(band, 'disabled={stale}') && has(band, 'onClick={() => !stale && setShowWhere((on) => !on)}'));
  check('H11: every control is 44 px on touch, and no text is under 12 px', (band.match(/pointer-coarse:min-h-11/g) ?? []).length >= 3 && /pointer-coarse:w-11 pointer-coarse:h-11/.test(band) && !/text-\[(?:[0-9]|1[01])px\]/.test(band));
  check('H12: no em dash in the component', !fs.readFileSync(path.join(ROOT, 'src/components/sprites/LeftoverBackground.tsx'), 'utf8').includes(String.fromCharCode(0x2014)));
}

// ---- S. the art pixel size, and the reach counted in art pixels ----
{
  // A detailed 1:1 sprite (three colors, single pixels among them) with a
  // one-pixel magenta fringe down its right side, 11 px long.
  const W = 44, H = 44;
  const paint = (x, y) => (inBox(x, y, 8, 6, 29, 33) ? ((x * 7 + y * 13) % 5 === 0 ? SKIN : (x + y) % 3 === 0 ? ART : [90, 60, 40, 255]) : inBox(x, y, 30, 10, 30, 20) ? M : null);
  const sprite = image(W, H, paint);
  const up = (px, w, h, s) => image(w * s, h * s, (x, y) => { const c = at(px, w, Math.floor(x / s), Math.floor(y / s)); return c[3] === 0 ? null : c; });
  const placed = (px, w, h, dx, dy) => image(w + 8, h + 8, (x, y) => { const sx = x - dx, sy = y - dy; if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null; const c = at(px, w, sx, sy); return c[3] === 0 ? null : c; });
  check('S1: a 1 to 1 sprite has art pixels of 1', artPixelSize(sprite, W, H) === 1);
  check('S1: scaled up 2, 3, 4, 5, 6 and 8 times it reads 2, 3, 4, 5, 6 and 8', same([2, 3, 4, 5, 6, 8].map((s) => artPixelSize(up(sprite, W, H, s), W * s, H * s)), [2, 3, 4, 5, 6, 8]));
  const x4 = up(sprite, W, H, 4);
  check('S2: a frame cut 1, 2 or 3 px off the sheet\'s grid reads the same', same([[1, 0], [2, 3], [3, 1], [0, 2]].map(([dx, dy]) => artPixelSize(placed(x4, W * 4, H * 4, dx, dy), W * 4 + 8, H * 4 + 8)), [4, 4, 4, 4]));
  const wide = image(W * 4, H, (x, y) => { const c = at(sprite, W, Math.floor(x / 4), y); return c[3] === 0 ? null : c; });
  check('S2: a sprite stretched one way only is not on a grid', artPixelSize(wide, W * 4, H) === 1);
  const dotted = x4.slice();
  for (const [x, y] of [[40, 30], [61, 50], [77, 90], [50, 101], [99, 44], [83, 71]]) dotted.set([255, 255, 255, 255], (y * W * 4 + x) * 4);
  check('S3: a few single pixels drawn on a scaled-up sheet do not hide its size', artPixelSize(dotted, W * 4, H * 4) === 4);
  const noisy = x4.slice();
  for (let p = 0; p < noisy.length / 4; p += 5) if (noisy[p * 4 + 3] !== 0) noisy.set([p % 251, 40, 90, 255], p * 4);
  check('S3: a sheet that is not on a grid reads 1', artPixelSize(noisy, W * 4, H * 4) === 1);
  const flat = image(64, 64, (x, y) => (inBox(x, y, 8, 8, 39, 47) ? ART : inBox(x, y, 40, 16, 47, 31) ? M : null));
  check('S4: an empty frame and a few flat boxes say nothing: 1', artPixelSize(new Uint8ClampedArray(32 * 32 * 4), 32, 32) === 1 && artPixelSize(flat, 64, 64) === 1 && artPixelSize(new Uint8ClampedArray(4), 1, 1) === 1);
  const stairs = image(16, 16, (x, y) => (Math.floor(x / 2) === Math.floor(y / 2) && x >= 2 && x < 12 ? ART : null));
  check('S4: five 2 px steps are too few color changes to say anything', artPixelSize(stairs, 16, 16) === 1);
  check('S4: the limits: sizes to 8, nearly all changes on one grid, enough of them', ART_PIXEL_MAX === 8 && ART_PIXEL_FIT > 0.9 && ART_PIXEL_FIT < 1 && ART_PIXEL_MIN_EDGES >= 12 && ART_PIXEL_MIN_LINES >= 4);

  // The same leftover, counted in art pixels at every size.
  const s1 = scanKeyFrame(sprite, W, H);
  check('S5: at 1 to 1 the fringe is leftover on the cut edge', s1.artPixel === 1 && same(counts(s1, 'magenta'), { edge: 11, inside: 0, thick: 0 }));
  for (const s of [2, 4, 8]) {
    const sc = scanKeyFrame(up(sprite, W, H, s), W * s, H * s);
    check(`S5: scaled up ${s} times the fringe is ${s} px thick and still leftover, all of it marked`, sc.artPixel === s && same(counts(sc, 'magenta'), { edge: 11 * s * s, inside: 0, thick: 0 }) && marked(sc) === 11 * s * s, counts(sc, 'magenta'));
  }
  // A cape 8 art pixels thick is art at every size; so is a speck 5 art
  // pixels away from the art.
  const withCape = image(W, H, (x, y) => paint(x, y) ?? (inBox(x, y, 31, 22, 38, 29) ? M : inBox(x, y, 2, 14, 2, 14) ? M : null));
  for (const s of [1, 4]) {
    const sc = scanKeyFrame(up(withCape, W, H, s), W * s, H * s);
    check(`S6: at ${s} px per art pixel a thick cape and a stray speck are left whole, and the fringe they do not touch is still leftover`, sc.artPixel === s && same(counts(sc, 'magenta'), { edge: 11 * s * s, inside: 0, thick: 65 * s * s }), counts(sc, 'magenta'));
  }
  const lib = fs.readFileSync(path.join(ROOT, 'src/lib/keyResidue.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('S7: the scan takes the sheet\'s art pixel (or measures the frame) and counts its reach in it, in both places', /scan\.artPixel = artPixel \?\? artPixelSize\(px, W, H\);\s*const reach = RESIDUE_REACH \* scan\.artPixel;/.test(lib) && /d <= reach \+ 1 && frontier\.length > 0/.test(lib) && /if \(dist\[p\] > reach\) far = true;/.test(lib) && (lib.match(/RESIDUE_REACH/g) ?? []).length === 2, (lib.match(/RESIDUE_REACH/g) ?? []).length);
}

// ---- S8. the sheet's art pixel (AUDIT clean-frames r1 M5) ----
{
  const W = 32, H = 32;
  const paint = (x, y) => (inBox(x, y, 6, 4, 21, 25) ? ((x * 7 + y * 13) % 5 === 0 ? SKIN : (x + y) % 3 === 0 ? ART : [90, 60, 40, 255]) : inBox(x, y, 22, 8, 22, 15) ? M : null);
  const detailed = image(W, H, paint);
  const box = image(W, H, (x, y) => (inBox(x, y, 6, 4, 21, 25) ? ART : inBox(x, y, 22, 8, 22, 15) ? M : null));
  const up = (px, w, h, s) => image(w * s, h * s, (x, y) => { const c = at(px, w, Math.floor(x / s), Math.floor(y / s)); return c[3] === 0 ? null : c; });
  const stairs = image(16, 16, (x, y) => (Math.floor(x / 2) === Math.floor(y / 2) && x >= 2 && x < 12 ? ART : null));
  check('S8: too few color changes, or too few places, say nothing: null', artPixelRead(new Uint8ClampedArray(32 * 32 * 4), 32, 32) === null && artPixelRead(stairs, 16, 16) === null && artPixelRead(new Uint8ClampedArray(4), 1, 1) === null);
  check('S8: a plain frame cannot say its art pixel; a detailed one can', artPixelRead(box, W, H) === null && artPixelRead(detailed, W, H) === 1 && artPixelRead(up(detailed, W, H, 4), W * 4, H * 4) === 4 && artPixelSize(box, W, H) === 1);
  check('S8: the sheet takes the size most frames that can say agree on, the smaller on a tie, 1 when none can', sheetArtPixel([4, 4, null, null]) === 4 && sheetArtPixel([4, 1, 4]) === 4 && sheetArtPixel([4, 1]) === 1 && sheetArtPixel([null, null]) === 1 && sheetArtPixel([]) === 1);
  const frames = new Map([
    ['f1', { data: up(detailed, W, H, 4), width: W * 4, height: H * 4 }],
    ['f2', { data: up(detailed, W, H, 4), width: W * 4, height: H * 4 }],
    ['f3', { data: up(box, W, H, 4), width: W * 4, height: H * 4 }],
    ['f4', { data: up(box, W, H, 4), width: W * 4, height: H * 4 }],
  ]);
  const scans = scanKeySheet(frames);
  check('S8: on a scaled sheet two plain frames take the sheet\'s size: every frame\'s 4 px fringe is leftover, none of it thick', [...scans.values()].every((s) => s.artPixel === 4 && same(counts(s, 'magenta'), { edge: 8 * 16, inside: 0, thick: 0 })), [...scans.values()].map((s) => [s.artPixel, counts(s, 'magenta')]));
  const own = new Map([...frames].map(([id, f]) => [id, scanKeyFrame(f.data, f.width, f.height)]));
  check('S8: read frame by frame the plain ones would have called it thick (what M5 found)', counts(own.get('f3'), 'magenta').thick === 8 * 16);
}

console.log(failed === 0 ? '\nall pass' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
