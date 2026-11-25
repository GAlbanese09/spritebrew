// scripts/outline-clean-test.mjs
//
// Offline tests for src/lib/outlineClean.ts, the white outline clean
// (George, Nov 24, 2026; DESIGN's ticket design/tickets/outline-clean.md):
// what counts as near-white, the ring test, the thickness test, that the
// sticker's colour is taken however deep its hollows go, that its fringe is
// taken as deep as the ring is thick, and that white art inside the dark
// outline (eyes, a shirt) and a thick white border are never taken; then the
// editor's "Erase area" flood. Run from the repo root:
// `node scripts/outline-clean-test.mjs`. Bundles the module with esbuild
// into local/.outline-clean-test/ (gitignored); every image is made up here
// as RGBA arrays. Prints only case names and pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.outline-clean-test', 'outlineClean.mjs');
const OUT_R = path.join(ROOT, 'local', '.outline-clean-test', 'residueCleanup.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/outlineClean.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
await build({
  entryPoints: [path.join(ROOT, 'src/lib/residueCleanup.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT_R, logLevel: 'silent',
});
const {
  OUTLINE_MIN, OUTLINE_SPREAD, OUTLINE_MATCH, OUTLINE_EDGE_SHARE, OUTLINE_MAX_THICKNESS, OUTLINE_CLEAR,
  OUTLINE_SLACK, OUTLINE_HUG, OUTLINE_MAX_SHARE, tapAgainLine, patchShape,
  ERASE_AREA_MAX, ERASE_AREA_DEFAULT, isNearWhite, scanOutline, cleanOutline, floodRegion, eraseRegion,
  outlineFoundLine, outlineCleanedLine, OUTLINE_RESTORED, editorOutlineCleaned, erasedLine, NO_OUTLINE_TITLE,
} = await import(pathToFileURL(OUT).href);
const { residueOverlay, RESIDUE_CLEAR, OVERLAY_CLEAR } = await import(pathToFileURL(OUT_R).href);

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

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
const count = (kinds) => kinds.reduce((n, k) => n + (k === OUTLINE_CLEAR ? 1 : 0), 0);

const STICKER = [254, 254, 254, 255];
const LINE = [30, 28, 40, 255];
const BODY = [120, 60, 40, 255];
const WHITE_ART = [250, 250, 250, 255];

// A made-up character: a body from (x0, y0) to (x1, y1) with a 1 px dark
// outline, white eyes and a white shirt inside, and a sticker ring of
// `ring` px (Chebyshev distance from the body) around it.
function character({ W = 48, H = 48, x0 = 14, y0 = 12, x1 = 33, y1 = 35, ring = 3, ringPx = STICKER, outer = null, notch = 0, fringe = null } = {}) {
  return image(W, H, (x, y) => {
    const inBody = x >= x0 && x <= x1 && y >= y0 && y <= y1;
    // A notch: a gap `notch` px deep from the bottom, between two legs, 2 px wide at the middle.
    const mid = (x0 + x1) >> 1;
    const inNotch = notch > 0 && y > y1 - notch && x >= mid - 1 && x <= mid + 2;
    if (inBody && !inNotch) {
      const edgeOfNotch = notch > 0 && y > y1 - notch - 1 && x >= mid - 2 && x <= mid + 3;
      if (x === x0 || x === x1 || y === y0 || y === y1 || edgeOfNotch) return LINE;
      if (y === y0 + 4 && (x === x0 + 5 || x === x1 - 5)) return WHITE_ART;
      if (y >= y0 + 9 && y <= y0 + 12 && x >= x0 + 3 && x <= x1 - 3) return WHITE_ART;
      return BODY;
    }
    const dx = Math.max(x0 - x, 0, x - x1);
    const dy = Math.max(y0 - y, 0, y - y1);
    const d = Math.max(dx, dy);
    if (inNotch) return ringPx;
    if (d >= 1 && d <= ring) {
      if (fringe && d === 1) return fringe;
      return ringPx;
    }
    if (outer && d === ring + 1) return outer;
    return null;
  });
}

// 1. Near-white.
check('N1: near-white is every channel at OUTLINE_MIN or more and a spread of OUTLINE_SPREAD or less',
  OUTLINE_MIN === 215 && OUTLINE_SPREAD === 30 && isNearWhite(215, 215, 215) && !isNearWhite(214, 255, 255)
  && isNearWhite(255, 225, 255) && !isNearWhite(255, 224, 255) && isNearWhite(254, 254, 254) && !isNearWhite(200, 200, 200));
check('N2: the constants as set', OUTLINE_MATCH === 8 && OUTLINE_EDGE_SHARE === 0.6 && OUTLINE_MAX_THICKNESS === 12
  && OUTLINE_SLACK === 2 && OUTLINE_HUG === 0.8 && OUTLINE_MAX_SHARE === 0.9
  && OUTLINE_CLEAR === RESIDUE_CLEAR && ERASE_AREA_MAX === 64 && ERASE_AREA_DEFAULT === 24);

// 2. The ticket's fixtures.
{
  const W = 48, H = 48;
  const px = character({ ring: 3 });
  const s = scanOutline(px, W, H);
  // Ring pixels: the 26 x 30 box (Chebyshev 3 around 20 x 24) minus the body.
  const ringN = (20 + 6) * (24 + 6) - 20 * 24;
  check('A1 (ticket 2a): a 3 px ring around a dark outline: the ring colour, share 1, thickness 3, exactly the ring',
    JSON.stringify(s.colour) === '[254,254,254]' && s.edgeShare === 1 && s.thickness === 3 && s.count === ringN && count(s.kinds) === ringN,
    { colour: s.colour, share: s.edgeShare, t: s.thickness, n: s.count, ringN });
  const after = new Uint8ClampedArray(px);
  const n = cleanOutline(after, W, H);
  let kept = true;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    const same = after[i] === px[i] && after[i + 1] === px[i + 1] && after[i + 2] === px[i + 2] && after[i + 3] === px[i + 3];
    if (s.kinds[p] ? after[i + 3] !== 0 || after[i] !== 0 : !same) kept = false;
  }
  check('A2 (ticket 2a): the clean takes only the ring, to (0,0,0,0); the white eyes and the white shirt inside stay',
    n === ringN && kept && JSON.stringify(at(after, W, 19, 16)) === JSON.stringify(WHITE_ART) && JSON.stringify(at(after, W, 20, 22)) === JSON.stringify(WHITE_ART));
  check('A3: a second clean changes nothing', cleanOutline(new Uint8ClampedArray(after), W, H) === 0 && scanOutline(after, W, H).count === 0);
  const ov = residueOverlay(s.kinds, W, H);
  let marks = 0, right = true;
  for (let p = 0; p < W * H; p++) {
    if (ov[p * 4 + 3]) {
      marks++;
      if (!s.kinds[p] || ov[p * 4] !== OVERLAY_CLEAR[0] || ov[p * 4 + 1] !== OVERLAY_CLEAR[1] || ov[p * 4 + 2] !== OVERLAY_CLEAR[2]) right = false;
    }
  }
  check('A4: residueOverlay marks exactly what the clean takes, in its cyan', marks === ringN && right);
}
{
  // 2b: no ring, the white shirt reaching the outside on the left.
  const W = 48, H = 48;
  const px = image(W, H, (x, y) => {
    if (x < 14 || x > 33 || y < 12 || y > 35) return null;
    if (y >= 21 && y <= 24 && x <= 30) return WHITE_ART;
    if (x === 14 || x === 33 || y === 12 || y === 35) return LINE;
    return BODY;
  });
  const s = scanOutline(px, W, H);
  check('B1 (ticket 2b): no ring, a white shirt touching the outside: nothing is offered', s.count === 0 && s.edgeShare < OUTLINE_EDGE_SHARE, { n: s.count, share: s.edgeShare });
  const before = new Uint8ClampedArray(px);
  check('B2: and the clean changes nothing', cleanOutline(px, W, H) === 0 && px.every((v, i) => v === before[i]));
}
{
  // 2c: a see-through outer edge of the ring's colour.
  const W = 48, H = 48;
  const px = character({ ring: 3, outer: [254, 254, 254, 128] });
  const s = scanOutline(px, W, H);
  const ringN = (20 + 8) * (24 + 8) - 20 * 24;
  check('C1 (ticket 2c): a ring with a see-through outer edge: all of it goes', s.count === ringN && s.thickness === 4, { n: s.count, ringN, t: s.thickness });
}
{
  // 2d: a 14 px white border.
  const W = 64, H = 64;
  const px = character({ W, H, x0: 22, y0: 20, x1: 41, y1: 43, ring: 14 });
  const s = scanOutline(px, W, H);
  check('D1 (ticket 2d): a white border 14 px thick is not a ring: nothing is offered', s.count === 0 && s.thickness === 14, { n: s.count, t: s.thickness });
  const px12 = character({ W, H, x0: 22, y0: 20, x1: 41, y1: 43, ring: 12 });
  const s12 = scanOutline(px12, W, H);
  check('D2: at 12 px it is still a ring', s12.count > 0 && s12.thickness === 12, { n: s12.count, t: s12.thickness });
}

// 3. Hollows, fringe and light art.
{
  const W = 48, H = 48;
  const px = character({ ring: 3, notch: 15 });
  const s = scanOutline(px, W, H);
  // The notch is 4 px wide and 15 deep; its far end is 15 + 3 steps from the outside.
  let deep = 0;
  for (let y = 36 - 15; y <= 35; y++) for (let x = 22; x <= 25; x++) if (s.kinds[y * W + x]) deep++;
  check('H1: the sticker in a hollow 15 px deep (past the ring\'s thickness) is taken whole', s.thickness === 3 && deep === 60, { t: s.thickness, deep });
}
{
  const W = 48, H = 48;
  const FRINGE = [225, 223, 232, 255];
  const px = character({ ring: 3, fringe: FRINGE });
  const s = scanOutline(px, W, H);
  const ringN = (20 + 6) * (24 + 6) - 20 * 24;
  check('F1: the sticker\'s lighter fringe next to the art (within the ring\'s thickness) goes with it', s.count === ringN && s.thickness === 3 && JSON.stringify(s.colour) === '[254,254,254]',
    { n: s.count, ringN, t: s.thickness });
}
{
  // Light art reached through near-white past the ring's thickness stays.
  const W = 48, H = 48;
  const LIGHT = [228, 226, 234, 255];
  const px = image(W, H, (x, y) => {
    const inBody = x >= 14 && x <= 33 && y >= 12 && y <= 35;
    const d = Math.max(Math.max(14 - x, 0, x - 33), Math.max(12 - y, 0, y - 35));
    if (inBody) {
      // A light patch 4 px deep on the left, then the dark outline.
      if (x <= 17 && y >= 20 && y <= 26) return LIGHT;
      if (x === 18 || x === 14 || x === 33 || y === 12 || y === 35) return LINE;
      return BODY;
    }
    return d >= 1 && d <= 3 ? STICKER : null;
  });
  const s = scanOutline(px, W, H);
  let lightTaken = 0, lightKept = 0;
  for (let y = 20; y <= 26; y++) for (let x = 14; x <= 17; x++) {
    if (s.kinds[y * W + x]) lightTaken++; else lightKept++;
  }
  check('L1: light art that starts past the ring\'s thickness stays, all of it (the fringe within it goes: F1)', s.thickness === 3 && lightKept === 28 && lightTaken === 0,
    { t: s.thickness, lightTaken, lightKept });
}
{
  // Shaded white art on the whole edge (a snowman), no sticker: no single
  // colour covers the edge, so nothing is offered.
  const W = 40, H = 40;
  const shades = [[250, 250, 252, 255], [238, 240, 246, 255], [226, 230, 240, 255]];
  const px = image(W, H, (x, y) => {
    const d = Math.hypot(x - 20, y - 20);
    if (d > 14) return null;
    if (d < 4) return LINE;
    return shades[(x + y) % 3];
  });
  const s = scanOutline(px, W, H);
  check('S1: a shaded white character with no sticker: nothing is offered', s.count === 0 && s.edgeShare < OUTLINE_EDGE_SHARE, { n: s.count, share: s.edgeShare });
}
{
  const W = 10, H = 10;
  check('E1: an empty or all-transparent image: nothing', scanOutline(new Uint8ClampedArray(0), 0, 0).count === 0
    && scanOutline(new Uint8ClampedArray(W * H * 4), W, H).colour === null && scanOutline(new Uint8ClampedArray(W * H * 4), W, H).count === 0);
  const blob = image(W, H, (x, y) => (x >= 3 && x <= 6 && y >= 3 && y <= 6 ? STICKER : null));
  check('E2: a white blob that never meets art: no thickness, nothing', scanOutline(blob, W, H).count === 0 && scanOutline(blob, W, H).thickness === 0);
  check('E3: a short buffer is refused', scanOutline(new Uint8ClampedArray(8), W, H).count === 0);
}
{
  // The image edge is the outside too: a sticker that runs off the image.
  const W = 30, H = 30;
  const px = image(W, H, (x, y) => {
    if (x >= 8 && x <= 21 && y >= 8 && y <= 21) return x === 8 || x === 21 || y === 8 || y === 21 ? LINE : BODY;
    return STICKER;
  });
  const s = scanOutline(px, W, H);
  check('E4: a sticker filling to the image edge (no transparency): the edge is the outside; thickness 8 is a ring', s.thickness === 8 && s.count === W * H - 14 * 14, { t: s.thickness, n: s.count });
}
{
  // The thickness is the most common meeting depth; a tie takes the smaller:
  // a ring 1 px thick on the left and top and 2 px on the right and bottom
  // meets the art as often at depth 1 as at depth 2.
  const W = 22, H = 22;
  const px = image(W, H, (x, y) => {
    if (x >= 5 && x <= 14 && y >= 5 && y <= 14) return LINE;
    if (x >= 4 && x <= 16 && y >= 4 && y <= 16) return STICKER;
    return null;
  });
  const s = scanOutline(px, W, H);
  check('T1: a tie between meeting depths takes the smaller', s.thickness === 1 && s.count === 13 * 13 - 100, { t: s.thickness, n: s.count });
}
{
  // 4-way steps: sticker-coloured art inside the dark outline, next to the
  // sticker only diagonally across the outline's corner, is not reached.
  const W = 22, H = 22;
  const px = image(W, H, (x, y) => {
    if (x === 5 && y === 5) return STICKER; // the sticker fills the outline's corner
    if (x === 6 && y === 6) return STICKER; // art in the sticker's colour, inside
    if (x >= 5 && x <= 14 && y >= 5 && y <= 14) return x === 5 || x === 14 || y === 5 || y === 14 ? LINE : BODY;
    if (x >= 3 && x <= 16 && y >= 3 && y <= 16) return STICKER;
    return null;
  });
  const s = scanOutline(px, W, H);
  check('T2: art in the sticker\'s colour that touches it only diagonally, across the dark outline, stays', s.count > 0 && s.kinds[5 * W + 5] === OUTLINE_CLEAR && s.kinds[6 * W + 6] === 0, { n: s.count });
}

{
  // A hollow between two legs, w px wide and 15 deep, filled with the
  // sticker. A sticker 3 px thick fills a gap up to 6 px wide (3 from each
  // leg): at w = 6 its middle lies 3 from the legs and it goes whole; at
  // w = 8 its middle lies 4, wider than a sticker of 3 makes, so it stays.
  const hollow = (w) => {
    const W = 48, H = 48, L = 23 - Math.ceil(w / 2);
    return image(W, H, (x, y) => {
      const inBody = x >= 8 && x <= 39 && y >= 6 && y <= 37;
      const inNotch = y >= 23 && x > L && x <= L + w;
      if (inBody && inNotch) return STICKER;
      if (inBody) {
        if (x === 8 || x === 39 || y === 6 || y === 37 || (y >= 22 && (x === L || x === L + w + 1)) || (y === 22 && x >= L && x <= L + w + 1)) return LINE;
        return BODY;
      }
      const d = Math.max(Math.max(8 - x, 0, x - 39), Math.max(6 - y, 0, y - 37));
      return d >= 1 && d <= 3 ? STICKER : null;
    });
  };
  const ringN = 38 * 38 - 32 * 32;
  const s6 = scanOutline(hollow(6), 48, 48);
  check('H2: a sticker-filled hollow 6 px wide (its middle 3 px from the art, the ring\'s thickness) goes whole', s6.thickness === 3 && s6.count === ringN + 6 * 15, { t: s6.thickness, n: s6.count, want: ringN + 90 });
  const s8 = scanOutline(hollow(8), 48, 48);
  check('H3: one 8 px wide (its middle 4 px from the art) stays: wider than a sticker of 3 fills', s8.thickness === 3 && s8.count === ringN, { t: s8.thickness, n: s8.count, want: ringN });
}
{
  // A flat white glove at the edge of a sprite with no sticker: the hug and
  // the distance would allow it, the ring test does not.
  const W = 48, H = 48;
  const px = image(W, H, (x, y) => {
    if (x < 14 || x > 33 || y < 12 || y > 35) return null;
    if (x >= 31 && y >= 24 && y <= 26) return WHITE_ART;
    if (x === 14 || x === 33 || y === 12 || y === 35) return LINE;
    return BODY;
  });
  const s = scanOutline(px, W, H);
  check('B3: a flat white glove at the edge, no sticker: nothing is offered (the ring test)', s.count === 0 && s.edgeShare < OUTLINE_EDGE_SHARE, { n: s.count, share: s.edgeShare });
}

// 3b. AUDIT's M1 (outline clean r1): white art past the ring, and white
// sprites with no dark outline. AUDIT's own made-up cases, as it drew them.
{
  const W = 48, H = 48;
  const WH = [255, 255, 255], DK = [30, 25, 35], SK = [230, 180, 140], GR = [150, 150, 160];
  const draw = (paint) => { const px = new Uint8ClampedArray(W * H * 4); paint((x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; px.set([...c, 255], (y * W + x) * 4); }); return px; };
  const figure = (set, { shirt, gap }) => {
    for (let y = 10; y < 40; y++) for (let x = 16; x < 32; x++) set(x, y, y < 20 ? SK : shirt);
    for (let y = 10; y < 40; y++) { set(15, y, DK); set(32, y, DK); }
    for (let x = 15; x < 33; x++) { set(x, 9, DK); set(x, 40, DK); }
    set(19, 14, WH); set(28, 14, WH);
    if (gap) set(15, 30, shirt);
  };
  const ring3 = (set) => { for (let y = 6; y < 44; y++) for (let x = 12; x < 36; x++) if (!(x >= 15 && x <= 32 && y >= 9 && y <= 40)) set(x, y, WH); };
  const ringN = 24 * 38 - 18 * 32;

  const gapPx = draw((s) => { figure(s, { shirt: WH, gap: true }); ring3(s); });
  const g = scanOutline(gapPx, W, H);
  check('M1a: a white shirt behind a one-pixel gap in the outline stays; the clean takes the ring only', g.count === ringN && !g.kinds[25 * W + 24] && !g.kinds[30 * W + 15], { n: g.count, ringN });

  const ghost = draw((s) => { for (let y = 8; y < 42; y++) for (let x = 12; x < 36; x++) s(x, y, WH); for (let y = 10; y < 40; y++) { s(14, y, GR); s(33, y, GR); } for (let x = 14; x < 34; x++) s(x, 39, GR); s(20, 18, DK); s(27, 18, DK); });
  const gh = scanOutline(ghost, W, H);
  let bodyKept = 0;
  for (let y = 10; y < 39; y++) for (let x = 15; x < 33; x++) if (!gh.kinds[y * W + x]) bodyKept++;
  check('M1b: a white ghost whose grey line runs 2 px in: only the 2 px shell outside the line is offered; the body inside stays', gh.thickness === 2 && gh.count === 216 && bodyKept === 29 * 18, { t: gh.thickness, n: gh.count, bodyKept });

  const cat = draw((s) => { for (let y = 12; y < 40; y++) for (let x = 14; x < 34; x++) s(x, y, WH); for (const [x, y] of [[15, 13], [32, 13], [15, 38], [32, 38], [23, 13], [24, 13]]) s(x, y, GR); s(19, 20, DK); s(28, 20, DK); s(23, 24, DK); s(24, 24, DK); });
  const ct = scanOutline(cat, W, H);
  check('M1c: a white cat with no dark outline: its edge does not hug any art, so nothing is offered', ct.count === 0 && ct.hug < OUTLINE_HUG && ct.edgeShare === 1, { n: ct.count, hug: ct.hug });

  const strap = draw((s) => { figure(s, { shirt: [60, 90, 160], gap: false }); ring3(s); for (let y = 24; y < 36; y++) { s(16, y, WH); s(17, y, WH); } s(15, 30, WH); });
  const st = scanOutline(strap, W, H);
  check('M1d (the known limit): a white strap 2 px wide behind a gap, all within reach of the art, goes with the ring', st.count === ringN + 25 && st.kinds[30 * W + 16] === OUTLINE_CLEAR, { n: st.count, want: ringN + 25 });

  const shut = draw((s) => { figure(s, { shirt: [60, 90, 160], gap: false }); ring3(s); for (let y = 30; y < 33; y++) for (let x = 22; x < 25; x++) s(x, y, WH); });
  const sh = scanOutline(shut, W, H);
  check('M1e: a patch of the ring\'s colour the art closes in stays', sh.count === ringN && !sh.kinds[31 * W + 23], { n: sh.count });
}
{
  // A rounded corner: the dark outline has no corner pixel, the sticker
  // fills it, and white art just inside touches the sticker only
  // diagonally. 4-way steps never reach it.
  const W = 48, H = 48;
  const px = image(W, H, (x, y) => {
    const inBody = x >= 14 && x <= 33 && y >= 12 && y <= 35;
    if (inBody) {
      if (x === 14 && y === 12) return null;
      if (x === 15 && y === 13) return WHITE_ART;
      if (x === 14 || x === 33 || y === 12 || y === 35) return LINE;
      return BODY;
    }
    const d = Math.max(Math.max(14 - x, 0, x - 33), Math.max(12 - y, 0, y - 35));
    return d >= 1 && d <= 3 ? STICKER : null;
  });
  // The cut corner is filled by the sticker too.
  px.set(STICKER, (12 * W + 14) * 4);
  const s = scanOutline(px, W, H);
  check('T3: white art that touches the sticker only diagonally, in a rounded corner, stays', s.kinds[13 * W + 15] === 0 && s.count === 26 * 30 - 20 * 24 + 1, { n: s.count, art: s.kinds[13 * W + 15] });
}
{
  // A diagonal line: the corner of the body is cut by a one-pixel staircase
  // of the dark outline, the sticker there is one pixel thick (so its
  // pixels are on the outside), and white art just inside touches it only
  // diagonally across the line. 4-way steps never cross it.
  const W = 48, H = 48;
  const s0 = (x, y) => (x - 14) + (y - 12);
  const px = image(W, H, (x, y) => {
    const inBox = x >= 14 && x <= 33 && y >= 12 && y <= 35;
    const corner = x <= 17 && y <= 15;
    if (inBox && s0(x, y) < 3) return s0(x, y) === 2 ? STICKER : null;
    if (inBox) {
      if (s0(x, y) === 3 || x === 14 || x === 33 || y === 12 || y === 35) return LINE;
      if (x === 15 && y === 15) return WHITE_ART;
      return BODY;
    }
    if (corner || (x < 14 && y < 18) || (y < 12 && x < 20)) return null;
    const d = Math.max(Math.max(14 - x, 0, x - 33), Math.max(12 - y, 0, y - 35));
    return d >= 1 && d <= 3 ? STICKER : null;
  });
  const s = scanOutline(px, W, H);
  check('T4: white art just inside a diagonal line, across from a thin sticker, stays (4-way steps)', s.count > 0 && s.kinds[15 * W + 15] === 0 && s.kinds[14 * W + 14] === OUTLINE_CLEAR, { n: s.count, art: s.kinds[15 * W + 15] });
}
{
  // The hug at its limit: the top and bottom bands are T + 2 = 5 px thick,
  // the sides 3, so the top and bottom edges lie exactly T + 2 from the art.
  const W = 48, H = 48;
  const px = image(W, H, (x, y) => {
    const inBody = x >= 14 && x <= 33 && y >= 12 && y <= 35;
    if (inBody) return x === 14 || x === 33 || y === 12 || y === 35 ? LINE : BODY;
    const dx = Math.max(14 - x, 0, x - 33);
    const dy = Math.max(12 - y, 0, y - 35);
    return dx <= 3 && dy <= 5 && (dx > 0 || dy > 0) ? STICKER : null;
  });
  const s = scanOutline(px, W, H);
  check('H4: a ring whose edge lies exactly T + 2 from the art still hugs it, and goes whole', s.thickness === 3 && s.hug === 1 && s.count === 26 * 34 - 20 * 24, { t: s.thickness, hug: s.hug, n: s.count });
}

// 3c. AUDIT's M1 round 2: white art with detail behind a gap, a narrow plain
// shirt behind a gap, and a textured ghost (DESIGN's ticket v3, 2(f) and 2(g)).
{
  const W = 48, H = 48;
  const WH = [255, 255, 255], DK = [30, 25, 35], SK = [230, 180, 140], GR = [150, 150, 160], LG = [190, 190, 200];
  const draw = (paint) => { const px = new Uint8ClampedArray(W * H * 4); paint((x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; px.set([...c, 255], (y * W + x) * 4); }); return px; };
  const shirt = (x0, x1, gap, extra) => draw((set) => {
    for (let y = 10; y < 40; y++) for (let x = x0; x < x1; x++) set(x, y, y < 20 ? SK : WH);
    for (let y = 10; y < 40; y++) { set(x0 - 1, y, DK); set(x1, y, DK); }
    for (let x = x0 - 1; x < x1 + 1; x++) { set(x, 9, DK); set(x, 40, DK); }
    for (let g = 0; g < gap; g++) set(x0 - 1, 30 + g, WH);
    if (extra) extra(set);
    for (let y = 6; y < 44; y++) for (let x = x0 - 4; x < x1 + 4; x++) if (!(x >= x0 - 1 && x <= x1 && y >= 9 && y <= 40)) set(x, y, WH);
  });
  const ringOf = (x0, x1) => (x1 - x0 + 8) * 38 - (x1 - x0 + 2) * 32;
  const shirtTaken = (s, x0, x1) => { let n = 0; for (let y = 20; y < 40; y++) for (let x = x0; x < x1; x++) if (s.kinds[y * W + x]) n++; return n; };
  const buttons = scanOutline(shirt(16, 32, 1, (set) => { for (const y of [22, 26, 30, 34, 38]) set(23, y, DK); }), W, H);
  check('M2a: a white shirt with dark buttons behind a gap stays; the clean takes the ring only', buttons.count === ringOf(16, 32) && shirtTaken(buttons, 16, 32) === 0, { n: buttons.count, want: ringOf(16, 32) });
  const fold = scanOutline(shirt(16, 32, 3, (set) => { for (let y = 22; y < 39; y++) set(23, y, GR); }), W, H);
  check('M2b: a white shirt with a fold line behind a 3 px gap stays', fold.count === ringOf(16, 32) && shirtTaken(fold, 16, 32) === 0, { n: fold.count });
  const narrow = scanOutline(shirt(20, 28, 1), W, H);
  check('M2c: a plain white shirt only 8 px wide behind a 1 px gap stays: it meets the ring only at the gap', narrow.count === ringOf(20, 28) && shirtTaken(narrow, 20, 28) === 0, { n: narrow.count, want: ringOf(20, 28) });
  const six = scanOutline(shirt(21, 27, 1), W, H);
  check('M2j: a plain white shirt 6 px wide (as narrow as a sticker of 3 fills) behind a 1 px gap stays: it meets the ring only at the gap', six.count === ringOf(21, 27) && shirtTaken(six, 21, 27) === 0, { n: six.count, want: ringOf(21, 27) });
  const ghost = draw((s) => { for (let y = 8; y < 42; y++) for (let x = 12; x < 36; x++) s(x, y, WH); for (let y = 10; y < 40; y++) { s(14, y, GR); s(33, y, GR); } for (let x = 14; x < 34; x++) s(x, 39, GR); s(20, 18, DK); s(27, 18, DK); for (let y = 10; y < 38; y += 5) for (let x = 16 + (y % 2); x < 33; x += 5) s(x, y, LG); });
  const gt = scanOutline(ghost, W, H);
  check('M2d: a ghost with light texture dots inside: at most its 2 px shell (216), never its body', gt.count === 216 && gt.thickness === 2, { n: gt.count, t: gt.thickness });
  // patchShape on its own: a 9 px wide hollow open along its width, and a
  // patch that meets the shell through one pixel.
  const Wp = 20, Hp = 20;
  const hollow = [];
  for (let y = 5; y < 15; y++) for (let x = 4; x < 13; x++) hollow.push(y * Wp + x);
  const hs = patchShape(hollow, Wp, Hp, (q) => Math.floor(q / Wp) === 15 && q % Wp >= 4 && q % Wp < 13);
  check('M2e: a 9 px wide patch: half 5 (its middle column), mouth 9 where it meets the shell along its width', hs.half === 5 && hs.mouth === 9, hs);
  const holed = hollow.filter((q) => q !== 9 * Wp + 8);
  const hh = patchShape(holed, Wp, Hp, (q) => q === 15 * Wp + 4);
  check('M2f: a hole inside the patch is filled (half still 5); one pixel of contact is a mouth of 1', hh.half === 5 && hh.mouth === 1, hh);
  check('M2g: a pixel that touches the shell only diagonally is no mouth', patchShape([5 * Wp + 5], Wp, Hp, (q) => q === 4 * Wp + 4).mouth === 0
    && patchShape([5 * Wp + 5], Wp, Hp, (q) => q === 4 * Wp + 5).mouth === 1);
  const wide = [];
  for (let y = 2; y < 18; y++) for (let x = 2; x < 18; x++) wide.push(y * Wp + x);
  check('M2h: half is the true depth, however wide the patch', patchShape(wide, Wp, Hp, () => false).half === 8);
  const frame = [];
  for (let y = 4; y < 11; y++) for (let x = 4; x < 11; x++) if (!(x >= 6 && x <= 8 && y >= 6 && y <= 8)) frame.push(y * Wp + x);
  check('M2i: half is read on the patch\'s own pixels: a frame 2 px wide round a filled hole is 2, not the hole\'s 4', patchShape(frame, Wp, Hp, () => false).half === 2);
}
{
  // AUDIT's M1 round 3: a white ghost 12 px wide, its line 2 px in, open at
  // the top. Its body is 3 px from its line at the middle, wider than a
  // sticker 2 px thick fills, so only its 2 px shell (168, the depth rule's
  // count) is offered. At 10 px wide it could be a sticker-filled cup, and
  // goes (the known limit).
  const ghost = (w) => {
    const W = 48, H = 48, x0 = 24 - w / 2, x1 = x0 + w;
    const LGR = [150, 150, 160, 255];
    return image(W, H, (x, y) => {
      if (x < x0 || x >= x1 || y < 8 || y >= 42) return null;
      if ((x === x0 + 2 || x === x1 - 3) && y >= 10 && y < 40) return LGR;
      if (y === 39 && x >= x0 + 2 && x <= x1 - 3) return LGR;
      if (y === 18 && (x === x0 + 4 || x === x1 - 5)) return LINE;
      return [255, 255, 255, 255];
    });
  };
  const g12 = scanOutline(ghost(12), 48, 48);
  check('M3a: a white ghost 12 px wide, its line 2 px in: its 2 px shell only (168), not its body', g12.thickness === 2 && g12.count === 168, { t: g12.thickness, n: g12.count });
  const g10 = scanOutline(ghost(10), 48, 48);
  let body10 = 0;
  for (let y = 10; y < 39; y++) for (let x = 22; x < 26; x++) if (g10.kinds[y * 48 + x]) body10++;
  check('M3b (the known limit): at 10 px wide its body is as narrow as a sticker 2 px thick fills, and goes', g10.thickness === 2 && body10 > 0, { t: g10.thickness, n: g10.count, body10 });
}
{
  // The backstop: a small white sprite with one dark eye. The ring test and
  // the hug pass and the whole run is within T of the eye, so the clean
  // would take 99 of its 100 pixels: not offered.
  const W = 12, H = 12;
  const px = image(W, H, (x, y) => (x >= 1 && x <= 10 && y >= 1 && y <= 10 ? (x === 5 && y === 5 ? LINE : STICKER) : null));
  const s = scanOutline(px, W, H);
  check('M1f: a clean that would take nearly the whole picture is not offered', s.count === 0 && s.hug === 1 && s.thickness > 0, { n: s.count, hug: s.hug, t: s.thickness });
}

// 4. Erase area.
{
  const W = 6, H = 4;
  const A = [200, 40, 40, 255], A2 = [210, 50, 30, 255], B = [40, 40, 200, 255];
  const px = image(W, H, (x, y) => {
    if (y === 3) return null;
    if (x <= 1) return A;
    if (x <= 3) return A2;
    return B;
  });
  const r0 = floodRegion(px, W, H, 0, 0, 0);
  check('R1: at 0 it takes exactly one colour (4-way connected)', r0.count === 6, r0.count);
  const r24 = floodRegion(px, W, H, 0, 0, 24);
  check('R2: at 24 it takes colours within 24 in every channel', r24.count === 12, r24.count);
  check('R3: a click on a transparent pixel or outside the image takes nothing',
    floodRegion(px, W, H, 0, 3, 64).count === 0 && floodRegion(px, W, H, -1, 0, 64).count === 0 && floodRegion(px, W, H, 6, 0, 64).count === 0);
  const diag = image(3, 3, (x, y) => (x === y ? A : null));
  check('R4: diagonal pixels are not connected', floodRegion(diag, 3, 3, 0, 0, 0).count === 1);
  const seeThrough = image(3, 1, (x) => (x === 2 ? [200, 40, 40, 90] : A));
  check('R5: a see-through edge of the same colour goes with it', floodRegion(seeThrough, 3, 1, 0, 0, 0).count === 3);
  const copy = new Uint8ClampedArray(px);
  const n = eraseRegion(copy, r0.mask);
  let ok = n === 6;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    if (r0.mask[p]) ok = ok && copy[i] === 0 && copy[i + 1] === 0 && copy[i + 2] === 0 && copy[i + 3] === 0;
    else ok = ok && copy[i] === px[i] && copy[i + 3] === px[i + 3];
  }
  check('R6: eraseRegion clears the region to (0,0,0,0) and nothing else', ok);
  check('R7: the tolerance is clamped to 0 to 255', floodRegion(px, W, H, 0, 0, -5).count === 6 && floodRegion(px, W, H, 0, 0, 999).count === 18);
}

// 5. The words (DESIGN's ticket, sections 2, 3 and 5) and the pages' wiring.
check('G1: the card\'s words', outlineFoundLine(2834) === 'A white outline is left around the sprite: 2,834 pixels.'
  && outlineFoundLine(1) === 'A white outline is left around the sprite: 1 pixel.'
  && outlineCleanedLine(1428) === 'Outline cleaned: 1,428 pixels.' && OUTLINE_RESTORED === 'Outline restored.');
check('G2: the editor\'s words', editorOutlineCleaned(12) === 'Cleaned 12 outline pixels.' && editorOutlineCleaned(1) === 'Cleaned 1 outline pixel.'
  && erasedLine(40) === 'Erased 40 pixels.' && erasedLine(1) === 'Erased 1 pixel.' && NO_OUTLINE_TITLE === 'No white outline found.'
  && tapAgainLine(1402) === 'Tap again to erase 1,402 pixels.' && tapAgainLine(1) === 'Tap again to erase 1 pixel.');
{
  const card = fs.readFileSync(path.join(ROOT, 'src/components/sprites/GenerationResult.tsx'), 'utf8');
  const has = (src, s) => src.replace(/\s+/g, ' ').includes(s.replace(/\s+/g, ' '));
  check('W1: the card scans the picture it shows once its background is transparent',
    has(card, "const outlineBaseUrl = bgRemovalActive && bgRemovedDataUrl ? bgRemovedDataUrl : sheetIsTransparent === true ? generatedImageDataUrl : null;"));
  check('W2: the card\'s actions take the cleaned picture; Remove background off drops the clean',
    has(card, 'const displayImageDataUrl = outlineCleanedUrl ?? bgShownUrl;')
    && (card.match(/const handed = displayImageDataUrl;/g) ?? []).length === 2
    && has(card, 'setOutlineCleanedFor(null);\n    setOutlineShowFor(null);\n    setOutlineSaid(\'\');\n    setBgRemovalWanted((v) => !v);'));
  check('W3: the card shows its words from the module',
    has(card, '{outlineCleanedUrl ? outlineCleanedLine(outlineFound.n) : outlineFoundLine(outlineFound.n)}')
    && has(card, 'setOutlineSaid(outlineCleanedLine(outlineFound.n));') && has(card, 'setOutlineSaid(OUTLINE_RESTORED);'));
  const ed = fs.readFileSync(path.join(ROOT, 'src/components/sprites/PixelEditorBody.tsx'), 'utf8');
  check('W4: the editor\'s buttons and tool are named', has(ed, 'aria-label="Show outline"') && has(ed, 'aria-label="Clean outline"')
    && has(ed, "{ id: 'erasearea', icon: PaintBucket, label: 'Erase area' }") && has(ed, 'title={outlineAvailable ? \'Clean outline\' : NO_OUTLINE_TITLE}'));
  check('W5: the editor\'s status lines come from the module', has(ed, 'editorOutlineCleaned(n)') && has(ed, 'erasedLine(n)'));
  check('W6: on a touch screen, a first tap with Erase area marks the run and says how many; a tap inside the mark erases it',
    has(ed, "pendingEraseRef.current = { ...coords, touch: e.pointerType !== 'mouse' };") && has(ed, 'if (mark && inMark) {')
    && has(ed, 'setBrushToast(run > 0 ? tapAgainLine(run) : null);') && has(ed, "if (tool !== 'erasearea') areaHoverRef.current = null;"));
  check('W8: the Tolerance slider is 44 px tall wherever the pointer is coarse (a tablet too)', has(ed, 'className="w-28 pointer-coarse:min-h-11 accent-[var(--accent-amber)] cursor-pointer"'));
  check('W7: the card\'s Show where, pressed, has amber text as well as its border', has(card, 'aria-pressed:border-accent-amber aria-pressed:text-accent-amber aria-pressed:hover:text-accent-amber'));
}

console.log(failed === 0 ? '\nall pass' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
