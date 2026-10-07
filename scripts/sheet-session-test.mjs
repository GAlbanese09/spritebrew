// scripts/sheet-session-test.mjs
//
// Offline tests for the Sheet Tools session codec (src/lib/sheetSession.ts,
// Wave 1 PR 9). Run from the repo root: `node scripts/sheet-session-test.mjs`.
//
// There is no IndexedDB in node (and no fake-indexeddb in this repo), so only
// the pure serializeSheetSession / deserializeSheetSession pair is tested: a
// store state goes to a record and back, and must come back exactly. The
// harness writes only its esbuild bundle, to local/.sheet-session-test
// (gitignored), and prints only case names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.sheet-session-test');

await build({
  entryPoints: { sheetSession: path.join(ROOT, 'src/lib/sheetSession.ts') },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
});
const { serializeSheetSession, deserializeSheetSession } =
  await import(pathToFileURL(path.join(OUT, 'sheetSession.mjs')).href);

let pass = 0, fail = 0;
const check = (name, ok) => {
  if (ok) { pass++; console.log(`pass  ${name}`); } else { fail++; console.log(`FAIL  ${name}`); }
};

// ── Fixture: a 4x2 grid sheet, two groups (one with repeats), an edited frame ──

const frame = (i) => ({
  id: `frame_${i}`, imageData: null,
  x: 2 + (i % 4) * 18, y: 3 + Math.floor(i / 4) * 18, width: 16, height: 16, duration: 125,
});
const frames = Array.from({ length: 8 }, (_, i) => frame(i));
const spriteSheet = {
  id: 'sheet-1790000000000', name: 'knight_walk', sourceImage: 'blob:https://example.invalid/1234',
  frameWidth: 16, frameHeight: 16, columns: 4, rows: 2, totalFrames: 8, padding: 2,
  animations: [{ id: 'all-frames', name: 'All Frames', type: 'all', frames, fps: 8, loop: true }],
};
const groups = [
  { id: 'anim_walk', name: 'Walk', type: 'walk', fps: 10, loop: true,
    frames: [frames[0], frames[1], frames[2], frames[3], frames[2], frames[1]] },
  { id: 'anim_idle', name: 'Idle', type: 'idle', fps: 4, loop: false, frames: [frames[4]] },
  { id: 'anim_empty', name: 'Empty', type: 'custom', fps: 8, loop: true, frames: [] },
];
const frameDataUrls = new Map(frames.map((f) => [f.id, `data:image/png;base64,${Buffer.from(f.id).toString('base64')}`]));
frameDataUrls.set('frame_2', 'data:image/png;base64,ZWRpdGVk'); // edited in the pixel editor
const state = {
  spriteSheet, animations: groups, frameDataUrls,
  currentSheetMetadata: { source: 'animate', animationType: 'walk', frameCount: 8, directional: false, rows: 2, cols: 4 },
  generationStyle: 'any_animation_walk',
};
const bytes = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });

// Like IndexedDB, the record must survive a structured clone.
const record = structuredClone(serializeSheetSession(state, bytes, 1790000000000));
const NEW_URL = 'blob:https://example.invalid/restored';
const back = deserializeSheetSession(record, NEW_URL);

// ── Cases ──

check('record is versioned', record.schema === 'spritebrew.sheet-session' && record.version === 1 && record.savedAt === 1790000000000);
check('record holds the sheet as a Blob, not a URL',
  record.sheetBytes instanceof Blob && record.sheetBytes.size === 8 && !('sourceImage' in record.sheet));
check('record holds no blob URL anywhere', !JSON.stringify(record).includes('blob:'));
check('round trip: deserialize returns a session', back !== null);
check('round trip: slice config (frame size, columns, rows, padding, totals)',
  ['id', 'name', 'frameWidth', 'frameHeight', 'columns', 'rows', 'totalFrames', 'padding']
    .every((k) => back.spriteSheet[k] === spriteSheet[k]));
check('round trip: sheet points at the new URL', back.spriteSheet.sourceImage === NEW_URL);
check('round trip: every frame rect, id and duration', isDeepStrictEqual(back.spriteSheet.animations, spriteSheet.animations));
check('round trip: groups in order, repeats and empty groups kept', isDeepStrictEqual(back.animations, groups));
check('round trip: frame data, edited frame included, in Map order',
  back.frameDataUrls instanceof Map && isDeepStrictEqual([...back.frameDataUrls], [...frameDataUrls]));
check('round trip: slicer hints and generation style',
  isDeepStrictEqual(back.currentSheetMetadata, state.currentSheetMetadata) && back.generationStyle === 'any_animation_walk');
check('round trip: imageData comes back null on every frame',
  [...back.spriteSheet.animations, ...back.animations].every((a) => a.frames.every((f) => f.imageData === null)));
check('round trip: twice gives the same session',
  isDeepStrictEqual(deserializeSheetSession(structuredClone(serializeSheetSession(back, bytes, 1790000000000)), NEW_URL), back));

const bare = deserializeSheetSession(structuredClone(serializeSheetSession(
  { spriteSheet, animations: [], frameDataUrls: new Map(), currentSheetMetadata: null, generationStyle: null },
  bytes, 1)), NEW_URL);
check('round trip: no groups, no metadata',
  bare !== null && bare.animations.length === 0 && bare.frameDataUrls.size === 0 &&
  bare.currentSheetMetadata === null && bare.generationStyle === null);

check('rejects nothing saved', deserializeSheetSession(undefined, NEW_URL) === null && deserializeSheetSession(null, NEW_URL) === null);
check('rejects another schema', deserializeSheetSession({ ...record, schema: 'spritebrew.recovery.manifest' }, NEW_URL) === null);
check('rejects a newer version', deserializeSheetSession({ ...record, version: 2 }, NEW_URL) === null);
check('rejects a record missing its groups', deserializeSheetSession({ ...record, groups: undefined }, NEW_URL) === null);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
