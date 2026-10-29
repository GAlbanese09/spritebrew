// scripts/fill-cleanup-test.mjs
//
// Offline tests for src/lib/fillCleanup.ts, the pink cleanup of animation
// sheets (HQ 2026-10-28-004 and -005): the key band, the rim despill's gates
// (dark, and bright only when asked and only where the colour does not
// continue into the art), the order (key, then rim), the guards, and that
// ordinary pinks, skin tones and the art's own violets and deep pinks
// survive. Run from the repo root: `node scripts/fill-cleanup-test.mjs`.
// Bundles the module with esbuild into local/.fill-cleanup-test/ (gitignored);
// sheets are built here as RGBA arrays. Prints only case names and pass or
// fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.fill-cleanup-test', 'fillCleanup.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/fillCleanup.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const {
  MAGENTA_FILL, INTERIOR_REACH, looksBeforeTable, inKeyBand, isMagentaFill, mostlyMagenta, hasFillPixels, characterColours, keyFill, despillRim,
  cleanAnimation, cornersOpaque,
} = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A W x H sheet: transparent, with pixels set by (x, y) -> [r, g, b, a].
function sheet(W, H, paint) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = paint(x, y);
    if (c) px.set(c, (y * W + x) * 4);
  }
  return px;
}
const at = (px, W, x, y) => Array.from(px.slice((y * W + x) * 4, (y * W + x) * 4 + 4));

const FILL = [255, 0, 255];
const OFF_FILL = [226, 9, 227]; // George's second sheet, Oct 28
const FRINGE = [[165, 22, 119], [125, 24, 108], [207, 67, 158]]; // its outline
const ORDINARY = {
  pink: [255, 192, 203], lightPink: [255, 182, 193], hotPink: [255, 105, 180], rosy: [230, 120, 130],
  salmon: [250, 128, 114], skin: [235, 170, 150], peach: [255, 218, 185], mauve: [224, 176, 255],
  deepRose: [199, 90, 120], lilac: [200, 162, 200],
};
// Saturated art colours that are mostly magenta (the pink audit, Oct 28):
// the bright rule must leave them alone wherever they are the art's own.
const ART = {
  deepPink: [255, 20, 147], orchid: [218, 112, 214], mediumOrchid: [186, 85, 211], darkOrchid: [153, 50, 204],
  blueViolet: [138, 43, 226], magentaArt: [230, 40, 230], violet: [148, 0, 211],
};

// 1. The key band: the exact fill and the tight band George's sheets needed.
check('the fill is #ff00ff, and only it gets the key', MAGENTA_FILL === '#ff00ff' && isMagentaFill('#FF00FF') && !isMagentaFill('#00ff00') && !isMagentaFill('#000000'));
check('exact fill and 226,9,227 are in the key band', inKeyBand(...FILL) && inKeyBand(...OFF_FILL) && inKeyBand(240, 4, 240));
check('just outside the band is not: green 10, red or blue 225',
  !inKeyBand(255, 10, 255) && !inKeyBand(225, 0, 255) && !inKeyBand(255, 0, 225) && !inKeyBand(226, 10, 227));
check('no ordinary pink or skin tone is in the key band', Object.values(ORDINARY).every((c) => !inKeyBand(...c)), Object.entries(ORDINARY).filter(([, c]) => inKeyBand(...c)));
check('no fringe colour is in the key band (the rim despill handles those)', FRINGE.every((c) => !inKeyBand(...c)));

// 2. The rim gate: dark pixels as before, and bright ones that are mostly magenta.
check("the bright fringe pixel 207,67,158 is mostly magenta", mostlyMagenta(207, 67, 158));
check('ordinary pinks and skin tones are not mostly magenta', Object.values(ORDINARY).every((c) => !mostlyMagenta(...c)), Object.entries(ORDINARY).filter(([, c]) => mostlyMagenta(...c)));
check('the saturated art colours are all mostly magenta (violet is dark too, so the dark rule could touch it)',
  Object.values(ART).every((c) => mostlyMagenta(...c)) && 0.299 * 148 + 0.114 * 211 <= 90);

// 3. keyFill: pockets of exact and off fill become transparent; nothing else.
{
  const W = 6;
  const H = 3;
  const px = sheet(W, H, (x) => (x === 0 ? [...FILL, 255] : x === 1 ? [...OFF_FILL, 255] : x === 2 ? [...ORDINARY.hotPink, 255] : x === 3 ? [...FRINGE[0], 255] : x === 4 ? [...ORDINARY.skin, 255] : null));
  const n = keyFill(px);
  check('keyFill: exact and off fill keyed, hot pink, fringe and skin kept',
    n === 6 && at(px, W, 0, 1)[3] === 0 && at(px, W, 1, 1)[3] === 0 && at(px, W, 2, 1)[3] === 255 && at(px, W, 3, 1)[3] === 255 && at(px, W, 4, 1)[3] === 255,
    { n, row: [0, 1, 2, 3, 4].map((x) => at(px, W, x, 1)) });
}

// 4. despillRim: only the 2 px ring next to the removed background.
{
  // A 9 x 9 opaque block in a 13 x 13 transparent sheet: its outer 2 px are
  // the rim; its centre is interior. `edge` paints the block's outermost
  // pixels, `body` the rest.
  const W = 13;
  const H = 13;
  const inBlock = (x, y) => x >= 2 && x <= 10 && y >= 2 && y <= 10;
  const onEdge = (x, y) => x === 2 || x === 10 || y === 2 || y === 10;
  const run = (body, opts = {}) => {
    const { edge = body, fill = MAGENTA_FILL, bright = true } = opts;
    const px = sheet(W, H, (x, y) => (!inBlock(x, y) ? null : onEdge(x, y) ? [...edge, 255] : [...body, 255]));
    const changed = despillRim(px, W, H, fill, { bright });
    return { changed, edge: at(px, W, 2, 6), rim2: at(px, W, 3, 6), interior: at(px, W, 6, 6) };
  };
  const despilled = (c) => [c[0] - (Math.min(c[0], c[2]) - c[1]), c[1], c[2] - (Math.min(c[0], c[2]) - c[1]), 255];
  const BROWN = [90, 60, 40];

  // The fringe of George's second sheet, as an outline cast around brown art.
  const fringe = FRINGE.map((c) => run(BROWN, { edge: c }));
  check("rim, bright rule on: each fringe colour of George's second sheet, outlining brown art, loses its magenta",
    fringe.every((r, i) => same(r.edge, despilled(FRINGE[i])) && same(r.interior, [...BROWN, 255])), fringe.map((r) => r.edge));
  const fringeOff = FRINGE.map((c) => run(BROWN, { edge: c, bright: false }));
  check('rim, bright rule off: the dark fringe pixels still lose it (as before); the bright 207,67,158 is kept',
    same(fringeOff[0].edge, despilled(FRINGE[0])) && same(fringeOff[1].edge, despilled(FRINGE[1])) && same(fringeOff[2].edge, [...FRINGE[2], 255]),
    fringeOff.map((r) => r.edge));
  // A dark cast that is not mostly magenta (70,50,65), as a solid block.
  check('rim: two pixels in is still the rim; the interior is never touched',
    same(run([70, 50, 65]).rim2, [55, 50, 50, 255]) && same(run([70, 50, 65]).interior, [70, 50, 65, 255]));

  // Ordinary pinks and skin tones, with the bright rule on: untouched.
  const ordinary = Object.entries(ORDINARY).map(([name, c]) => [name, run(c)]);
  check('rim: ordinary pinks and skin tones survive on the rim, unchanged, bright rule on',
    ordinary.every(([name, r]) => r.changed === 0 && same(r.edge, [...ORDINARY[name], 255])), ordinary.filter(([, r]) => r.changed > 0).map(([n]) => n));

  // The art's own saturated colours, as solid blocks, with the bright rule
  // on, and the dark violet with the dark rule: the colour continues into
  // the interior, so the rim keeps it.
  const art = Object.entries(ART).map(([name, c]) => [name, run(c)]);
  check('rim: solid violet, orchid, deep pink and magenta art keep their rim with the bright rule on (the colour continues inside)',
    art.every(([name, r]) => r.changed === 0 && same(r.edge, [...ART[name], 255]) && same(r.rim2, [...ART[name], 255])),
    art.filter(([, r]) => r.changed > 0).map(([n, r]) => [n, r.edge]));
  const artOff = Object.entries(ART).map(([name, c]) => [name, run(c, { bright: false })]);
  check('rim: and with the bright rule off (the Gallery), including the dark violet the dark rule used to change',
    artOff.every(([, r]) => r.changed === 0), artOff.filter(([, r]) => r.changed > 0).map(([n, r]) => [n, r.edge]));
  // A violet body with a dark outline: the outline loses its cast as always;
  // the first violet pixels inside it keep their colour.
  const outlined = run(ART.violet, { edge: [40, 10, 45] });
  check('rim: a violet body with a dark outline keeps its violet next to the outline',
    same(outlined.rim2, [...ART.violet, 255]) && same(outlined.edge, [10, 10, 15, 255]), outlined);
  // A cast that sits on the art's own magenta is the art's: left alone.
  const onViolet = run(ART.violet, { edge: [207, 67, 158] });
  check('rim: a bright pink edge on violet art is taken as the art and kept', same(onViolet.edge, [207, 67, 158, 255]), onViolet.edge);

  // The reach: magenta art farther than INTERIOR_REACH from a rim pixel does
  // not protect it. A 21 px wide band of brown with a violet core 9 px in,
  // edged with the bright fringe.
  {
    const BW = 25;
    const px = sheet(BW, 9, (x, y) => (y === 0 || y === 8 || x === 0 || x === BW - 1 ? null
      : x === 1 ? [207, 67, 158, 255] : x >= 11 && x <= 13 && y >= 3 && y <= 5 ? [...ART.violet, 255] : [...BROWN, 255]));
    despillRim(px, BW, 9, MAGENTA_FILL, { bright: true });
    check(`rim: magenta art more than ${INTERIOR_REACH} px from the edge does not stop the despill`,
      same(at(px, BW, 1, 4), despilled([207, 67, 158])), at(px, BW, 1, 4));
  }

  // The reach's edges, on both of despillRim's paths. Each sheet holds a
  // 12 x 11 brown block (its outer ring transparent) at the bottom left,
  // with a bright fringe pixel on its rim. On the "table" sheets a band of
  // 1 px violet stripes runs above the block: rim pixels, never interior,
  // so they protect nothing, but they give despillRim more mostly-magenta
  // rim pixels to look around than looksBeforeTable allows before it
  // reaches the block, so the block is answered from the count table. The
  // plain sheets have no band and stay one by one. On both: art exactly
  // INTERIOR_REACH away (right, below, or above at the sheet's bottom edge)
  // protects the rim pixel; one more pixel away does not; and a dark cast
  // 2 px above the bottom edge is still rim and loses its cast.
  {
    const BW = 40;
    const OY = 17;
    const BH = OY + 11;
    const edgeSheet = (table, fringeAt, violetAt, castAt) => sheet(BW, BH, (x, y) => {
      if (table && y >= 1 && y <= 14 && x % 2 === 1) return [...ART.violet, 255];
      const by = y - OY;
      if (by < 0 || x > 11 || x === 0 || by === 0 || x === 11 || by === 10) return null;
      if (x === fringeAt[0] && by === fringeAt[1]) return [207, 67, 158, 255];
      if (violetAt && x === violetAt[0] && by === violetAt[1]) return [...ART.violet, 255];
      if (castAt && x === castAt[0] && by === castAt[1]) return [70, 50, 65, 255];
      return [...BROWN, 255];
    });
    // The mostly-magenta rim pixels despillRim looks around before it
    // reaches (x, y), by the rule's own terms. Alpha never changes and a
    // pixel's colour changes only when the loop reaches it, so counting on
    // the sheet as built is exact.
    const looksBefore = (px, x0, y0) => {
      const near = (x, y) => {
        for (let ny = Math.max(0, y - 2); ny <= Math.min(BH - 1, y + 2); ny++) {
          for (let nx = Math.max(0, x - 2); nx <= Math.min(BW - 1, x + 2); nx++) if (px[(ny * BW + nx) * 4 + 3] === 0) return true;
        }
        return false;
      };
      let n = 0;
      for (let p = 0; p < y0 * BW + x0; p++) {
        const k = p * 4;
        if (px[k + 3] !== 0 && Math.min(px[k], px[k + 2]) > px[k + 1] && mostlyMagenta(px[k], px[k + 1], px[k + 2]) && near(p % BW, Math.floor(p / BW))) n++;
      }
      return n;
    };
    const limit = looksBeforeTable(BW, BH);
    const pairs = [
      ['to the right', [1, 5], [1 + INTERIOR_REACH, 5], [2 + INTERIOR_REACH, 5]],
      ['below', [5, 1], [5, 1 + INTERIOR_REACH], [5, 2 + INTERIOR_REACH]],
      ['above, at the bottom edge', [5, 9], [5, 9 - INTERIOR_REACH], [5, 8 - INTERIOR_REACH]],
    ];
    for (const table of [true, false]) {
      const path = table ? 'from the count table' : 'one by one';
      const reached = [];
      const fringeAfter = (fringeAt, violetAt) => {
        const px = edgeSheet(table, fringeAt, violetAt);
        reached.push(looksBefore(px, fringeAt[0], OY + fringeAt[1]));
        despillRim(px, BW, BH, MAGENTA_FILL, { bright: true });
        return at(px, BW, fringeAt[0], OY + fringeAt[1]);
      };
      for (const [where, fringeAt, inReach, outOfReach] of pairs) {
        const kept = fringeAfter(fringeAt, inReach);
        const lost = fringeAfter(fringeAt, outOfReach);
        check(`rim, ${path}: magenta art exactly ${INTERIOR_REACH} px ${where} protects a rim pixel; ${INTERIOR_REACH + 1} px does not`,
          same(kept, [207, 67, 158, 255]) && same(lost, despilled([207, 67, 158])), [kept, lost]);
      }
      const px = edgeSheet(table, [1, 5], null, [8, 8]);
      reached.push(looksBefore(px, 8, OY + 8));
      despillRim(px, BW, BH, MAGENTA_FILL, { bright: true });
      check(`rim, ${path}: a dark cast 2 px above the bottom edge is still rim and loses its cast`,
        same(at(px, BW, 8, OY + 8), [55, 50, 50, 255]), at(px, BW, 8, OY + 8));
      check(table
        ? `each of those pixels is reached after more than looksBeforeTable (${limit}) looks, so the table answers it`
        : `each of those pixels is reached within looksBeforeTable (${limit}) looks, so it is answered one by one`,
      reached.every((n) => (table ? n > limit : n <= limit)), reached);
    }
  }

  // The cost stays bounded (Second 118's note). On a 128 x 128 violet sheet
  // with a transparent pixel every 5 px, every opaque pixel is a mostly
  // magenta rim pixel. despillRim may read the sheet at most 35 times per
  // pixel (it reads it 23 times); without the count table it reads it about
  // 300 times per pixel here, and without its ring memo about 50. Reads are
  // counted through a wrapper, so the check does not depend on the
  // machine's speed.
  {
    const N = 128;
    const px = sheet(N, N, (x, y) => (x % 5 === 2 && y % 5 === 2 ? null : [...ART.violet, 255]));
    let reads = 0;
    const counted = new Proxy(px, {
      get(t, k) {
        if (typeof k === 'string' && k.charCodeAt(0) >= 48 && k.charCodeAt(0) <= 57) reads++;
        return Reflect.get(t, k);
      },
      set(t, k, v) { return Reflect.set(t, k, v); },
    });
    const changed = despillRim(counted, N, N, MAGENTA_FILL, { bright: true });
    check('a sheet that is all mostly-magenta rim costs at most 35 reads per pixel',
      reads <= 35 * N * N && changed > 0, { readsPerPixel: Math.round(reads / (N * N)), changed });
  }

  // The limits, for the record: a stroke too thin to have an interior gives
  // the rules nothing to tell by. A bright one changes only with the bright
  // rule, which is why it is on only when the character had no mostly
  // magenta colours (characterColours); a dark one changes either way, as
  // it always did.
  {
    const stroke = (c, bright) => {
      const px = sheet(9, 13, (x, y) => (x >= 3 && x <= 5 && y >= 2 && y <= 10 ? [...c, 255] : null));
      despillRim(px, 9, 13, MAGENTA_FILL, { bright });
      return at(px, 9, 4, 6);
    };
    check('a 3 px orchid stroke: changed with the bright rule on (no interior to tell by), untouched with it off',
      !same(stroke(ART.orchid, true), [...ART.orchid, 255]) && same(stroke(ART.orchid, false), [...ART.orchid, 255]));
    check('a 3 px dark violet stroke: changed either way, as the dark rule always did',
      same(stroke(ART.violet, false), [0, 0, 63, 255]) && same(stroke(ART.violet, true), [0, 0, 63, 255]));
  }

  const darkCast = run([70, 50, 65]);
  check('rim: a dark pixel with a slight magenta cast is corrected, as before', same(darkCast.edge, [55, 50, 50, 255]), darkCast.edge);
  const greenDark = run([40, 70, 45], { fill: '#00ff00' });
  const greenBright = run([120, 200, 130], { fill: '#00ff00' });
  check('rim on a green fill: dark green cast corrected, bright green untouched (no change for green fills)',
    same(greenDark.edge, [40, 45, 45, 255]) && greenBright.changed === 0, { greenDark: greenDark.edge, greenBright: greenBright.changed });
  check('rim on a neutral fill: nothing', run(FRINGE[0], { fill: '#000000' }).changed === 0);
  check('the bright rule is off unless asked (despillRim with no options)', (() => {
    const px = sheet(W, H, (x, y) => (!inBlock(x, y) ? null : onEdge(x, y) ? [207, 67, 158, 255] : [...BROWN, 255]));
    despillRim(px, W, H, MAGENTA_FILL);
    return same(at(px, W, 2, 6), [207, 67, 158, 255]);
  })());
  check('rim never touches alpha', fringe.every((r) => r.edge[3] === 255 && r.interior[3] === 255));
}

// 4b. despillRim against the definition written plainly (the rule as
// reviewed, with no memo and no count table), on deterministic random
// sheets. The large dense ones have far more mostly-magenta rim pixels than
// despillRim looks around before it builds its count table, so both of its
// ways of answering are checked (Second 118).
{
  const referenceRim = (px, W, H, bright) => {
    const near = (x, y) => {
      for (let ny = Math.max(0, y - 2); ny <= Math.min(H - 1, y + 2); ny++) {
        for (let nx = Math.max(0, x - 2); nx <= Math.min(W - 1, x + 2); nx++) if (px[(ny * W + nx) * 4 + 3] === 0) return true;
      }
      return false;
    };
    const inside = (x, y) => {
      for (let ny = Math.max(0, y - INTERIOR_REACH); ny <= Math.min(H - 1, y + INTERIOR_REACH); ny++) {
        for (let nx = Math.max(0, x - INTERIOR_REACH); nx <= Math.min(W - 1, x + INTERIOR_REACH); nx++) {
          const k = (ny * W + nx) * 4;
          if (px[k + 3] !== 0 && mostlyMagenta(px[k], px[k + 1], px[k + 2]) && !near(nx, ny)) return true;
        }
      }
      return false;
    };
    let looks = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (px[i + 3] === 0) continue;
        const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
        const excess = Math.min(r, b) - g;
        if (excess <= 0) continue;
        const dark = 0.299 * r + 0.587 * g + 0.114 * b <= 90;
        const mostly = mostlyMagenta(r, g, b);
        if (!dark && !(bright && mostly)) continue;
        if (!near(x, y)) continue;
        if (mostly) { looks++; if (inside(x, y)) continue; }
        px[i] = r - excess;
        px[i + 2] = b - excess;
      }
    }
    return looks;
  };
  let seed = 20261028;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const palette = [[148, 0, 211], [218, 112, 214], [255, 20, 147], [207, 67, 158], [165, 22, 119], [125, 24, 108], [128, 0, 128], [90, 60, 40], [70, 50, 65], [235, 170, 150]];
  let compared = 0;
  let mismatched = 0;
  let mostLooks = 0;
  for (const [W, H] of [[5, 5], [13, 13], [40, 40], [96, 64], [160, 120]]) {
    for (let rep = 0; rep < 3; rep++) {
      const holes = [0.08, 0.25, 0.5][rep];
      const px = sheet(W, H, (x, y) => (((x * 7 + y * 13) % 11) / 11 < holes || rnd() < holes / 3 ? null : [...palette[Math.floor(rnd() * palette.length)], 255]));
      for (const bright of [true, false]) {
        const mine = Uint8ClampedArray.from(px);
        const ref = Uint8ClampedArray.from(px);
        despillRim(mine, W, H, MAGENTA_FILL, { bright });
        mostLooks = Math.max(mostLooks, referenceRim(ref, W, H, bright));
        compared++;
        if (!same(Array.from(mine), Array.from(ref))) mismatched++;
      }
    }
  }
  check(`despillRim matches the rule written plainly on ${compared} random sheets (up to ${mostLooks} mostly-magenta rim pixels on one sheet, past the count table's start)`,
    mismatched === 0 && mostLooks > 256, { mismatched, mostLooks });
}

// 5. cleanAnimation: the key first, so the rim around a keyed pocket is despilled.
{
  // A 12 x 12 opaque block, transparent around it, with a 2 x 2 pocket of
  // off fill in its middle and fringe pixels around the pocket.
  const W = 16;
  const H = 16;
  const paint = (x, y) => {
    if (x < 2 || x > 13 || y < 2 || y > 13) return null;
    if (x >= 7 && x <= 8 && y >= 7 && y <= 8) return [...OFF_FILL, 255];
    if (x >= 6 && x <= 9 && y >= 6 && y <= 9) return [...FRINGE[0], 255];
    return [90, 60, 40, 255];
  };
  const px = sheet(W, H, paint);
  const r = cleanAnimation(px, W, H, MAGENTA_FILL, { key: true, bright: true });
  check('cleanAnimation: the pocket is keyed, and the fringe around it is despilled',
    r.keyed === 4 && at(px, W, 7, 7)[3] === 0 && at(px, W, 6, 6)[0] === FRINGE[0][0] - (FRINGE[0][2] - FRINGE[0][1]),
    { r, pocket: at(px, W, 7, 7), around: at(px, W, 6, 6) });

  // The guard: the character had fill pixels of its own: nothing is keyed.
  const guarded = sheet(W, H, paint);
  const g = cleanAnimation(guarded, W, H, MAGENTA_FILL, { key: false, bright: false });
  check('the guard: with key off the fill pocket is left untouched, opaque',
    g.keyed === 0 && same(at(guarded, W, 7, 7), [...OFF_FILL, 255]), { g, pocket: at(guarded, W, 7, 7) });

  const green = sheet(W, H, paint);
  check('a green fill is never keyed', cleanAnimation(green, W, H, '#00ff00', { key: true, bright: true }).keyed === 0);

  // The bright option reaches the rim: a bright fringe pixel next to the
  // pocket is despilled only with it.
  const brightAt = (bright) => {
    const px = sheet(W, H, (x, y) => (x === 6 && y === 7 ? [207, 67, 158, 255] : paint(x, y)));
    cleanAnimation(px, W, H, MAGENTA_FILL, { key: true, bright });
    return at(px, W, 6, 7);
  };
  check('cleanAnimation passes the bright option on: a bright fringe pixel by the pocket changes only with it',
    same(brightAt(true), [116, 67, 67, 255]) && same(brightAt(false), [207, 67, 158, 255]), { on: brightAt(true), off: brightAt(false) });

  // A character drawn in the fill itself: both guards on (key off, bright
  // off), so its #FF00FF on the rim stays #FF00FF, never despilled to black.
  const drawn = sheet(W, H, (x, y) => (x < 2 || x > 13 || y < 2 || y > 13 ? null : x <= 3 ? [...FILL, 255] : [90, 60, 40, 255]));
  const d = cleanAnimation(drawn, W, H, MAGENTA_FILL, { key: false, bright: false });
  check("a character's own #FF00FF at the rim, with both guards on, is kept",
    d.keyed === 0 && same(at(drawn, W, 2, 8), [...FILL, 255]) && same(at(drawn, W, 3, 8), [...FILL, 255]), { d, px: at(drawn, W, 2, 8) });
}

// 6. The guards' check on the character sent (before it is flattened onto
// the fill): its own visible pixels in the key band, and its own mostly
// magenta ones.
{
  const W = 4;
  const H = 1;
  check('hasFillPixels: a character with an exact #FF00FF pixel has them', hasFillPixels(sheet(W, H, (x) => (x === 2 ? [...FILL, 255] : [40, 40, 40, 255]))));
  check('hasFillPixels: and with 226,9,227', hasFillPixels(sheet(W, H, (x) => (x === 1 ? [...OFF_FILL, 255] : null))));
  check('hasFillPixels: hot pink, fringe colours and skin are not fill',
    !hasFillPixels(sheet(W, H, (x) => [ORDINARY.hotPink, FRINGE[2], ORDINARY.skin, ORDINARY.pink][x].concat(255))));
  check('hasFillPixels: a fill-coloured pixel that is mostly transparent is not the art',
    !hasFillPixels(sheet(W, H, (x) => (x === 0 ? [...FILL, 100] : x === 1 ? [...FILL, 0] : null))));
  const colours = (cs) => characterColours(sheet(cs.length, 1, (x) => cs[x]));
  check('characterColours: the fill itself counts as both fill and magenta', same(colours([[40, 40, 40, 255], [...FILL, 255]]), { fill: true, magenta: true }));
  check('characterColours: violet, orchid or deep pink art is magenta, not fill',
    Object.values(ART).every((c) => same(colours([[40, 40, 40, 255], [...c, 255]]), { fill: false, magenta: true })));
  check('characterColours: ordinary pinks and skin tones are neither',
    same(colours(Object.values(ORDINARY).map((c) => [...c, 255])), { fill: false, magenta: false }));
  check("characterColours: a dark plum like the fringe's 125,24,108 counts as magenta", same(colours([[...FRINGE[2], 255]]).magenta, true) && same(colours([[...FRINGE[1], 255]]).magenta, true));
  check('characterColours: mostly transparent pixels do not count',
    same(colours([[...ART.violet, 100], [...FILL, 0], [40, 40, 40, 255]]), { fill: false, magenta: false }));
}

// 7. The corner check: an opaque sheet (RD kept the background) is left alone by the callers.
{
  const W = 3;
  const H = 3;
  check('cornersOpaque: true for a fully opaque sheet, false when any corner is clear',
    cornersOpaque(sheet(W, H, () => [10, 10, 10, 255]), W, H) && !cornersOpaque(sheet(W, H, (x, y) => (x === 2 && y === 2 ? null : [10, 10, 10, 255])), W, H));
}

if (failed > 0) {
  console.log(`${failed} FAIL`);
  process.exit(1);
}
console.log('all pass');
