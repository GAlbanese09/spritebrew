// scripts/slicer-labels-test.mjs
//
// The slicer's numeric fields have names (external product audit r2,
// SB-08): each of Width, Height, Columns, Rows, Padding (px), Offset X and
// Offset Y is a <label> tied to its input by htmlFor and id, so a screen
// reader announces the name (and read-only for Columns and Rows) and a click
// on the label moves to the field. Checks SlicerConfig.tsx by text; BUILD's
// harness checks the page. Run from the repo root:
// `node scripts/slicer-labels-test.mjs`. Prints only case names and pass or
// fail.

import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.join(process.cwd(), 'src/components/sprites/SlicerConfig.tsx'), 'utf8');
let pass = 0;
let fail = 0;
function check(name, ok) {
  if (ok) { pass++; console.log(`pass  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

const FIELDS = [['Width', 'width'], ['Height', 'height'], ['Columns', 'columns'], ['Rows', 'rows'], ['Padding (px)', 'padding'], ['Offset X', 'offset-x'], ['Offset Y', 'offset-y']];
check('1: one id base for the slicer, from useId', /const fieldId = useId\(\);/.test(src));
for (const [label, key] of FIELDS) {
  const esc = label.replace(/[()]/g, '\\$&');
  const re = new RegExp(`<label htmlFor=\\{\`\\$\\{fieldId\\}-${key}\`\\}[^>]*>${esc}</label>\\s*<input\\s+id=\\{\`\\$\\{fieldId\\}-${key}\`\\}`);
  check(`2: "${label}" is the label of its field`, re.test(src));
}
check('3: Columns and Rows stay read-only', (src.match(/readOnly\n/g) ?? []).length === 2);

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nall pass (${pass} cases)`);
process.exit(fail ? 1 : 0);
