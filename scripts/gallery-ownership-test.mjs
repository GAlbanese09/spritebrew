// scripts/gallery-ownership-test.mjs
//
// Offline tests for completion-time ownership in the Gallery
// (src/lib/galleryOwnership.ts, Second 118): Download and Send to Slicer wait
// for an animation's clean copy, and act only if they still belong to the
// Gallery's visit and, for the Slicer, are still the newest choice. Run from
// the repo root: `node scripts/gallery-ownership-test.mjs`.
//
// Each case is ordered: a click captures its token and waits for its clean
// copy, something newer may happen, then the copy is ready. The download and
// sendToSlicer helpers call the module's whenCurrent exactly as
// handleDownload and handleSendToSlicer in src/app/gallery/page.tsx do, so
// the click, the wait and the check before acting are the real code; only
// what the page does when it acts (save a file, hand over and navigate) is
// recorded here instead. Section 2 reads the page's source and checks the
// wiring a module test cannot reach: both handlers go through whenCurrent
// with nothing awaited around it, every handoff write and navigation sits
// inside it, and the fetch effect's cleanup, which runs on unmount and on
// every account change, ends the visit. The harness writes only its esbuild
// bundle, to local/.gallery-ownership-test (gitignored), and prints only case
// names and pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.gallery-ownership-test', 'galleryOwnership.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/galleryOwnership.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: OUT, logLevel: 'error',
});
const { createGalleryOwnership } = await import(pathToFileURL(OUT).href);

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`pass  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// One Gallery visit's world: what the Slicer was handed, where the router
// went, which files were saved, and each entry's clean copy, held until the
// case says it is ready (no URL, here null, once its entry is deleted).
function gallery() {
  const ownership = createGalleryOwnership();
  const world = { slicer: null, pushes: [], saved: [] };
  const held = {};
  const cleanedUrl = (jobId) => {
    if (!held[jobId]) {
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      held[jobId] = { promise, resolve };
    }
    return held[jobId].promise;
  };
  const ready = async (jobId, url = `blob:clean-${jobId}`) => { cleanedUrl(jobId); held[jobId].resolve(url); await new Promise((r) => setTimeout(r, 0)); };
  // As handleDownload and handleSendToSlicer (animations).
  const download = (jobId) => ownership.whenCurrent('download', () => cleanedUrl(jobId), (url) => {
    world.saved.push(url);
  });
  const sendToSlicer = (jobId) => ownership.whenCurrent('slicer', () => cleanedUrl(jobId), (url) => {
    world.slicer = { url, jobId };
    world.pushes.push('/upload');
  });
  return { ownership, world, ready, download, sendToSlicer };
}

// 1. The decisions, in order.

// 1a. The ordinary handoff.
{
  const g = gallery();
  const done = g.sendToSlicer('A');
  await g.ready('A');
  await done;
  check('an ordinary Send to Slicer hands the clean copy over and opens the Slicer once',
    same(g.world.slicer, { url: 'blob:clean-A', jobId: 'A' }) && same(g.world.pushes, ['/upload']), g.world);
}

// 1b. Second 118: A is held, B is ready and wins; then A's copy is ready.
{
  const g = gallery();
  const a = g.sendToSlicer('A');
  await g.ready('B');
  await g.sendToSlicer('B');
  await g.ready('A');
  await a;
  check('A held, then B: B is handed over; A, ready later, changes nothing and opens nothing',
    same(g.world.slicer, { url: 'blob:clean-B', jobId: 'B' }) && same(g.world.pushes, ['/upload']), g.world);
}

// 1c. Leaving the Gallery for another page while A waits.
{
  const g = gallery();
  const a = g.sendToSlicer('A');
  g.ownership.endVisit();
  await g.ready('A');
  await a;
  check('leaving the Gallery while A waits: A hands nothing over and opens nothing',
    g.world.slicer === null && g.world.pushes.length === 0, g.world);
}

// 1d. The account changes on the page while A waits (the Gallery's fetch
// effect ends the visit as it starts the new account's).
{
  const g = gallery();
  const a = g.sendToSlicer('A');
  const d = g.download('A');
  g.ownership.endVisit();
  await g.ready('A');
  await a;
  await d;
  check('an account change while A waits: no handoff, no navigation, no file',
    g.world.slicer === null && g.world.pushes.length === 0 && g.world.saved.length === 0, g.world);
}

// 1e. Downloads do not replace each other or a Slicer choice.
{
  const g = gallery();
  const a = g.download('A');
  await g.ready('B');
  await g.download('B');
  const s = g.sendToSlicer('B');
  await g.ready('A');
  await a;
  await s;
  check('two Downloads, A held: both files are saved; a Slicer click meanwhile does not cancel A',
    same(g.world.saved, ['blob:clean-B', 'blob:clean-A']) && same(g.world.slicer, { url: 'blob:clean-B', jobId: 'B' }), g.world);
}

// 1f. A Download held while the Gallery is left.
{
  const g = gallery();
  const a = g.download('A');
  g.ownership.endVisit();
  await g.ready('A');
  await a;
  check('leaving the Gallery while a Download waits: no file is saved', g.world.saved.length === 0, g.world);
}

// 1g. A click in a later visit acts.
{
  const g = gallery();
  g.ownership.endVisit();
  const s = g.sendToSlicer('A');
  await g.ready('A');
  await s;
  check('a click after the visit changed belongs to the new visit and acts', same(g.world.pushes, ['/upload']), g.world);
}

// 1h. The entry is deleted while its copy is cleaned: nothing to hand over.
{
  const g = gallery();
  const s = g.sendToSlicer('A');
  const d = g.download('A');
  await g.ready('A', null);
  await s;
  await d;
  check('deleted while waiting: no handoff and no file', g.world.slicer === null && g.world.saved.length === 0 && g.world.pushes.length === 0, g.world);
}

// 1i. A sheet with nothing to clean (a Create entry's URL, given at once):
// whenCurrent still checks before acting, and says whether it acted.
{
  const g = gallery();
  const acted = await g.ownership.whenCurrent('slicer', () => 'blob:create-C', (url) => { g.world.slicer = { url, jobId: 'C' }; });
  const none = await g.ownership.whenCurrent('download', () => undefined, () => { g.world.saved.push('none'); });
  check('a URL given at once acts and resolves true; no URL acts on nothing and resolves false',
    acted === true && none === false && same(g.world.slicer, { url: 'blob:create-C', jobId: 'C' }) && g.world.saved.length === 0, g.world);
}

// 2. The page's wiring (src/app/gallery/page.tsx, read as text). Text is
// compared with each line trimmed and the lines joined by one space.
{
  const src = fs.readFileSync(path.join(ROOT, 'src/app/gallery/page.tsx'), 'utf8');
  const NL = String.fromCharCode(10);
  const flat = (text) => text.split(NL).map((l) => l.trim()).filter(Boolean).join(' ');
  const count = (text, needle) => text.split(needle).length - 1;
  // A handler's text: from its declaration to the end of its useCallback.
  const handler = (name) => {
    const start = src.indexOf(`const ${name} = useCallback(`);
    if (start < 0) return '';
    const end = src.indexOf(']);', start);
    return end < 0 ? '' : flat(src.slice(start, end + 3));
  };
  const dl = handler('handleDownload');
  const sl = handler('handleSendToSlicer');
  // The act passed to whenCurrent: from its arrow to the brace that closes
  // it, which must also close the whenCurrent call and then the handler, so
  // nothing (an await, a then, a later write) runs after the check outside
  // it.
  const actOf = (text, name, action) => {
    if (!text.startsWith(`const ${name} = useCallback((entry: GalleryEntryV1) => ownership.whenCurrent( '${action}', `)) return '';
    const arrow = text.indexOf('(url) => {');
    const close = text.indexOf('}, ), [');
    if (arrow < 0 || close < arrow || close !== text.lastIndexOf('}, ), [') || text.indexOf(']);') !== text.length - 3) return '';
    return text.slice(arrow, close);
  };
  const dlAct = actOf(dl, 'handleDownload', 'download');
  const slAct = actOf(sl, 'handleSendToSlicer', 'slicer');
  check('both handlers are one whenCurrent call each, with nothing awaited or run after it',
    dlAct !== '' && slAct !== '' && ![dl, sl].some((t) => t.includes('await') || t.includes('.then(')),
    { download: dl.slice(0, 160), slicer: sl.slice(0, 160) });
  const writes = ['setGeneratedImage(', 'setGenerationStyle(', 'setCurrentSheetMetadata(', 'router.push('];
  check("every handoff write and navigation on the page is inside Send to Slicer's act, and the Download's click inside its own",
    writes.every((w) => count(src, w) >= 1 && count(slAct, w) === count(src, w)) && count(dlAct, 'a.click()') === 1,
    writes.map((w) => [w, count(src, w), count(slAct, w)]));
  // The visit ends in the cleanup of the effect that depends on the account.
  const endAt = src.indexOf('ownership.endVisit();');
  const close = endAt < 0 ? -1 : src.indexOf('}, [', endAt);
  const before = endAt < 0 ? '' : flat(src.slice(Math.max(0, endAt - 200), endAt));
  const rest = close < 0 ? '' : src.slice(endAt, close);
  const deps = close < 0 ? '' : src.slice(close, close + 13);
  check("the fetch effect's cleanup ends the visit, and that effect depends on the account (userId) alone",
    count(src, 'ownership.endVisit()') === 1 && before.endsWith('return () => { cancelled = true;')
      && count(rest, '};') === 1 && !rest.includes('useEffect(') && deps === '}, [userId]);',
    { before: before.slice(-80), deps });
}

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('all pass');
