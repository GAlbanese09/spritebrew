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
// sendToSlicer helpers make the same calls as handleDownload and
// handleSendToSlicer in src/app/gallery/page.tsx; the ownership decision is
// the real module. The harness writes only its esbuild bundle, to
// local/.gallery-ownership-test (gitignored), and prints only case names and
// pass or fail.

import { build } from 'esbuild';
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
  const download = async (jobId) => {
    const token = ownership.download();
    const url = await cleanedUrl(jobId);
    if (!url || !ownership.isCurrent(token)) return;
    world.saved.push(url);
  };
  const sendToSlicer = async (jobId) => {
    const token = ownership.slicer();
    const url = await cleanedUrl(jobId);
    if (!url || !ownership.isCurrent(token)) return;
    world.slicer = { url, jobId };
    world.pushes.push('/upload');
  };
  return { ownership, world, ready, download, sendToSlicer };
}

// 1. The ordinary handoff.
{
  const g = gallery();
  const done = g.sendToSlicer('A');
  await g.ready('A');
  await done;
  check('an ordinary Send to Slicer hands the clean copy over and opens the Slicer once',
    same(g.world.slicer, { url: 'blob:clean-A', jobId: 'A' }) && same(g.world.pushes, ['/upload']), g.world);
}

// 2. Second 118: A is held, B is ready and wins; then A's copy is ready.
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

// 3. Leaving the Gallery for another page while A waits.
{
  const g = gallery();
  const a = g.sendToSlicer('A');
  g.ownership.endVisit();
  await g.ready('A');
  await a;
  check('leaving the Gallery while A waits: A hands nothing over and opens nothing',
    g.world.slicer === null && g.world.pushes.length === 0, g.world);
}

// 4. The account changes on the page while A waits (the Gallery's fetch
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

// 5. Downloads do not replace each other or a Slicer choice.
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

// 6. A Download held while the Gallery is left.
{
  const g = gallery();
  const a = g.download('A');
  g.ownership.endVisit();
  await g.ready('A');
  await a;
  check('leaving the Gallery while a Download waits: no file is saved', g.world.saved.length === 0, g.world);
}

// 7. A click in a later visit acts.
{
  const g = gallery();
  g.ownership.endVisit();
  const s = g.sendToSlicer('A');
  await g.ready('A');
  await s;
  check('a click after the visit changed belongs to the new visit and acts', same(g.world.pushes, ['/upload']), g.world);
}

// 8. The entry is deleted while its copy is cleaned: nothing to hand over.
{
  const g = gallery();
  const s = g.sendToSlicer('A');
  const d = g.download('A');
  await g.ready('A', null);
  await s;
  await d;
  check('deleted while waiting: no handoff and no file', g.world.slicer === null && g.world.saved.length === 0 && g.world.pushes.length === 0, g.world);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('all pass');
