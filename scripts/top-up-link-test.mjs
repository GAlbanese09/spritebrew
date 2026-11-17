// scripts/top-up-link-test.mjs
//
// The Buy Tokens link shows for a top-up error whatever the case of its words.
// The free-tier cap's message reads "Token packs start at $4.99. Top up to keep
// brewing." (em dash list row 17), and both places that offer the link must
// still offer it (REV 2026-11-17-006, H1). Reads the source of the two places,
// takes the very conditions they render the link on, and runs them against the
// messages the app shows. Run from the repo root:
// `node scripts/top-up-link-test.mjs`. Writes nothing.

import { readFileSync } from 'node:fs';

let failed = 0;
let passed = 0;
const check = (name, ok) => {
  if (ok) { passed++; console.log(`pass ${name}`); } else { failed++; console.log(`FAIL ${name}`); }
};

const form = readFileSync('src/components/sprites/GenerationForm.tsx', 'utf8');
const notice = readFileSync('src/components/sprites/GenerationErrorNotice.tsx', 'utf8');
const route = readFileSync('src/app/api/generate/route.ts', 'utf8');

// The conditions, exactly as the source renders them.
const formExpr = (form.match(/\{([^{}]+?) && \(\s*<a\s+href="\/buy-tokens"/) || [])[1];
const noticeExpr = (notice.match(/const showBuyLink =\s*([^;]+);/) || [])[1];
check('1a: the form renders its Buy Tokens button on a condition this test can read', typeof formExpr === 'string');
check('1b: the notice decides showBuyLink on a condition this test can read', typeof noticeExpr === 'string');
const formShows = new Function('generationError', `return (${formExpr});`);
const noticeShows = new Function('generationError', `return (${noticeExpr});`);

// The messages, taken from the source.
const capTemplate = (form.match(/code === 'free_tier_cap_reached'[\s\S]*?setGenerationError\(\s*`([^`]+)`/) || [])[1];
check('2a: the free-tier cap message is found in the form', typeof capTemplate === 'string');
const cap = (label) => capTemplate.replace('${tierLabel}', label);
check('2b: the cap message reads "Top up" with a capital T (row 17)', /\. Top up to keep brewing\.$/.test(cap('Pro')));
const serverCap = (route.match(/message: `([^`]*Top up[^`]*)`/) || [])[1];
check('2c: the server cap message is found in the route', typeof serverCap === 'string');
const shortBalance = 'You need 12 tokens for this style, but you have 3. Try a cheaper style or buy more tokens!';
const plain = 'Generation failed. Try a different prompt.';

for (const label of ['Pro', 'Fast']) {
  check(`3: the form shows Buy Tokens on the ${label} cap message`, formShows(cap(label)) === true);
  check(`4: the notice shows Buy Tokens on the ${label} cap message`, noticeShows(cap(label)) === true);
}
check('5a: the form shows Buy Tokens on the server cap message', formShows(serverCap) === true);
check('5b: the notice shows Buy Tokens on the server cap message', noticeShows(serverCap) === true);
check('6a: lower case "top up" still shows it in the form', formShows('Token packs start at $4.99, so top up to keep brewing.') === true);
check('6b: lower case "top up" still shows it in the notice', noticeShows('Token packs start at $4.99, so top up to keep brewing.') === true);
check('7a: the short-balance message keeps its own inline link, no button, in the form', formShows(shortBalance) === false);
check('7b: the notice still shows Buy Tokens on the short-balance message', noticeShows(shortBalance) === true);
check('8a: a plain failure shows no Buy Tokens in the form', formShows(plain) === false);
check('8b: a plain failure shows no Buy Tokens in the notice', noticeShows(plain) === false);

console.log(`[top-up-link-test] ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
