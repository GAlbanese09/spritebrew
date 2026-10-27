// scripts/pack-bonus-test.mjs
//
// Offline test for the token pack bonus labels. A pack's label is its bonus
// over the Starter pack: its tokens per dollar against Starter's, as a whole
// percent, rounded to the nearest. The test pins every label to that, on the
// Buy Tokens page (src/lib/tokenPacks.ts) and in the landing page's pack list
// (src/app/page.tsx, written out by hand), so a change to a pack's tokens or
// price cannot leave a label behind. Run from the repo root:
// `node scripts/pack-bonus-test.mjs`. Bundles tokenPacks.ts with esbuild into
// local/.pack-bonus-test/ (gitignored); prints only case names and pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.pack-bonus-test', 'tokenPacks.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/tokenPacks.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const { TOKEN_PACKS } = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

const starter = TOKEN_PACKS.find((p) => p.id === 'starter');
const perCent = (p) => p.tokens / p.priceInCents;
const bonusPercent = (p) => (perCent(p) / perCent(starter) - 1) * 100;
const label = (p) => `+${Math.round(bonusPercent(p))}%`;

check('Starter is the base and has no bonus label', starter !== undefined && starter.bonus === null);
for (const p of TOKEN_PACKS) {
  const shown = `$${(p.priceInCents / 100).toFixed(2)}`;
  check(`${p.name} shows its charged price (${shown})`, p.priceDisplay === shown, { priceDisplay: p.priceDisplay, priceInCents: p.priceInCents });
}
for (const p of TOKEN_PACKS) {
  if (p.id === 'starter') continue;
  check(`${p.name} is labelled ${label(p)}, its bonus over Starter (${bonusPercent(p).toFixed(2)}%)`,
    p.bonus === label(p), { label: p.bonus, bonus: bonusPercent(p) });
}

// The labels as decided on Oct 27, 2026 (Pro Pack was "+30%").
const byId = Object.fromEntries(TOKEN_PACKS.map((p) => [p.id, p.bonus]));
check('the decided labels: Creator +10%, Studio +20%, Pro Pack +22%',
  byId.creator === '+10%' && byId.studio === '+20%' && byId.pro === '+22%', byId);

// The landing page writes each pack out by hand: its name, its tokens and
// "for $price", with the bonus in brackets after it. Find each pack's line by its first word and its
// price, then compare the tokens and the bracketed label with tokenPacks.ts.
const landing = fs.readFileSync(path.join(ROOT, 'src/app/page.tsx'), 'utf8').split(String.fromCharCode(10));
for (const p of TOKEN_PACKS) {
  const short = p.name.split(' ')[0];
  const lines = landing.filter((l) => [' ', ':'].some((c) => l.trim().startsWith(short + c)) && l.includes(` for ${p.priceDisplay}`));
  check(`landing page lists ${short} once at ${p.priceDisplay}`, lines.length === 1, { found: lines.length });
  if (lines.length !== 1) continue;
  const line = lines[0];
  const tokens = p.tokens.toLocaleString('en-US');
  check(`landing page: ${short} shows ${tokens} tokens`, line.includes(` ${tokens} `), { line: line.trim() });
  const open = line.indexOf('(+');
  const shown = open === -1 ? null : line.slice(open + 1, line.indexOf(')', open));
  check(`landing page: ${short} shows ${p.bonus === null ? 'no bonus' : p.bonus}`, shown === p.bonus, { shown, label: p.bonus });
}

if (failed > 0) {
  console.log(`${failed} FAIL`);
  process.exit(1);
}
console.log('all pass');
