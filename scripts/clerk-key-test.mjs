// scripts/clerk-key-test.mjs
//
// Offline tests for the Clerk publishable key shape check
// (src/lib/clerkKey.ts) that next.config.ts runs at build time (TF-022).
// Run from the repo root: `node scripts/clerk-key-test.mjs`. Bundles the
// module with esbuild into local/.clerk-key-test/ (gitignored). Prints only
// case names and pass or fail; never prints a key.
//
// Every key here is made up: pk_test_ or pk_live_ plus base64 of an invented
// host such as "example.clerk.accounts.dev$". None is a real key.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.clerk-key-test', 'clerkKey.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/clerkKey.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const { publishableKeyProblem } = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const TEST_KEY = `pk_test_${b64('example.clerk.accounts.dev$')}`;
const LIVE_KEY = `pk_live_${b64('clerk.example.com$')}`;
const problem = publishableKeyProblem;
/** The reason mentions the problem and never the key itself. */
const names = (reason, word) => typeof reason === 'string' && reason.includes(word) && !reason.includes('example');

check('well-formed fake test key: no problem', problem(TEST_KEY) === null);
check('well-formed fake live key: no problem', problem(LIVE_KEY) === null);

check('double-quoted key: starts with a quote', names(problem(`"${TEST_KEY}"`), 'starts with a quote or space'));
check('single-quoted key: starts with a quote', names(problem(`'${TEST_KEY}'`), 'starts with a quote or space'));
check('leading quote only: starts with a quote', names(problem(`"${TEST_KEY}`), 'starts with a quote or space'));
check('trailing quote only: ends with a quote', names(problem(`${TEST_KEY}"`), 'ends with a quote'));
check('trailing quote then a newline: ends with a quote', names(problem(`${TEST_KEY}'\n`), 'ends with a quote'));
check('leading space: starts with a space', names(problem(` ${TEST_KEY}`), 'starts with a quote or space'));
// Clerk accepts trailing whitespace (atob ignores it) and such a key works,
// so the build must not fail on it (backlog-1 audit r1).
check('trailing space: no problem, as in Clerk', problem(`${TEST_KEY} `) === null);
check('trailing newline: no problem, as in Clerk', problem(`${TEST_KEY}\n`) === null);
check('trailing CRLF: no problem, as in Clerk', problem(`${LIVE_KEY}\r\n`) === null);

check('wrong prefix pk_dev_: prefix reason', names(problem(`pk_dev_${b64('x.y$')}`), 'pk_live_ or pk_test_'));
check('no prefix at all: prefix reason', names(problem(b64('x.y$')), 'pk_live_ or pk_test_'));
check('prefix in capitals: prefix reason', names(problem(`PK_TEST_${b64('x.y$')}`), 'pk_live_ or pk_test_'));

check('two parts (pk_test, no trailing underscore): prefix reason', names(problem('pk_test'), 'pk_live_ or pk_test_'));
check('prefix only, nothing after it: nothing-after reason', names(problem('pk_test_'), 'nothing after'));
check('four parts: three-parts reason', names(problem(`pk_test_${b64('x.y$')}_extra`), 'three parts'));

check('bad base64 (characters atob rejects): does not decode', names(problem('pk_test_!!!not-base64!!!'), 'does not decode'));
check('bad base64 length (one char short of a multiple of 4): does not decode',
  names(problem(`pk_test_${b64('example.clerk.accounts.dev$')}A`), 'does not decode'));

check('decoded value without a trailing $: does not decode to a host',
  names(problem(`pk_test_${b64('example.clerk.accounts.dev')}`), 'does not decode to a host'));
check('decoded value with two $: does not decode to a host',
  names(problem(`pk_test_${b64('example$.clerk.dev$')}`), 'does not decode to a host'));
check('decoded value with no dot: does not decode to a host',
  names(problem(`pk_test_${b64('localhost$')}`), 'does not decode to a host'));
check('truncated paste (half the encoded host): a reason, not null',
  typeof problem(TEST_KEY.slice(0, 20)) === 'string');

check('an sk_ value: secret key reason', names(problem(`sk_test_${b64('whatever')}`), 'secret key'));
check('an sk_live_ value: secret key reason', names(problem('sk_live_abc'), 'secret key'));
check('a quoted sk_ value reports the quote first', names(problem('"sk_test_abc"'), 'starts with a quote or space'));

check('empty string: a reason (callers allow unset by checking emptiness first)', problem('') === 'is empty');

const sample = [
  `"${TEST_KEY}"`, `${TEST_KEY} `, TEST_KEY.slice(0, 20), 'sk_test_abc', `pk_test_${b64('localhost$')}`,
];
check('no reason ever contains the key or its encoded part',
  sample.every((k) => {
    const r = problem(k) ?? '';
    return !r.includes(k.trim().replace(/["']/g, '')) && !r.includes(b64('example.clerk.accounts.dev$').slice(0, 8));
  }));

process.exit(failed ? 1 : 0);
