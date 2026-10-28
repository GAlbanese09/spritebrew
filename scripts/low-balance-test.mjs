// scripts/low-balance-test.mjs
//
// Offline tests for src/lib/lowBalance.ts: when the low-balance banner on
// /generate shows, how "Not now" lasts until the next fall below the
// threshold, and George's words (HQ 2026-10-27-023). Run from the repo root:
// `node scripts/low-balance-test.mjs`. Bundles the module with esbuild into
// local/.low-balance-test/ (gitignored). Prints only case names and pass or
// fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.low-balance-test', 'lowBalance.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/lowBalance.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const {
  LOW_BALANCE_THRESHOLD, LOW_BALANCE_BUTTON, LOW_BALANCE_DISMISS,
  lowBalanceLine, showLowBalance, dismissedAfter, initialDismissed, lowBalanceDismissKey,
} = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

// George's words, as written in HQ 2026-10-27-023.
check('the threshold is 25', LOW_BALANCE_THRESHOLD === 25);
check("the line is George's, with the balance", lowBalanceLine(18) === "You're running low on tokens: 18 left, not enough for an animation.", lowBalanceLine(18));
check('the line with 0 left', lowBalanceLine(0) === "You're running low on tokens: 0 left, not enough for an animation.");
check("the button and the dismiss are George's", LOW_BALANCE_BUTTON === 'Buy tokens' && LOW_BALANCE_DISMISS === 'Not now');

// Who sees it.
const show = (hasPaid, balance, dismissed = false) => showLowBalance({ hasPaid, balance, dismissed });
check('a paid account below 25 sees it', show(true, 24) && show(true, 18) && show(true, 0));
check('at 25 or more it does not show', !show(true, 25) && !show(true, 1000));
check('an account that never paid (or is refund-locked or disputed) does not see it', !show(false, 18));
check('before its balance is read it does not show', !show(true, null));
check('dismissed, it does not show', !show(true, 18, true));

// "Not now" lasts until the next fall below 25.
check('a dismissal holds while the balance stays below 25', dismissedAfter(true, 24) && dismissedAfter(true, 0));
check('a dismissal holds while the balance is unknown', dismissedAfter(true, null));
check('a dismissal ends once the balance is seen at 25 or more', !dismissedAfter(true, 25) && !dismissedAfter(true, 1650));
check('no dismissal stays none', !dismissedAfter(false, 10) && !dismissedAfter(false, 100));
{
  // A run of balances: dismissed at 18, a job takes it to 8, a purchase to
  // 1658, jobs take it to 20: the banner is back.
  let dismissed = true;
  const seen = [];
  for (const b of [18, 8, 1658, 300, 20]) {
    dismissed = dismissedAfter(dismissed, b);
    seen.push(show(true, b, dismissed));
  }
  check('dismissed at 18: hidden at 8, then after a purchase and a fall to 20 it shows again',
    JSON.stringify(seen) === JSON.stringify([false, false, false, false, true]), seen);
}
// A return from Checkout starts dismissed for that page view (the tokens
// may still be on their way), and ends like any dismissal.
check('a return from Checkout starts dismissed; a kept "Not now" does too; otherwise not',
  initialDismissed(false, '?purchase=success') && initialDismissed(true, '') && initialDismissed(true, '?purchase=cancelled') &&
  !initialDismissed(false, '') && !initialDismissed(false, '?purchase=cancelled') && !initialDismissed(false, '?purchase=1'));
{
  // Back from Checkout at 10 (the credit not seen yet), then 510 once it
  // lands, then jobs down to 20: the banner is back on the same page view.
  let dismissed = initialDismissed(false, '?purchase=success');
  const seen = [];
  for (const b of [10, 510, 20]) {
    dismissed = dismissedAfter(dismissed, b);
    seen.push(show(true, b, dismissed));
  }
  check('back from Checkout: hidden at 10, then after the credit is seen and a fall to 20 it shows',
    JSON.stringify(seen) === JSON.stringify([false, false, true]), seen);
}
check('the dismissal is kept per account', lowBalanceDismissKey('user_a') !== lowBalanceDismissKey('user_b') && lowBalanceDismissKey('user_a').includes('user_a'));

if (failed > 0) {
  console.log(`${failed} FAIL`);
  process.exit(1);
}
console.log('all pass');
