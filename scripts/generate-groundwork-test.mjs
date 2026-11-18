// scripts/generate-groundwork-test.mjs
//
// Offline tests for the Generate page pass, ticket G0 (DESIGN,
// design/generate-pass/generate-pass.md section 7; design/tickets/
// builder-create.md section 8): src/lib/mirrorImage.ts and the new fields of
// src/stores/spriteStore.ts. Nothing on screen reads them yet. Run from the
// repo root: `node scripts/generate-groundwork-test.mjs`.
//
// 1. mirrorPixels: pixel (x, y) of the result equals pixel (w-1-x, y) of the
//    source, alpha included, on odd, even and one-pixel widths; twice gives
//    the source back; the source is never changed.
// 2. mirrorX through its boundary: the decoded picture goes out mirrored, a
//    failed decode rejects, and mirrorX's default boundary is the browser's.
// 3. facingAsShown: builder-create.md section 8's table.
// 4. The store: starting values, the facing and subject setters, the kept
//    character keyed by account, Auto-Prep's waiting flag, the two page
//    requests, and clearGeneratedImage leaving all of them alone.
// 5. No em dash added (spriteStore.ts keeps the four its older comments had).
//
// The harness writes only its esbuild bundle, to local/.generate-groundwork-test
// (gitignored), and prints only case names and pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.generate-groundwork-test');

await build({
  entryPoints: {
    spriteStore: path.join(ROOT, 'src/stores/spriteStore.ts'),
    mirrorImage: path.join(ROOT, 'src/lib/mirrorImage.ts'),
  },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
  external: ['react', 'react/*', 'react-dom', 'react-dom/*', 'zustand', 'zustand/*'],
});
const load = (name) => import(pathToFileURL(path.join(OUT, `${name}.mjs`)).href);
const { useSpriteStore, facingAsShown, keptCharacterFor } = await load('spriteStore');
const { mirrorPixels, mirrorX, BROWSER_MIRROR_IO } = await load('mirrorImage');

let pass = 0, fail = 0;
const check = (name, ok) => {
  if (ok) { pass++; console.log(`pass  ${name}`); } else { fail++; console.log(`FAIL  ${name}`); }
};

// ── 1. mirrorPixels ──

/** A picture whose every byte differs, alpha included (0 and 255 among them). */
function picture(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37 + 11) % 256;
  for (let p = 0; p < width * height; p += 3) data[p * 4 + 3] = 0;
  if (width * height > 1) data[7] = 255;
  return { width, height, data };
}
const px = (img, x, y) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

for (const [w, h] of [[5, 3], [8, 4], [1, 6], [33, 1]]) {
  const src = picture(w, h);
  const before = Uint8ClampedArray.from(src.data);
  const out = mirrorPixels(src);
  let every = out.width === w && out.height === h && out.data.length === src.data.length;
  for (let y = 0; y < h && every; y++) for (let x = 0; x < w; x++) if (!same(px(out, x, y), px(src, w - 1 - x, y))) { every = false; break; }
  check(`1a: ${w} by ${h}: pixel (x, y) is the source's (w-1-x, y), alpha included`, every);
  check(`1b: ${w} by ${h}: turned twice gives the source's pixels back`, same(Array.from(mirrorPixels(out).data), Array.from(src.data)));
  check(`1c: ${w} by ${h}: the source is not changed and the result is a new array`, same(Array.from(src.data), Array.from(before)) && out.data !== src.data);
}
const empty = mirrorPixels({ width: 0, height: 0, data: new Uint8ClampedArray(0) });
check('1d: an empty picture gives an empty picture', empty.width === 0 && empty.height === 0 && empty.data.length === 0);

// ── 2. mirrorX through its boundary ──

{
  const src = picture(6, 2);
  const seen = [];
  const io = {
    decode: async (url) => { seen.push(['decode', url]); return src; },
    encode: (img) => { seen.push(['encode', img]); return 'data:image/png;base64,OUT'; },
  };
  const result = await mirrorX('data:image/png;base64,IN', io);
  const encoded = seen.find((s) => s[0] === 'encode')?.[1];
  check('2a: mirrorX decodes the data URL it is given, once', seen.filter((s) => s[0] === 'decode').length === 1 && seen[0][1] === 'data:image/png;base64,IN');
  check('2b: ... encodes the mirrored pixels, once, and returns what the encoder gave', result === 'data:image/png;base64,OUT' && seen.filter((s) => s[0] === 'encode').length === 1 && same(Array.from(encoded.data), Array.from(mirrorPixels(src).data)));
  let rejected = false;
  try { await mirrorX('data:bad', { decode: async () => { throw new Error('The picture could not be read.'); }, encode: () => 'x' }); } catch { rejected = true; }
  check('2c: a picture that cannot be decoded rejects, and nothing is encoded', rejected);
  const source = fs.readFileSync(path.join(ROOT, 'src/lib/mirrorImage.ts'), 'utf8');
  check('2d: mirrorX defaults to the browser boundary', /export async function mirrorX\(dataUrl: string, io: MirrorIo = BROWSER_MIRROR_IO\)/.test(source) && typeof BROWSER_MIRROR_IO.decode === 'function' && typeof BROWSER_MIRROR_IO.encode === 'function');
  check('2e: the browser decode draws unsmoothed at the picture\'s own size, and encodes with putImageData', /imageSmoothingEnabled = false/.test(source) && /canvas\.width = width;[\s\S]*canvas\.height = height;/.test(source) && /pixelsToPngDataUrl\(image\.data, image\.width, image\.height\)/.test(source));
}

// ── 3. facingAsShown ──

const FACING = [
  ['right', false, 'right'], ['right', true, 'left'],
  ['left', false, 'left'], ['left', true, 'right'],
  ['three-quarter', false, 'right'], ['three-quarter', true, 'left'],
  ['front', false, 'front'], ['front', true, 'front'],
  ['top-down', false, null], ['top-down', true, null],
  [null, false, null], [null, true, null],
];
for (const [made, mirrored, shown] of FACING) {
  check(`3: made ${made}, ${mirrored ? 'mirrored' : 'as made'}: ${shown}`, facingAsShown(made, mirrored) === shown);
}

// ── 4. The store ──

const store = () => useSpriteStore.getState();
const INITIAL = useSpriteStore.getState();
const reset = () => useSpriteStore.setState(INITIAL, true);
const charA = { dataUrl: 'data:image/png;base64,A', width: 64, height: 64, edited: false, source: { dataUrl: 'data:image/png;base64,a', width: 80, height: 80, targetSize: 64, skipBgRemoval: false, bgTolerance: 30 } };
const charB = { ...charA, dataUrl: 'data:image/png;base64,B' };

reset();
check('4a: the new fields start empty', store().lastCreateFacing === null && store().lastCreateSubject === null && store().handoffFacing === null && store().handoffSubject === null && store().keptCharacter === null && store().animatePrepPending === false && store().createRequest === null && store().textAnimationRequest === null);

store().setLastCreate('right', 'a knight with a blue cape');
check('4b: setLastCreate keeps the facing and the subject', store().lastCreateFacing === 'right' && store().lastCreateSubject === 'a knight with a blue cape');
store().setLastCreate(null, null);
check('4c: ... and null for a description the person wrote', store().lastCreateFacing === null && store().lastCreateSubject === null);

store().setHandoff('left', 'a fox');
check('4d: setHandoff keeps the facing as shown and the subject', store().handoffFacing === 'left' && store().handoffSubject === 'a fox');
store().setHandoff(null, null);
check('4e: ... and clears them', store().handoffFacing === null && store().handoffSubject === null);

reset();
store().keepCharacter('user_a', charA);
check('4f: keepCharacter keeps the character for that account', store().readKeptCharacter('user_a') === charA && keptCharacterFor(store().keptCharacter, 'user_a') === charA);
check('4g: keptCharacterFor never gives another account\'s, and drops nothing', keptCharacterFor(store().keptCharacter, 'user_b') === null && keptCharacterFor(store().keptCharacter, null) === null && store().keptCharacter?.account === 'user_a');
check('4h: a read without an account gives nothing and keeps the one held', store().readKeptCharacter(null) === null && store().readKeptCharacter(undefined) === null && store().readKeptCharacter('user_a') === charA);
check('4i: a read for another account gives nothing and drops the one held', store().readKeptCharacter('user_b') === null && store().keptCharacter === null && store().readKeptCharacter('user_a') === null);
store().keepCharacter('user_a', charA);
store().keepCharacter('user_a', charB);
check('4j: a new character for the account replaces the kept one', store().readKeptCharacter('user_a') === charB);
store().keepCharacter(null, charA);
store().keepCharacter(undefined, charA);
check('4k: without an account nothing is written', store().readKeptCharacter('user_a') === charB);
store().keepCharacter('user_a', null);
check('4l: keepCharacter with null drops it (Remove)', store().keptCharacter === null);

reset();
store().setAnimatePrepPending(true);
check('4m: Auto-Prep\'s waiting flag is set', store().animatePrepPending === true);
store().setAnimatePrepPending(false);
check('4n: ... and cleared', store().animatePrepPending === false);

reset();
store().requestCreate({ card: 'side', subject: 'a fox' });
check('4o: requestCreate asks for Create Sprite with the side card and the subject', store().createRequest?.card === 'side' && store().createRequest?.subject === 'a fox' && store().textAnimationRequest === null);
store().requestTextAnimation({ styleId: 'anim-4angle-walking', subject: null });
check('4p: requestTextAnimation replaces it: one request at a time', store().textAnimationRequest?.styleId === 'anim-4angle-walking' && store().textAnimationRequest?.subject === null && store().createRequest === null);
store().requestCreate({ card: 'side', subject: null });
check('4q: ... and a create request replaces a text animation request', store().createRequest?.subject === null && store().textAnimationRequest === null);
store().clearCreateRequest();
store().requestTextAnimation({ styleId: 'anim-walking-idle', subject: 'a fox' });
store().clearTextAnimationRequest();
check('4r: both clear', store().createRequest === null && store().textAnimationRequest === null);

reset();
store().setLastCreate('front', 's');
store().setHandoff('front', 's');
store().keepCharacter('user_a', charA);
store().setAnimatePrepPending(true);
store().requestCreate({ card: 'side', subject: 's' });
store().setGeneratedImage('data:image/png;base64,R', 'data:image/png;base64,R');
store().clearGeneratedImage();
check('4s: clearGeneratedImage leaves the new fields as they were', store().lastCreateFacing === 'front' && store().handoffFacing === 'front' && store().readKeptCharacter('user_a') === charA && store().animatePrepPending === true && store().createRequest?.subject === 's');
reset();

// ── 5. No em dash ──

const DASH = String.fromCharCode(0x2014);
const dashes = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split(DASH).length - 1;
check('5a: no em dash in mirrorImage.ts', dashes('src/lib/mirrorImage.ts') === 0);
// spriteStore.ts carried four in older comments before G0; G0 adds none.
check('5b: spriteStore.ts has no em dash beyond the four it had', dashes('src/stores/spriteStore.ts') === 4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
