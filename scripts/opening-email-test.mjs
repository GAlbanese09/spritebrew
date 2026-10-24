// scripts/opening-email-test.mjs
//
// Offline tests for the opening's own disposable-email check (private-config
// 005). Run from the repo root: `node scripts/opening-email-test.mjs`.
//
// tokenBalance, disposableEmail, constants and moneyPause are bundled with esbuild (shared chunks)
// into local/.opening-email-test/ (gitignored) and called with an in-memory
// KV, a stub ledger for the opening's admission and a fake `fetch` standing
// in for Clerk's Backend API. Fake ids and addresses only; nothing is written
// or printed but case names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// src/lib/stripe.ts builds its client at module load; a placeholder, not a secret.
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_not_a_secret';
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.opening-email-test');

// ── Stubs ──

let calls = [];
let kvMap = new Map();
let kvFailGet = () => false;
function kvStub() {
  return {
    get: async (k) => {
      calls.push(`kv.get ${k}`);
      if (kvFailGet(k)) throw new Error('stub: KV get failed');
      return kvMap.has(k) ? kvMap.get(k) : null;
    },
    put: async (k, v) => { calls.push(`kv.put ${k}`); kvMap.set(k, v); },
    delete: async (k) => { calls.push(`kv.delete ${k}`); kvMap.delete(k); },
    list: async ({ prefix } = {}) => {
      calls.push(`kv.list ${prefix}`);
      return { keys: [...kvMap.keys()].filter((k) => k.startsWith(prefix ?? '')).map((name) => ({ name })), list_complete: true };
    },
  };
}
// The opening's admission, modeled as its SQL behaves (as in money-pause-test.mjs).
let paused = false;
let admissions = new Map();
function ledgerStub() {
  return {
    prepare: (sql) => {
      const stmt = {
        args: [],
        bind: (...a) => { stmt.args = a; return stmt; },
        run: async () => {
          const a = stmt.args;
          if (/INSERT INTO money_admissions/.test(sql)) {
            if (!paused) admissions.set(a[0], { route: a[1], completed: null });
          } else if (/UPDATE money_admissions SET completed_at_ms/.test(sql)) {
            const row = admissions.get(a[0]);
            if (row && row.completed === null) row.completed = a[1];
          }
          return { meta: {} };
        },
        first: async () => {
          if (/FROM money_admissions/.test(sql)) {
            const row = admissions.get(stmt.args[0]);
            if (!row) return null;
            return /completed_at_ms, closed_at_ms/.test(sql)
              ? { completed_at_ms: row.completed, closed_at_ms: null }
              : { admission_id: stmt.args[0] };
          }
          if (/'money_pause'/.test(sql)) return { value: paused ? '1' : '0' };
          return null;
        },
      };
      return stmt;
    },
  };
}
// Clerk: 'ok' answers with `email`, a number answers that status, 'hang' never
// answers until the request is aborted.
let clerk = { mode: 'ok', email: 'person@example.com' };
let clerkCalls = 0;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://api.clerk.com/')) { calls.push('fetch other'); return new Response('{}', { status: 503 }); }
  clerkCalls++;
  if (clerk.mode === 'hang') {
    return new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }
  if (typeof clerk.mode === 'number') return new Response('{}', { status: clerk.mode });
  return new Response(JSON.stringify({
    primary_email_address_id: 'idn_test',
    email_addresses: [{ id: 'idn_test', email_address: clerk.email }],
  }), { status: 200 });
};
let logs = [];
console.warn = () => {};
console.error = (...a) => { logs.push(a.map(String).join(' ')); };
console.log = ((orig) => (...a) => {
  if (typeof a[0] === 'string' && a[0].startsWith('[opening-email-test]')) orig(...a.map((x) => typeof x === 'string' ? x.replace('[opening-email-test] ', '') : x));
  else logs.push(a.map(String).join(' '));
})(console.log);
const say = (...a) => console.log('[opening-email-test]', ...a);

// ── Bundle ──

await build({
  entryPoints: {
    tokenBalance: path.join(ROOT, 'src/lib/tokenBalance.ts'),
    disposableEmail: path.join(ROOT, 'src/lib/disposableEmail.ts'),
    constants: path.join(ROOT, 'src/lib/constants.ts'),
    moneyPause: path.join(ROOT, 'src/lib/moneyPause.ts'),
  },
  bundle: true, splitting: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
});
const load = async (name) => import(pathToFileURL(path.join(OUT, `${name}.mjs`)).href);
const tb = await load('tokenBalance');
const de = await load('disposableEmail');
const { SIGNUP_BONUS_TOKENS, EARLY_ADOPTER_BONUS_TOKENS } = await load('constants');
const { MoneyPausedError } = await load('moneyPause');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; say('FAIL', name); } };

const U = 'user_testOpening';
function reset({ email = 'person@example.com', mode = 'ok' } = {}) {
  calls = []; kvMap = new Map(); kvFailGet = () => false; logs = [];
  paused = false; admissions = new Map();
  clerk = { mode, email }; clerkCalls = 0;
  de.resetExtraDomainsCache();
  process.env = { ...process.env, CLERK_SECRET_KEY: 'placeholder', APP_ENV: 'dev' };
  process.env.SPRITEBREW_KV = kvStub();
  process.env.LEDGER_DB = ledgerStub();
}
const balance = () => { const r = kvMap.get(`token_balance:${U}`); return r ? JSON.parse(r).balance : null; };
const txReasons = () => [...kvMap.entries()].filter(([k]) => k.startsWith(`token_tx:${U}:`)).map(([, v]) => JSON.parse(v).reason);
const flagged = () => kvMap.get(`disposable_blocked:${U}`) === 'true';
const failedLog = () => logs.some((l) => l.includes('"event":"opening_email_check_failed"'));
const completed = () => [...admissions.values()].every((r) => r.completed !== null) && admissions.size === 1;

// 1. Disposable by email, no flag yet (the webhook is late).
reset({ email: 'someone@Mailinator.com' });
let b = await tb.getTokenBalance(U);
check('disposable email, no flag -> 0 tokens', b === 0 && balance() === 0);
check('disposable email, no flag -> reason disposable_email_no_bonus', JSON.stringify(txReasons()) === '["disposable_email_no_bonus"]');
check('disposable email, no flag -> the flag is set after the opening', flagged());
check('disposable email -> no signup_grant, admission completed', !kvMap.has(`signup_grant:${U}`) && completed());
check('disposable email -> the flag put comes after the balance writes',
  calls.indexOf(`kv.put disposable_blocked:${U}`) > calls.indexOf(`kv.put token_balance:${U}`));

// 2. Disposable by flag alone (an ordinary address).
reset();
kvMap.set(`disposable_blocked:${U}`, 'true');
b = await tb.getTokenBalance(U);
check('flag only -> 0 tokens, reason disposable_email_no_bonus', b === 0 && JSON.stringify(txReasons()) === '["disposable_email_no_bonus"]');
check('flag only -> the flag is not rewritten', !calls.includes(`kv.put disposable_blocked:${U}`));

// 3. A domain listed only in the private KV extra list.
reset({ email: 'x@new-throwaway.test' });
kvMap.set('config:disposable_domains_extra', JSON.stringify(['New-Throwaway.test ', 'other.test']));
b = await tb.getTokenBalance(U);
check('KV extra list only -> 0 tokens and the flag set', b === 0 && flagged() && JSON.stringify(txReasons()) === '["disposable_email_no_bonus"]');

// 4. An ordinary address.
reset();
b = await tb.getTokenBalance(U);
check('ok email -> the signup bonus, reason signup_bonus', b === SIGNUP_BONUS_TOKENS && JSON.stringify(txReasons()) === '["signup_bonus"]');
check('ok email -> no flag, signup_grant written, one Clerk call, no failure log',
  !flagged() && kvMap.has(`signup_grant:${U}`) && clerkCalls === 1 && !failedLog());

// 5. Early adopter, ordinary address: unchanged.
reset();
kvMap.set(`gen_count:${U}:2026-01-01`, '1');
b = await tb.getTokenBalance(U);
check('early adopter, ok email -> early adopter bonus unchanged', b === EARLY_ADOPTER_BONUS_TOKENS && JSON.stringify(txReasons()) === '["early_adopter_bonus"]');

// 5b. Early adopter with a disposable address: blocked, as the flag blocks today.
reset({ email: 'old@mailinator.com' });
kvMap.set(`gen_count:${U}:2026-01-01`, '1');
b = await tb.getTokenBalance(U);
check('early adopter, disposable email -> 0, as with the flag', b === 0 && JSON.stringify(txReasons()) === '["disposable_email_no_bonus"]');

// 6. Clerk answers 500: today's behaviour (the flag only), plus the log.
reset({ mode: 500, email: 'someone@mailinator.com' });
b = await tb.getTokenBalance(U);
check('Clerk 500, no flag -> the signup bonus as today, and the failure logged', b === SIGNUP_BONUS_TOKENS && failedLog() && !flagged());
reset({ mode: 500 });
kvMap.set(`disposable_blocked:${U}`, 'true');
b = await tb.getTokenBalance(U);
check('Clerk 500, flag set -> 0 as today, and the failure logged', b === 0 && failedLog());

// 7. Clerk never answers: the 3 s timeout, then today's behaviour.
reset({ mode: 'hang', email: 'someone@mailinator.com' });
let t0 = Date.now();
b = await tb.getTokenBalance(U);
let took = Date.now() - t0;
check('Clerk timeout -> the signup bonus as today, the failure logged', b === SIGNUP_BONUS_TOKENS && failedLog());
check('Clerk timeout -> about 3 s, not longer', took >= 2900 && took < 6000);

// 8. No Clerk secret: unknown, today's behaviour, no Clerk call.
reset({ email: 'someone@mailinator.com' });
delete process.env.CLERK_SECRET_KEY;
b = await tb.getTokenBalance(U);
check('no CLERK_SECRET_KEY -> no Clerk call, the bonus as today, the failure logged', clerkCalls === 0 && b === SIGNUP_BONUS_TOKENS && failedLog());

// 9. An existing signup idempotency key: no Clerk call at all.
reset({ email: 'someone@mailinator.com' });
kvMap.set(`token_idempotency:signup:${U}`, '1');
b = await tb.getTokenBalance(U);
check('existing idempotency key -> no Clerk call, nothing written', clerkCalls === 0 && balance() === null && txReasons().length === 0 && !flagged());

// 9b. A failed idempotency read before the admission: unknown, no Clerk call, the opening runs as today.
reset({ email: 'someone@mailinator.com' });
let first = true;
kvFailGet = (k) => { if (k === `token_idempotency:signup:${U}` && first) { first = false; return true; } return false; };
b = await tb.getTokenBalance(U);
check('failed idempotency read before the admission -> no Clerk call, the opening as today', clerkCalls === 0 && b === SIGNUP_BONUS_TOKENS);

// 10. A paused admission: the Clerk result does not matter, MoneyPausedError, nothing written.
for (const email of ['someone@mailinator.com', 'person@example.com']) {
  reset({ email });
  paused = true;
  let threw = null;
  try { await tb.getTokenBalance(U); } catch (e) { threw = e; }
  check(`paused admission (${email.endsWith('mailinator.com') ? 'disposable' : 'ok'} email) -> MoneyPausedError, nothing written`,
    threw instanceof MoneyPausedError && balance() === null && txReasons().length === 0 && !flagged());
}

// 11. Bad JSON in the extra list: the base list only, logged once.
reset({ email: 'x@new-throwaway.test' });
kvMap.set('config:disposable_domains_extra', '["new-throwaway.test"');
b = await tb.getTokenBalance(U);
check('bad extra-list JSON -> base list only (an unlisted domain gets the bonus)', b === SIGNUP_BONUS_TOKENS && !flagged());
check('bad extra-list JSON -> logged', logs.filter((l) => l.includes('"why":"bad_json"')).length === 1);
reset({ email: 'x@mailinator.com' });
kvMap.set('config:disposable_domains_extra', '{"not":"an array"}');
b = await tb.getTokenBalance(U);
check('extra list not an array -> base list still blocks', b === 0);

// 12. The extra list helper directly.
reset();
const kv = process.env.SPRITEBREW_KV;
let ex = await de.loadExtraDomains(kv);
check('extra list missing -> none, logged once', ex.size === 0 && logs.filter((l) => l.includes('"why":"missing"')).length === 1);
kvMap.set('config:disposable_domains_extra', JSON.stringify(['a.test']));
ex = await de.loadExtraDomains(kv);
check('extra list cached for 60 s (a new value is not seen yet)', ex.size === 0);
de.resetExtraDomainsCache();
ex = await de.loadExtraDomains(kv);
check('after the cache: the new value', ex.has('a.test') && ex.size === 1);
de.resetExtraDomainsCache();
kvFailGet = (k) => k === 'config:disposable_domains_extra';
ex = await de.loadExtraDomains(kv);
check('extra list read error -> none, logged', ex.size === 0 && logs.some((l) => l.includes('"why":"read_failed"')));
check('extra list with no KV -> none', (await de.loadExtraDomains(null)).size === 0);
check('isDisposableEmail: static, extra, neither, malformed',
  de.isDisposableEmail('A@MAILINATOR.COM') && de.isDisposableEmail('a@a.test', new Set(['a.test']))
  && !de.isDisposableEmail('a@a.test') && !de.isDisposableEmail('no-at-sign') && !de.isDisposableEmail('trailing@'));

say(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
