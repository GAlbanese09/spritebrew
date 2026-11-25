// scripts/editor-limits-test.mjs
//
// Offline tests for the editor's size caps and their refusal words
// (src/lib/editorConstants.ts; HQ room 2026-11-15-114 and -125; DESIGN -126
// and -129): the side cap is 4096, the total cap 1,048,576 and its own number;
// every sheet SpriteBrew makes opens; the just-over cases refuse in DESIGN's
// words; a 1280 by 512 sheet goes through the store and a project file unchanged.
// On /editor the way out names the Resize page, and those words show it as a
// link to /resize (HQ room 2026-11-17-062).
// Run from the repo root: `node scripts/editor-limits-test.mjs`.
//
// The harness writes only its esbuild bundle, to local/.editor-limits-test
// (gitignored), and prints only case names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.editor-limits-test');

await build({
  entryPoints: {
    editorConstants: path.join(ROOT, 'src/lib/editorConstants.ts'),
    editorStore: path.join(ROOT, 'src/components/sprites/editorStore.ts'),
    spriteProject: path.join(ROOT, 'src/lib/spriteProject.ts'),
    resizePage: path.join(ROOT, 'src/lib/resizePage.ts'),
    refusalText: path.join(ROOT, 'src/components/sprites/EditorRefusalText.tsx'),
  },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error', jsx: 'automatic',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
  external: ['react', 'react-dom'],
  // next/link needs Next's router; in its place a plain link that says what it was given.
  plugins: [{ name: 'link-stand-in', setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'next-link', namespace: 'stand-in' }));
    b.onLoad({ filter: /.*/, namespace: 'stand-in' }, () => ({ contents: "import { jsx } from 'react/jsx-runtime'; export default function Link({ href, className, children }) { return jsx('a', { href, className, 'data-link': 'next', children }); }", loader: 'js' }));
  } }],
});

// The store builds an ImageData as a size hint; Node has none, so a plain stand-in.
globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
};

const load = async (name) => import(pathToFileURL(path.join(OUT, `${name}.mjs`)).href);
const { EDITOR_MAX_DIMENSION, EDITOR_MAX_PIXELS, EDITOR_RESIZE_LINK, EDITOR_RESIZE_WAY_OUT, editorSizeRefusal } = await load('editorConstants');
const { dimsWithinEditorLimits, editorDimsRejectionMessage, useEditorStore } = await load('editorStore');
const { validateProject } = await load('spriteProject');

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

// ---- The caps ----
check('L1: the side cap is 4096 and the total cap 1,048,576, its own number (16 frames of 256 by 256), no longer the side squared',
  EDITOR_MAX_DIMENSION === 4096 && EDITOR_MAX_PIXELS === 1048576 && EDITOR_MAX_PIXELS === 16 * 256 * 256 && EDITOR_MAX_PIXELS !== EDITOR_MAX_DIMENSION ** 2);

const opens = [[1280, 512], [4096, 256], [256, 4096], [1024, 1024], [4096, 1], [1, 4096], [1, 1]];
check("L2: George's 1280 by 512 sheet opens, and so do the extreme shapes the caps allow (4096 by 256, 256 by 4096, 4096 by 1) and the old 1024 by 1024",
  opens.every(([w, h]) => dimsWithinEditorLimits(w, h)), opens.filter(([w, h]) => !dimsWithinEditorLimits(w, h)));

const refused = [[4097, 1], [1, 4097], [4097, 256], [4097, 4097], [919, 1141], [1024, 1025], [4096, 257], [257, 4096], [0, 5], [5, 0], [-1, 5], [NaN, 5], [Infinity, 5], [5, Infinity]];
check('L3: just over refuses: 4097 on a side, 919 by 1141 (1,048,579 pixels, the smallest total over the cap that is a rectangle within 4096 a side; 1,048,577 itself is 17 by 61,681), 1024 by 1025; and no size the editor can read',
  refused.every(([w, h]) => !dimsWithinEditorLimits(w, h)), refused.filter(([w, h]) => dimsWithinEditorLimits(w, h)));

// Every sheet SpriteBrew makes: Animate My Character (frames of 32 to 256 px, 4 to
// 16 frames, any grid the generator picks with no more cells than 16 and room for
// every frame) and Create's styles (stills to 384 px; animation styles' frames to
// 96 px, at most 16 frames).
const animateRefused = [];
let animateCases = 0;
for (const size of [32, 48, 64, 96, 128, 192, 256]) for (const frames of [4, 6, 8, 10, 12, 16])
  for (let cols = 1; cols <= 16; cols++) for (let rows = 1; rows <= 16; rows++) {
    if (cols * rows < frames || cols * rows > 16) continue;
    animateCases++;
    if (!dimsWithinEditorLimits(cols * size, rows * size)) animateRefused.push([size, frames, cols, rows]);
  }
check(`L4: every Animate sheet opens: frames of 32 to 256 px, 4 to 16 frames, every grid of up to 16 cells (${animateCases} cases), 16 frames of 256 in one row included`,
  animateRefused.length === 0 && dimsWithinEditorLimits(16 * 256, 256), animateRefused.slice(0, 3));
check("L5: Create's stills (to 384 by 384) and its animation styles (16 frames of 96 in any grid) open",
  dimsWithinEditorLimits(384, 384) && [[16, 1], [8, 2], [4, 4], [2, 8], [1, 16]].every(([c, r]) => dimsWithinEditorLimits(c * 96, r * 96)));

// ---- The words (DESIGN, rooms 2026-11-15-126 and -129) ----
const words = [
  [[1024, 1792, 'card'], 'This sheet is 1,024 by 1,792 pixels, 1,835,008 in all. The editor opens up to 1,048,576 pixels, such as 16 frames of 256 by 256. To edit it, use Send to Editor on its result card, or use Download as delivered and upload that file.'],
  [[1024, 1792, 'page'], 'This sheet is 1,024 by 1,792 pixels, 1,835,008 in all. The editor opens up to 1,048,576 pixels, such as 16 frames of 256 by 256. To edit it, make it smaller on the Resize page first.'],
  [[5000, 300, 'page'], 'This image is 5,000 pixels wide. The editor opens images up to 4,096 pixels on a side.'],
  [[300, 5000, 'card'], 'This image is 5,000 pixels tall. The editor opens images up to 4,096 pixels on a side.'],
  [[5000, 6000, 'page'], 'This image is 5,000 by 6,000 pixels. The editor opens images up to 4,096 pixels on a side.'],
  [[919, 1141, 'project'], "This project's canvas is 919 by 1,141 pixels, 1,048,579 in all. The editor opens up to 1,048,576 pixels, such as 16 frames of 256 by 256."],
  [[4097, 1, 'project'], "This project's canvas is 4,097 pixels wide. The editor opens images up to 4,096 pixels on a side."],
  [[0, 0, 'page'], 'The editor could not read the size of this image.'],
  [[NaN, 5, 'project'], "This project's canvas has no size the editor can read."],
  [[1792, 1024, 'plain'], 'This sheet is 1,792 by 1,024 pixels, 1,835,008 in all. The editor opens up to 1,048,576 pixels, such as 16 frames of 256 by 256.'],
  [[2.5, 4, 'project'], "This project's canvas has no size the editor can read."],
  // A side of exactly 4,096 is no side over the cap: the total speaks (REV on #70, L1).
  [[4096, 257, 'page'], 'This sheet is 4,096 by 257 pixels, 1,052,672 in all. The editor opens up to 1,048,576 pixels, such as 16 frames of 256 by 256. To edit it, make it smaller on the Resize page first.'],
  [[257, 4096, 'card'], 'This sheet is 257 by 4,096 pixels, 1,052,672 in all. The editor opens up to 1,048,576 pixels, such as 16 frames of 256 by 256. To edit it, use Send to Editor on its result card, or use Download as delivered and upload that file.'],
];
const wrongWords = words.filter(([[w, h, place], want]) => editorSizeRefusal(w, h, place) !== want).map(([args]) => [args, editorSizeRefusal(...args)]);
check('L6: the refusals read as DESIGN wrote them: the real size, then the limit, then what to do (a result card; on /editor the Resize page; none over a side, for a project file, or where neither way out exists: /upload\'s frames and the Animate character, AUDIT r1 M1); a size that is not a whole number cannot be read', wrongWords.length === 0, wrongWords);
const all = words.map(([args]) => editorSizeRefusal(...args));
// The same words rendered in a German locale (where 1,048,576 would read 1.048.576) must not change.
const german = spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(pathToFileURL(path.join(OUT, 'editorConstants.mjs')).href)}); console.log(JSON.stringify([m.editorSizeRefusal(1024, 1792, 'page'), m.editorSizeRefusal(5000, 6000, 'card'), (1048576).toLocaleString()]));`], { env: { ...process.env, LC_ALL: 'de_DE.UTF-8' }, encoding: 'utf8' });
const inGerman = german.status === 0 ? JSON.parse(german.stdout) : null;
check('L7: no em dash, no multiplication sign, and every number with its commas whatever the locale (rendered again under de_DE, where the plain number reads 1.048.576)',
  all.every((t) => !/[\u2014\u00d7]/.test(t)) && inGerman !== null && inGerman[0] === words[1][1] && inGerman[1] === words[4][1] && inGerman[2] === '1.048.576', inGerman ?? german.stderr);
check("L8: editorDimsRejectionMessage gives the same words, on /editor's by default and the card's when asked",
  editorDimsRejectionMessage(1024, 1792) === editorSizeRefusal(1024, 1792, 'page') && editorDimsRejectionMessage(1024, 1792, 'card') === editorSizeRefusal(1024, 1792, 'card') && editorDimsRejectionMessage(5000, 300, 'card') === words[2][1]);

// ---- The store and a project file ----
const bytes = (w, h) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i++) d[i] = (i * 31 + (i >> 9)) & 255; return d; };
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
const S = useEditorStore;
const loaded = [];
for (const [w, h] of [[1280, 512], [4096, 256], [256, 4096]]) {
  S.getState().reset?.();
  const px = bytes(w, h);
  S.getState().loadFrame('current', px, w, h);
  const st = S.getState();
  loaded.push(st.width === w && st.height === h && same(st.pixels, px));
}
check('L9: the store loads 1280 by 512, 4096 by 256 and 256 by 4096 with every byte as given', loaded.every(Boolean), loaded);
S.getState().reset?.();
S.getState().loadFrame('current', bytes(1280, 512), 1280, 512);
const before = S.getState().pixels;
const said = []; const realError = console.error; console.error = (...a) => { said.push(a.join(' ')); };
try { S.getState().loadFrame('current', bytes(4097, 1), 4097, 1); } finally { console.error = realError; }
check('L10: the store refuses 4097 by 1 and keeps what it held, at loadFrame\'s own check (not only the project check behind it)', S.getState().width === 1280 && S.getState().pixels === before && said.some((t) => t.startsWith('[editorStore.loadFrame] dims exceed editor caps:')), said);

S.getState().reset?.();
const sheet = bytes(1280, 512);
S.getState().loadFrame('current', sheet, 1280, 512);
const project = S.getState().toProject();
const checked = validateProject(JSON.parse(JSON.stringify(project)));
S.getState().reset?.();
const reloaded = checked.ok && S.getState().loadProject(checked.project, sheet.slice());
const again = S.getState().toProject();
check('L11: a 1280 by 512 sheet goes through a project file and back unchanged: the envelope survives JSON and validates, loads again, and holds the same size and bytes',
  checked.ok && reloaded === true && again.canvas.width === 1280 && again.canvas.height === 512 && same(S.getState().pixels, sheet), checked.ok ? undefined : checked.error);
const projectAt = (w, h) => validateProject({ ...JSON.parse(JSON.stringify(project)), canvas: { ...project.canvas, width: w, height: h } });
const p4097 = projectAt(4097, 1), pTall = projectAt(1, 4097), pOver = projectAt(919, 1141), pWide = projectAt(4096, 256);
const unread = [projectAt(2.5, 4), projectAt(0, 4), projectAt('64', 4), projectAt(4, null)];
check("L12: a project file over a cap is refused in the project's words, on either side (4097 by 1, 1 by 4097) and over the total; a size it cannot read too (AUDIT r1 L2); 4096 by 256 passes the canvas check",
  !p4097.ok && p4097.error === words[6][1] && !pTall.ok && pTall.error === "This project's canvas is 4,097 pixels tall. The editor opens images up to 4,096 pixels on a side."
  && !pOver.ok && pOver.error === words[5][1] && unread.every((r) => !r.ok && r.error === words[8][1]) && (pWide.ok || !/canvas/i.test(pWide.error)), [p4097, pTall, pOver, unread, pWide.ok || pWide.error]);

// ---- Where each refusal is shown (the callers, read as source) ----
const src = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const landing = src('src/components/sprites/EditorLanding.tsx');
const handoff = src('src/app/editor/page.tsx');
const body = src('src/components/sprites/PixelEditorBody.tsx');
const modal = src('src/components/sprites/PixelEditor.tsx');
const calls = (t) => t.match(/editorDimsRejectionMessage\([^;]*?\)\)?;/g) ?? [];
const places = (t, tag) => [...t.matchAll(new RegExp(`^[ \\t]*<${tag}\\b([\\s\\S]*?)\\/>`, 'gm'))].map((m) => { const p = m[1].match(/\brefusalPlace=(?:"([a-z]+)"|\{([a-zA-Z]+)\})/); return p ? p[1] ?? `{${p[2]}}` : null; });
const want = [
  ['src/components/sprites/GenerationResult.tsx', 'PixelEditor', ['card']],
  ['src/components/sprites/FrameGrid.tsx', 'PixelEditor', ['plain']],
  ['src/components/sprites/CharacterAutoPrep.tsx', 'PixelEditor', ['plain']],
  ['src/app/editor/page.tsx', 'PixelEditorBody', ['page', 'page']],
  ['src/components/sprites/PixelEditor.tsx', 'PixelEditorBody', ['{refusalPlace}']],
];
const placed = want.map(([f, tag, w]) => [f, places(src(f), tag), w]).filter(([, got, w]) => JSON.stringify(got) !== JSON.stringify(w));
check("L13: each caller names where its refusal shows: an upload on /editor, the page's words; the handoff from a result card, the card's; the editor body the place its caller gives, at both of its checks: a result card's words from the card, none of either way out from /upload's frames or the Animate character, /editor's on /editor (AUDIT r1 M1)",
  calls(landing).length === 1 && /, 'page'\)/.test(calls(landing)[0])
  && calls(handoff).length === 2 && calls(handoff).every((c) => /, 'card'\)/.test(c))
  && calls(body).length === 2 && calls(body).every((c) => /, refusalPlace\)\)?;$/.test(c)) && !/layout === 'modal' \? 'card'/.test(body)
  && /refusalPlace: EditorRefusalPlace;/.test(modal) && placed.length === 0,
  [calls(landing), calls(handoff), calls(body), placed]);

// Each refusal is reached only through its own check: the check and the words take the same size, one after the other.
const guarded = (t) => [...t.matchAll(/if \(!dimsWithinEditorLimits\(([^)]*)\)\) \{\n(?:[^\n]*\n){0,3}?[^\n]*editorDimsRejectionMessage\(([^,]*, [^,)]*)/g)].filter((m) => m[1] === m[2]).length;
const guards = [[landing, 1], [handoff, 2], [body, 2]].map(([t, n]) => [guarded(t), (t.match(/dimsWithinEditorLimits\(/g) ?? []).length, n]);
check('L14: every caller checks the size before it shows the words, with the same size, at each of its checks (the /editor upload, the two handoffs: Generate\'s and /resize\'s (external audit SB-06), the editor body twice; AUDIT r1 L1)',
  guards.every(([g, uses, n]) => g === n && uses === n), guards);

// ---- /editor's way out: the Resize page, as a link (HQ room 2026-11-17-062) ----
const { RESIZE_SIDE_CAP } = await load('resizePage');
const { default: EditorRefusalText } = await load('refusalText');
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const shown = (message) => renderToStaticMarkup(createElement(EditorRefusalText, { message }));
const plainText = (html) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const pageOver = [[1024, 1792], [4096, 257], [257, 4096], [919, 1141], [1024, 1025]].map(([w, h]) => editorSizeRefusal(w, h, 'page'));
const others = [...words.filter(([[, , place], want]) => !(place === 'page' && want.endsWith(EDITOR_RESIZE_WAY_OUT))).map(([args]) => editorSizeRefusal(...args)), 'Could not read that file.', 'Resize page'];
check("L15: on /editor a sheet over the total ends \"To edit it, make it smaller on the Resize page first.\" (DESIGN -126, item 2), and no other refusal does; /resize takes every sheet it is said for (up to 4,096 a side, the editor's own side cap)",
  EDITOR_RESIZE_WAY_OUT === 'To edit it, make it smaller on the Resize page first.' && EDITOR_RESIZE_LINK.label === 'Resize page' && EDITOR_RESIZE_LINK.href === '/resize'
  && pageOver.every((t) => t.endsWith(` ${EDITOR_RESIZE_WAY_OUT}`)) && others.every((t) => !t.includes(EDITOR_RESIZE_LINK.label) || t === 'Resize page')
  && RESIZE_SIDE_CAP >= EDITOR_MAX_DIMENSION && readFileSync(path.join(ROOT, 'src/app/resize/page.tsx'), 'utf8').length > 0,
  [pageOver.filter((t) => !t.endsWith(EDITOR_RESIZE_WAY_OUT)), RESIZE_SIDE_CAP]);
const linkHtml = '<a href="/resize" class="relative inline-block underline hover:text-text-primary pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-[13px] pointer-coarse:after:content-[&#x27;&#x27;]" data-link="next">Resize page</a>';
const asShown = pageOver.map(shown);
const othersShown = others.map(shown);
check('L16: those words show "Resize page" as the one link, to /resize, and read the same as the text; every other message shows as it is, with no link',
  asShown.every((h, i) => (h.match(/<a /g) ?? []).length === 1 && h.endsWith(`To edit it, make it smaller on the ${linkHtml} first.`) && plainText(h) === pageOver[i])
  && othersShown.every((h, i) => !/<a /.test(h) && plainText(h) === others[i]),
  [asShown[0], othersShown.filter((h) => /<a /.test(h))]);
const bare = (t, name) => new RegExp(`^\\s*\\{${name}\\}\\s*$`, 'm').test(t);
check("L17: /editor's upload refusal and the editor body's refusal both show through it, and neither shows its message bare",
  /<EditorRefusalText message=\{uploadError\}(?: onResize=\{[^\n]*\})? \/>/.test(landing) && /<EditorRefusalText message=\{loadError\} \/>/.test(body)
  && !bare(landing, 'uploadError') && !bare(body, 'loadError')
  && /import EditorRefusalText from '\.\/EditorRefusalText';/.test(landing) && /import EditorRefusalText from '\.\/EditorRefusalText';/.test(body));

process.exit(failed ? 1 : 0);
