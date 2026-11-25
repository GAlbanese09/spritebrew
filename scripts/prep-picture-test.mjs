// Auto-Prep's layout in step 1 (design/generate-pass/generate-pass.md 5.3,
// G4): the pictures' sizes, and what the panel's source must keep: the
// decision first, "Adjust the prep" closed, no text under 12 px.
// Run from the repo root: `node scripts/prep-picture-test.mjs`.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'local', '.prep-picture-test');
await build({ entryPoints: [path.join(ROOT, 'src/lib/prepPicture.ts')], bundle: true, format: 'esm', platform: 'node', outdir: OUT_DIR, outExtension: { '.js': '.mjs' }, logLevel: 'silent' });
const { prepPictureDims, prepPictureBox } = await import(pathToFileURL(path.join(OUT_DIR, 'prepPicture.mjs')).href);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); if (!ok) failed++; };

const cases = [
  // [width, height, box, shown]
  [128, 128, 160, [128, 128]], [64, 64, 160, [128, 128]], [32, 32, 160, [160, 160]], [48, 48, 160, [144, 144]], [192, 192, 160, [96, 96]],
  [256, 256, 160, [128, 128]], [128, 128, 132, [128, 128]], [192, 192, 132, [96, 96]], [1000, 1000, 132, [125, 125]], [128, 128, 127, [64, 64]],
  [200, 100, 160, [100, 50]], [100, 200, 132, [50, 100]], [40, 20, 132, [120, 60]], [0, 10, 160, [0, 0]], [NaN, 10, 160, [0, 0]],
  // A very thin picture keeps a line of pixels (AUDIT g4-animate-r1 L8).
  [600, 6, 160, [150, 1]], [1000, 1, 132, [125, 1]], [1, 1000, 132, [1, 125]],
];
const caseWrong = cases.filter(([w, h, b, want]) => String(prepPictureDims(w, h, b)) !== String(want)).map(([w, h, b, want]) => `${w}x${h} in ${b}: ${prepPictureDims(w, h, b)}, want ${want}`);
check('P1: a picture shows at a whole-number zoom when it fits its box, else at a whole-number fraction rounded down, its shape kept', caseWrong.length === 0, caseWrong);
const every = [];
for (let w = 1; w <= 300; w++) for (const h of [1, 37, 64, 128, 200, 300]) for (const b of [96, 129, 132, 160]) {
  const [sw, sh] = prepPictureDims(w, h, b), side = Math.max(w, h), part = Math.ceil(side / b);
  const zoomOk = side <= b ? sw === w * Math.floor(b / side) && sh === h * Math.floor(b / side) : sw === Math.max(1, Math.floor(w / part)) && sh === Math.max(1, Math.floor(h / part));
  if (!(sw >= 1 && sh >= 1 && sw <= b && sh <= b && Number.isInteger(sw) && Number.isInteger(sh) && zoomOk)) every.push([w, h, b, sw, sh]);
}
check('P2: for every picture of 1 to 300 by six heights and every box, it fits, in whole pixels, at least 1 on each side, at the zoom P1 says', every.length === 0, every.slice(0, 5));
check('P3: two boxes fit side by side, at most the cap: 266 px at 390 gives 129, a wide row gives the cap', prepPictureBox(266, 8, 132) === 129 && prepPictureBox(700, 24, 160) === 160 && prepPictureBox(300, 8, 132) === 132 && prepPictureBox(0, 8, 132) === 0);

const prep = fs.readFileSync(path.join(ROOT, 'src/components/sprites/CharacterAutoPrep.tsx'), 'utf8');
const body = prep.slice(prep.indexOf('  return (\n    <section'), prep.indexOf('function PrepPicture('));
const pictures = body.indexOf('{/* The pictures side by side');
check('P4: the panel opens with its heading, "Check your character", and Use This in its top row, before the pictures, and nowhere after them', body.indexOf('Check your character') > 0 && body.indexOf('onClick={handleAccept}') > body.indexOf('Check your character') && pictures > body.indexOf('onClick={handleAccept}') && !body.slice(pictures).includes('onClick={handleAccept}'));
check('P5: "Adjust the prep" is closed on every open of the panel, and says so to a screen reader', /const \[adjustOpen, setAdjustOpen\] = useState\(false\);/.test(prep) && /aria-expanded=\{adjustOpen\}/.test(prep) && /Adjust the prep/.test(body));
check('P6: no text in the panel is under 12 px: no size in pixels, no 9, 10 or 11 px', !/text-\[\d+px\]/.test(prep));
check('P7: the size line and "Change size", and the way out last', /Prepared at \{prepared\.size\} by \{prepared\.size\} px\./.test(body) && /Change size/.test(body) && body.lastIndexOf("'Upload Different'") > body.indexOf('Adjust the prep'));

console.log(failed ? `\n${failed} FAILED` : '\nall pass');
process.exit(failed ? 1 : 0);
