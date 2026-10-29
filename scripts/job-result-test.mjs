// scripts/job-result-test.mjs
//
// Offline tests for src/lib/jobResult.ts: how a finished generation job's
// result reaches the result card, the same whichever form finishes it
// (#26's follow-up). Run from the repo root: `node scripts/job-result-test.mjs`.
// Bundles the module with esbuild into local/.job-result-test/ (gitignored);
// the despill, the image decode and the card's setters are scripted fakes.
// Prints only case names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.job-result-test', 'jobResult.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/jobResult.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const { ANIMATE_FILL, rescueInfoFor, prepareJobResult, finishJob } = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Fakes: the despill marks the image with its fill; the decode answers with
// the size each case sets. Both record their calls.
function fakeIO(size = null) {
  const calls = { despill: [], key: [], bright: [], decode: [] };
  return {
    calls,
    io: {
      despill: async (dataUrl, fill, opts) => {
        calls.despill.push(fill); calls.key.push(opts?.key); calls.bright.push(opts?.bright);
        return `${dataUrl}#despilled-${fill}`;
      },
      decodedSize: async (dataUrl) => { calls.decode.push(dataUrl); return size; },
    },
  };
}
function fakeSink() {
  const log = [];
  const rec = (name) => (...args) => log.push([name, ...args]);
  return {
    log,
    sink: {
      setRescueInfo: rec('rescue'), setOriginalCharacter: rec('original'), setGeneratedImage: rec('image'),
      setGenerationStyle: rec('style'), setCurrentSheetMetadata: rec('hints'), fetchBalance: rec('balance'),
      onGenerated: rec('generated'),
    },
  };
}

const B64 = 'AAAA';
const DELIVERED = `data:image/png;base64,${B64}`;
const CREATE = { prompt: 'knight with sword', styleId: 'plus-classic' };
const ANIMATE = { action: 'attack', motionPrompt: '', bgColor: '#00ff00', frameCount: 6, frameSize: 128 };
const plain = { resultBase64: B64, completedAt: 1 };
const rescued = (extra) => ({ resultBase64: B64, completedAt: 1, rescued: true, requestedWidth: 128, requestedHeight: 128, deliveredCellSize: 64, ...extra });

// 1. A Create job, on either tab: shown as delivered, no despill, no rescue.
{
  const { io, calls } = fakeIO();
  const r = await prepareJobResult(plain, 'create', CREATE, io);
  check('Create: shown as delivered, never despilled, no rescue',
    r.dataUrl === DELIVERED && calls.despill.length === 0 && r.rescueInfo === null, { r, calls });
  const { sink, log } = fakeSink();
  await finishJob({ result: plain, mode: 'create', context: CREATE, jobId: 'job-1' }, fakeIO().io, sink);
  check('Create: the card clears the previous rescue notice and character, then shows the sheet, its style and its entry',
    same(log, [
      ['rescue', null], ['original', null], ['image', DELIVERED, DELIVERED], ['style', 'plus-classic'], ['balance'],
      ['generated', DELIVERED, 'knight with sword', 'plus-classic', undefined, 'job-1'],
    ]), log);
  const odd = await prepareJobResult(rescued({ deliveredFrames: 4 }), 'create', CREATE, fakeIO().io);
  check('Create: rescue fields on a Create result are ignored', odd.rescueInfo === null && odd.finished.animate === undefined, odd);
  const noMode = await prepareJobResult(plain, null, null, io);
  check('no mode: shown as delivered, like a Create job', noMode.dataUrl === DELIVERED && noMode.finished === null, noMode);
}

// 2. An Animate job, on either tab: despilled with its request's fill.
{
  const { io, calls } = fakeIO();
  const { sink, log } = fakeSink();
  await finishJob({ result: plain, mode: 'animate', context: ANIMATE, jobId: 'job-2' }, io, sink);
  const shown = `${DELIVERED}#despilled-#00ff00`;
  check('Animate: despilled with the fill its request used', same(calls.despill, ['#00ff00']), calls);
  check('Animate: no rescue notice, the character kept, the despilled sheet, its style, and its entry with the requested frames and cell size',
    same(log, [
      ['rescue', null], ['image', shown, shown], ['style', 'any_animation_attack'], ['balance'],
      ['generated', shown, 'attack', 'any_animation_attack', { frameCount: 6, frameSize: 128 }, 'job-2'],
    ]), log);
  const { io: io2, calls: calls2 } = fakeIO();
  const { sink: sink2, log: log2 } = fakeSink();
  await finishJob({ result: plain, mode: 'animate', context: null, jobId: 'job-3' }, io2, sink2);
  check('Animate saved without its context: despilled with the animate fill, and no entry, style or hints',
    same(calls2.despill, [ANIMATE_FILL]) && ANIMATE_FILL === '#ff00ff' &&
    same(log2.map((c) => c[0]), ['rescue', 'image', 'style', 'hints']) && log2[2][1] === null && log2[3][1] === null, { calls2, log2 });
}

// 2b. The pink cleanup's guard (HQ 2026-10-28-004): the fill pockets are
// keyed unless the character sent had fill-coloured pixels of its own.
{
  const keyFor = async (ctx) => {
    const { io, calls } = fakeIO();
    await prepareJobResult(plain, 'animate', ctx, io);
    return calls.key[0];
  };
  check('guard: a character with fill pixels of its own: the sheet is not keyed', (await keyFor({ ...ANIMATE, inputHasFill: true })) === false);
  check('guard: a character without them: keyed', (await keyFor({ ...ANIMATE, inputHasFill: false })) === true);
  check('guard: a job saved before the guard (no field), or without its context: keyed, as the Gallery keys it',
    (await keyFor(ANIMATE)) === true && (await keyFor(null)) === true);
  const { io, calls } = fakeIO();
  await prepareJobResult(plain, 'create', { ...CREATE }, io);
  check('guard: a Create sheet is never cleaned at all', calls.despill.length === 0 && calls.key.length === 0, calls);

  // The bright rim rule: on only when the character is known to have had no
  // mostly-magenta colours of its own (the pink audit, Oct 28).
  const brightFor = async (ctx) => {
    const { io: io2, calls: c2 } = fakeIO();
    await prepareJobResult(plain, 'animate', ctx, io2);
    return c2.bright[0];
  };
  check('bright rule: on for a character known to have no mostly-magenta colours', (await brightFor({ ...ANIMATE, inputHasMagenta: false })) === true);
  check('bright rule: off for a character with them', (await brightFor({ ...ANIMATE, inputHasMagenta: true })) === false);
  check('bright rule: off for a job saved without the field or without its context, as on the Gallery copy',
    (await brightFor(ANIMATE)) === false && (await brightFor(null)) === false);
  check('the two guards are independent: fill pixels of its own turn off the key, magenta ones the bright rule',
    same(await (async () => { const { io: io3, calls: c3 } = fakeIO(); await prepareJobResult(plain, 'animate', { ...ANIMATE, inputHasFill: true, inputHasMagenta: true }, io3); return [c3.key[0], c3.bright[0]]; })(), [false, false]) &&
    same(await (async () => { const { io: io3, calls: c3 } = fakeIO(); await prepareJobResult(plain, 'animate', { ...ANIMATE, inputHasFill: false, inputHasMagenta: false }, io3); return [c3.key[0], c3.bright[0]]; })(), [true, true]));
}

// 3. A rescued animation: the notice's fields, and the frame count derived
// from the sheet when the consumer could not report it.
{
  const { io, calls } = fakeIO({ w: 999, h: 999 });
  const r = await prepareJobResult(rescued({ deliveredFrames: 4 }), 'animate', ANIMATE, io);
  check('rescued with a frame count: the notice has every field, no decode, and the hints use the delivered size',
    same(r.rescueInfo, { rescued: true, requestedWidth: 128, requestedHeight: 128, deliveredCellSize: 64, deliveredFrames: 4 }) &&
    calls.decode.length === 0 && r.finished.animate.frameSize === 64, { r, calls });
  const shown = `${DELIVERED}#despilled-#00ff00`;
  const { io: io2, calls: calls2 } = fakeIO({ w: 128, h: 128 });
  const r2 = await rescueInfoFor(rescued({}), shown, io2.decodedSize);
  check('rescued without a frame count: derived from the decoded sheet (128 by 128 at 64: 4 frames)',
    r2.deliveredFrames === 4 && same(calls2.decode, [shown]), { r2, calls2 });
  const r3 = await rescueInfoFor(rescued({}), shown, fakeIO(null).io.decodedSize);
  check('rescued, the sheet cannot be decoded: no frame count', r3.deliveredFrames === undefined && r3.deliveredCellSize === 64, r3);
  const r4 = await rescueInfoFor(rescued({}), shown, fakeIO({ w: 100, h: 64 }).io.decodedSize);
  check('rescued, the cell size does not divide the sheet: no frame count', r4.deliveredFrames === undefined, r4);
  const { io: io5, calls: calls5 } = fakeIO({ w: 128, h: 128 });
  const r5 = await prepareJobResult({ resultBase64: B64, completedAt: 1, rescued: true }, 'animate', ANIMATE, io5);
  check('rescued with no cell size: no decode, and the hints use the rescue size 64',
    calls5.decode.length === 0 && r5.rescueInfo.deliveredCellSize === undefined && r5.finished.animate.frameSize === 64, { r5, calls5 });
  check('not rescued: no notice', (await rescueInfoFor(plain, shown, fakeIO({ w: 128, h: 128 }).io.decodedSize)) === null);
}

// 4. A failure in the page's callback still leaves the card showing the sheet.
{
  const { sink, log } = fakeSink();
  sink.onGenerated = () => { throw new Error('boom'); };
  let threw = false;
  try { await finishJob({ result: plain, mode: 'create', context: CREATE, jobId: 'job-4' }, fakeIO().io, sink); } catch { threw = true; }
  check('a throwing callback rejects finishJob after the sheet is shown (the forms clear "Brewing..." in finally)',
    threw && log.some((c) => c[0] === 'image'), log.map((c) => c[0]));
}

if (failed > 0) {
  console.log(`${failed} FAIL`);
  process.exit(1);
}
console.log('all pass');
