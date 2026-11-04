// scripts/onion-skin-test.mjs
//
// Offline tests for src/lib/onionSkin.ts, the editor's onion skin (BUILD-2,
// W2; HQ 2026-11-03-007, -021): which neighbours are picked (by id, nearest
// first, no wrap), and the layer drawn from them (red back, blue ahead,
// opacity and falloff, near frames on top, wrong sizes skipped, counts and
// opacity clamped). Run from the repo root: `node scripts/onion-skin-test.mjs`.
// Bundles the module with esbuild into local/.onion-skin-test/ (gitignored).
// Prints only case names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.onion-skin-test', 'onionSkin.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/onionSkin.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const {
  ONION_MAX, ONION_DEFAULT_BACK, ONION_DEFAULT_AHEAD, ONION_DEFAULT_OPACITY, ONION_TINT_BACK, ONION_TINT_AHEAD,
  ONION_TINT_STRENGTH, ONION_FALLOFF, onionNeighbours, onionLayer, decodeOnionSources, onionFrameList,
} = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
const ids = (xs) => xs.map((f) => f.id).join(',');
function frame(W, H, f) {
  const pixels = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = f(x, y);
    if (c) pixels.set(c, (y * W + x) * 4);
  }
  return { pixels, width: W, height: H };
}
const at = (px, W, x, y) => Array.from(px.slice((y * W + x) * 4, (y * W + x) * 4 + 4));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const near = (a, b, tol = 1) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const WHITE = [255, 255, 255, 255];

// Defaults as HQ ruled.
check('defaults: 1 back, 1 ahead, 40%, at most 3', ONION_DEFAULT_BACK === 1 && ONION_DEFAULT_AHEAD === 1 && ONION_DEFAULT_OPACITY === 0.4 && ONION_MAX === 3);
check('tints: back is red, ahead is blue', ONION_TINT_BACK[0] > ONION_TINT_BACK[2] && ONION_TINT_AHEAD[2] > ONION_TINT_AHEAD[0]);

// 1. Neighbours: nearest first, clipped at the ends, never wrapping.
{
  const fr = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }));
  const mid = onionNeighbours(fr, 'c', 3);
  check('neighbours: middle back nearest first', ids(mid.back) === 'b,a', ids(mid.back));
  check('neighbours: middle ahead nearest first', ids(mid.ahead) === 'd,e,f', ids(mid.ahead));
  const first = onionNeighbours(fr, 'a', 3);
  check('neighbours: first frame has no back (no wrap)', first.back.length === 0 && ids(first.ahead) === 'b,c,d');
  const last = onionNeighbours(fr, 'f', 3);
  check('neighbours: last frame has no ahead (no wrap)', last.ahead.length === 0 && ids(last.back) === 'e,d,c');
  check('neighbours: default max is ONION_MAX', onionNeighbours(fr, 'c').ahead.length === 3);
  check('neighbours: max 1', ids(onionNeighbours(fr, 'c', 1).back) === 'b' && ids(onionNeighbours(fr, 'c', 1).ahead) === 'd');
  check('neighbours: max 0 gives none', onionNeighbours(fr, 'c', 0).back.length === 0 && onionNeighbours(fr, 'c', 0).ahead.length === 0);
  check('neighbours: unknown id gives none', onionNeighbours(fr, 'zz').back.length === 0 && onionNeighbours(fr, 'zz').ahead.length === 0);
  check('neighbours: a one-frame animation gives none', onionNeighbours([{ id: 'x' }], 'x').back.length === 0);
  // Identity by id, not by value: two frames with the same pixels.
  const dup = [{ id: 'p', v: 1 }, { id: 'q', v: 1 }, { id: 'r', v: 2 }];
  check('neighbours: found by id even when frames look alike', ids(onionNeighbours(dup, 'q').back) === 'p' && ids(onionNeighbours(dup, 'q').ahead) === 'r');
}

// 2. One back frame, one ahead frame, side by side: tints, opacity.
{
  const W = 4, H = 1;
  const back = frame(W, H, (x) => (x === 0 ? WHITE : null));
  const ahead = frame(W, H, (x) => (x === 1 ? WHITE : null));
  const out = onionLayer({ back: [back], ahead: [ahead] }, W, H, { back: 1, ahead: 1, opacity: 0.4 });
  const k = ONION_TINT_STRENGTH;
  const exp = (t) => [0, 1, 2].map((c) => Math.round(255 * (1 - k) + t[c] * k));
  check('layer: back pixel is red-tinted at 40%', near(at(out, W, 0, 0), [...exp(ONION_TINT_BACK), Math.round(0.4 * 255)]), at(out, W, 0, 0));
  check('layer: ahead pixel is blue-tinted at 40%', near(at(out, W, 1, 0), [...exp(ONION_TINT_AHEAD), Math.round(0.4 * 255)]), at(out, W, 1, 0));
  check('layer: empty pixels stay transparent', at(out, W, 2, 0)[3] === 0 && at(out, W, 3, 0)[3] === 0);
  check('layer: the inputs are unchanged', at(back.pixels, W, 0, 0).join() === WHITE.join() && at(ahead.pixels, W, 1, 0).join() === WHITE.join());
}

// 3. Falloff: the second frame back is fainter than the first.
{
  const W = 2, H = 1;
  const b1 = frame(W, H, (x) => (x === 0 ? WHITE : null));
  const b2 = frame(W, H, (x) => (x === 1 ? WHITE : null));
  const out = onionLayer({ back: [b1, b2], ahead: [] }, W, H, { back: 2, ahead: 0, opacity: 1 });
  check('falloff: nearest at full opacity', at(out, W, 0, 0)[3] === 255, at(out, W, 0, 0));
  check('falloff: second step at ONION_FALLOFF', Math.abs(at(out, W, 1, 0)[3] - Math.round(255 * ONION_FALLOFF)) <= 1, at(out, W, 1, 0));
  // Asking for 1 back hides the second.
  const one = onionLayer({ back: [b1, b2], ahead: [] }, W, H, { back: 1, ahead: 0, opacity: 1 });
  check('falloff: back 1 shows only the nearest', at(one, W, 1, 0)[3] === 0 && at(one, W, 0, 0)[3] === 255);
}

// 4. Overlap: the nearer frame is drawn on top of the farther one.
{
  const W = 1, H = 1;
  const nearB = frame(W, H, () => [0, 0, 0, 255]);
  const farB = frame(W, H, () => WHITE);
  const out = onionLayer({ back: [nearB, farB], ahead: [] }, W, H, { back: 2, ahead: 0, opacity: 1 });
  const k = ONION_TINT_STRENGTH;
  const nearColour = [0, 1, 2].map((c) => Math.round(0 * (1 - k) + ONION_TINT_BACK[c] * k));
  check('overlap: the nearest frame wins at full opacity', near(at(out, W, 0, 0).slice(0, 3), nearColour), at(out, W, 0, 0));
}

// 5. Sizes, counts and opacity are guarded.
{
  const W = 2, H = 2;
  const ok = frame(W, H, () => WHITE);
  const wrong = frame(3, 2, () => WHITE);
  const out = onionLayer({ back: [wrong], ahead: [ok] }, W, H, { back: 1, ahead: 1, opacity: 1 });
  check('sizes: a frame of another size is skipped', at(out, W, 0, 0).slice(0, 3).join() === [0, 1, 2].map((c) => Math.round(255 * (1 - ONION_TINT_STRENGTH) + ONION_TINT_AHEAD[c] * ONION_TINT_STRENGTH)).join());
  const none = onionLayer({ back: [ok], ahead: [ok] }, W, H, { back: 1, ahead: 1, opacity: 0 });
  check('opacity 0: nothing drawn', none.every((v) => v === 0));
  const neg = onionLayer({ back: [ok], ahead: [] }, W, H, { back: -2, ahead: 0, opacity: 1 });
  check('counts: negative back draws nothing', neg.every((v) => v === 0));
  const big = onionLayer({ back: [ok, ok, ok, ok, ok], ahead: [] }, W, H, { back: 9, ahead: 0, opacity: 1 });
  check('counts: back above the max is clamped (no throw)', big[3] === 255);
  const nan = onionLayer({ back: [ok], ahead: [] }, W, H, { back: 1, ahead: 0, opacity: Number.NaN });
  check('opacity NaN: nothing drawn', nan.every((v) => v === 0));
  const over = onionLayer({ back: [ok], ahead: [] }, W, H, { back: 1, ahead: 0, opacity: 5 });
  check('opacity above 1: clamped to 1', over[3] === 255);
  const missing = onionLayer({ back: [null], ahead: [] }, W, H, { back: 1, ahead: 0, opacity: 1 });
  check('missing frame (still decoding): skipped', missing.every((v) => v === 0));
  check('empty canvas: empty layer', onionLayer({ back: [], ahead: [] }, 0, 0, { back: 1, ahead: 1, opacity: 1 }).length === 0);
  const short = { pixels: new Uint8ClampedArray(4), width: W, height: H };
  const s = onionLayer({ back: [short], ahead: [] }, W, H, { back: 1, ahead: 0, opacity: 1 });
  check('short pixel data: skipped, never read past its end', s.every((v) => v === 0));
}

// 6. Decoding with the browser boundary passed in: places kept, failures
//    and nulls skipped, and a result that arrives after the sources went
//    stale is dropped (stale completion over newer intent).
{
  const calls = [];
  const fake = (url) => {
    calls.push(url);
    if (url === 'bad') return Promise.reject(new Error('decode failed'));
    return new Promise((r) => setTimeout(() => r({ pixels: new Uint8ClampedArray(4), width: 1, height: 1, url }), url === 'slow' ? 20 : 1));
  };
  const got = await decodeOnionSources({ back: ['slow', null, 'b3'], ahead: ['bad', 'a2'] }, fake, () => true);
  check('decode: back keeps its places, nearest first', got && got.back.length === 3 && got.back[0].url === 'slow' && got.back[1] === null && got.back[2].url === 'b3', got && got.back.map((f) => f && f.url));
  check('decode: a failed decode becomes null', got && got.ahead[0] === null && got.ahead[1].url === 'a2');
  check('decode: a null source is never decoded', !calls.includes(null) && calls.length === 4, calls);
  let live = true;
  const p = decodeOnionSources({ back: ['slow'], ahead: [] }, fake, () => live);
  live = false; // the editor closed, or new sources arrived, mid-decode
  check('decode: a result after the sources went stale is dropped', (await p) === null);
  const empty = await decodeOnionSources({ back: [], ahead: [] }, fake, () => true);
  check('decode: no sources gives empty lists', empty && empty.back.length === 0 && empty.ahead.length === 0);
}

// 7. Audit r1 (BUILD-2, W2): guards that a single-layer case could not
//    see, and which list the neighbours come from.
{
  const W = 2, H = 1;
  const okA = frame(W, H, (x) => (x === 0 ? WHITE : null));
  const wrongOnly = onionLayer({ back: [frame(3, 1, () => WHITE)], ahead: [] }, W, H, { back: 1, ahead: 0, opacity: 1 });
  check('sizes: a wrong-size frame alone draws nothing', wrongOnly.every((v) => v === 0));
  // Two overlapping layers: an opacity above 1 must behave exactly as 1.
  const two = { back: [okA, okA], ahead: [] };
  const at1 = onionLayer(two, W, H, { back: 2, ahead: 0, opacity: 1 });
  const at5 = onionLayer(two, W, H, { back: 2, ahead: 0, opacity: 5 });
  check('opacity above 1 equals 1 with two layers overlapping', same(at1, at5), { at1: at(at1, W, 0, 0), at5: at(at5, W, 0, 0) });
  // Counts above ONION_MAX: frames 4 and 5 back must not be drawn.
  const near3 = frame(W, H, (x) => (x === 0 ? WHITE : null));
  const far = frame(W, H, (x) => (x === 1 ? WHITE : null));
  const nine = onionLayer({ back: [near3, near3, near3, far, far], ahead: [] }, W, H, { back: 9, ahead: 0, opacity: 1 });
  check('counts: back 9 draws only the nearest ONION_MAX frames', at(nine, W, 1, 0)[3] === 0 && at(nine, W, 0, 0)[3] > 0, at(nine, W, 1, 0));
}
{
  const f = (id) => ({ id });
  const sheet = [{ frames: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(f) }];
  const rowDown = { frames: ['a', 'b', 'c', 'd'].map(f) };
  const rowUp = { frames: ['e', 'f', 'g', 'h'].map(f) };
  const ids = (l) => (l ? l.map((x) => x.id).join('') : 'null');
  check('lists: a frame in exactly one group uses that group (no bleed from the next row)', ids(onionFrameList([rowDown, rowUp], sheet, 'e')) === 'efgh');
  check('lists: no groups uses the sheet order', ids(onionFrameList([], sheet, 'e')) === 'abcdefgh');
  const ping = { frames: ['a', 'b', 'c', 'b'].map(f) };
  check('lists: a frame repeated in its group (ping-pong) falls back to the sheet', ids(onionFrameList([ping], sheet, 'b')) === 'abcdefgh');
  check('lists: a non-repeated frame of a ping-pong group uses the group', ids(onionFrameList([ping], sheet, 'c')) === 'abcb');
  const shared = { frames: ['d', 'e'].map(f) };
  check('lists: a frame in two groups falls back to the sheet', ids(onionFrameList([rowUp, shared], sheet, 'e')) === 'abcdefgh');
  check('lists: an unknown frame gives null', onionFrameList([rowDown], sheet, 'zz') === null);
  const nb = onionNeighbours(onionFrameList([ping], sheet, 'c'), 'c');
  check('lists: neighbours within a ping-pong group', nb.back.map((x) => x.id).join('') === 'ba' && nb.ahead.map((x) => x.id).join('') === 'b');
}

// 8. REV step 1 (P3 b, W2): the ahead frames' size guard, and the tint
//    strength, which every case above reads from the module and so never pins.
{
  const W = 2, H = 1;
  const wideAhead = onionLayer({ back: [], ahead: [frame(3, 1, () => WHITE)] }, W, H, { back: 0, ahead: 1, opacity: 1 });
  check('sizes: a wrong-width ahead frame alone draws nothing', wideAhead.every((v) => v === 0));
  const tallAhead = onionLayer({ back: [], ahead: [frame(2, 2, () => WHITE)] }, W, H, { back: 0, ahead: 1, opacity: 1 });
  check('sizes: a wrong-height ahead frame alone draws nothing', tallAhead.every((v) => v === 0));
  const white = frame(W, H, () => WHITE);
  const backOnly = onionLayer({ back: [white], ahead: [] }, W, H, { back: 1, ahead: 0, opacity: 1 });
  check('tint: a white back frame shows as 255, 140, 140 (strength 0.6)', at(backOnly, W, 0, 0).join() === '255,140,140,255', at(backOnly, W, 0, 0));
  const aheadOnly = onionLayer({ back: [], ahead: [white] }, W, H, { back: 0, ahead: 1, opacity: 1 });
  check('tint: a white ahead frame shows as 140, 179, 255 (strength 0.6)', at(aheadOnly, W, 0, 0).join() === '140,179,255,255', at(aheadOnly, W, 0, 0));
}

console.log(failed ? `${failed} failed` : 'all pass');
process.exit(failed ? 1 : 0);
