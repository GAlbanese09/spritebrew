// scripts/admin-ids-test.mjs
//
// Offline tests for the server-side admin ids and the constant-time token
// compare (private-config 001). Run from the repo root:
// `node scripts/admin-ids-test.mjs`.
//
// src/lib/adminIds.ts and src/lib/timingSafe.ts are bundled with esbuild into
// local/.admin-ids-test/ (gitignored) and called directly. Every id here is a
// fake test id; no real id or secret is read, written or printed. Output:
// case names and pass or fail only.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.admin-ids-test');

await build({
  entryPoints: { adminIds: 'src/lib/adminIds.ts', timingSafe: 'src/lib/timingSafe.ts' },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
});
const { adminIdsFrom, isAdminUserServer } = await import(pathToFileURL(path.join(OUT, 'adminIds.js')).href);
const { timingSafeEqualString } = await import(pathToFileURL(path.join(OUT, 'timingSafe.js')).href);

const say = (...a) => console.log('[admin-ids-test]', ...a);
let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; say('FAIL', name); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const A = 'user_testAdminA';
const B = 'user_testAdminB';
const C = 'user_testNotAdmin';

// ── The parser ──
check('parser: two ids', same(adminIdsFrom(`${A},${B}`), [A, B]));
check('parser: spaces trimmed', same(adminIdsFrom(`  ${A} ,\t${B}  `), [A, B]));
check('parser: empties dropped', same(adminIdsFrom(`,${A},, ,${B},`), [A, B]));
check('parser: duplicates removed', same(adminIdsFrom(`${A},${B},${A}, ${B}`), [A, B]));
check('parser: empty string -> none', same(adminIdsFrom(''), []));
check('parser: only commas and spaces -> none', same(adminIdsFrom(' , ,, '), []));
check('parser: unset (undefined) -> none', same(adminIdsFrom(undefined), []));
check('parser: null -> none', same(adminIdsFrom(null), []));
check('parser: not a string -> none', same(adminIdsFrom(42), []) && same(adminIdsFrom([A]), []));

// ── isAdminUserServer reads ADMIN_USER_IDS ──
const setIds = (v) => { if (v === undefined) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = v; };
setIds(`${A}, ${B}`);
check('admin: listed id -> true', isAdminUserServer(A) === true && isAdminUserServer(B) === true);
check('admin: other id -> false', isAdminUserServer(C) === false);
check('admin: null, undefined, empty user -> false',
  isAdminUserServer(null) === false && isAdminUserServer(undefined) === false && isAdminUserServer('') === false);
check('admin: no partial or case match', isAdminUserServer('user_testAdmin') === false && isAdminUserServer(A.toUpperCase()) === false);
setIds(undefined);
check('admin: secret unset -> false', isAdminUserServer(A) === false);
setIds('');
check('admin: secret empty -> false', isAdminUserServer(A) === false);
setIds(' , ');
check('admin: secret only separators -> false', isAdminUserServer(A) === false);
setIds(undefined);

// ── The constant-time compare ──
const tok = 'a'.repeat(40);
check('compare: equal -> true', timingSafeEqualString(tok, tok) === true);
check('compare: equal long (over 256 bytes) -> true', timingSafeEqualString('x'.repeat(300), 'x'.repeat(300)) === true);
check('compare: unequal same length -> false', timingSafeEqualString(tok, 'a'.repeat(39) + 'b') === false);
check('compare: first byte differs -> false', timingSafeEqualString(tok, 'b' + 'a'.repeat(39)) === false);
check('compare: different lengths -> false', timingSafeEqualString(tok, tok + 'a') === false && timingSafeEqualString(tok, tok.slice(1)) === false);
check('compare: prefix padded with NUL -> false', timingSafeEqualString('abc', 'abc\u0000') === false);
check('compare: long unequal over 256 bytes -> false', timingSafeEqualString('x'.repeat(300), 'x'.repeat(299) + 'y') === false);
check('compare: empty vs empty -> true', timingSafeEqualString('', '') === true);
check('compare: empty vs token -> false', timingSafeEqualString('', tok) === false && timingSafeEqualString(tok, '') === false);
check('compare: non-ASCII equal and unequal', timingSafeEqualString('tök', 'tök') === true && timingSafeEqualString('tök', 'tok') === false);

say(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
