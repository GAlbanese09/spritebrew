// scripts/generation-pause-test.mjs
//
// Offline tests for the generation pause (src/lib/generationPause.ts) and its
// guard in fetchGeneration (src/lib/sseClient.ts). Run from the repo root:
// `node scripts/generation-pause-test.mjs`. Bundles the modules with esbuild
// into local/.generation-pause-test/ (gitignored), once per value of
// NEXT_PUBLIC_GENERATION_PAUSED, the way Next inlines it at build time.
// Prints only case names and pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.generation-pause-test');

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

/** Bundles both modules with the switch set to `value` (undefined: unset). */
async function load(tag, value) {
  const outdir = path.join(OUT, tag);
  await build({
    entryPoints: {
      pause: path.join(ROOT, 'src/lib/generationPause.ts'),
      client: path.join(ROOT, 'src/lib/sseClient.ts'),
    },
    bundle: true, format: 'esm', platform: 'node', outdir, logLevel: 'silent',
    outExtension: { '.js': '.mjs' },
    tsconfig: path.join(ROOT, 'tsconfig.json'),
    define: {
      'process.env.NEXT_PUBLIC_GENERATION_PAUSED': value === undefined ? 'undefined' : JSON.stringify(value),
    },
  });
  return {
    pause: await import(pathToFileURL(path.join(outdir, 'pause.mjs')).href),
    client: await import(pathToFileURL(path.join(outdir, 'client.mjs')).href),
  };
}

/** Replaces global fetch with a stub that records calls and answers 202. */
function stubFetch() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ jobId: 'job-1' }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return calls;
}

const DRAFT =
  "Sprite generation is paused while our AI provider is down for maintenance. New generations can't be started until it's back, so no tokens are spent on them. We'll turn it back on as soon as it's back.";

// The upstream-failure copy on main before this change, word for word.
const BEFORE = {
  generation: (note) => `Generation failed due to a temporary issue with the AI service.${note} Please try again in a few minutes.`,
  // G4 (generate-pass.md 4.1): Animate's advice names More settings, where the frame count now is.
  animation: (note) => `Animation failed due to a temporary issue with the AI service.${note} Please try again in a few minutes, or try a smaller frame count (6 or 8) under More settings if the issue persists.`,
};
const NOTE = ' Your tokens have been refunded.';

// The refusal words (design/generate-pass/failure-lines.md, HQ 2026-11-17-236), with
// " under More settings" on Create Sprite (G2) and on Animate My Character (G4).
const REFUSAL = {
  // G2: Create Sprite's size now sits under More settings, so its line ends with those words (failure-lines.md; HQ 2026-11-18-056).
  generation: (note) => `Generation failed: the AI service could not make this one.${note} You can try again, or change the description or the style, or the size under More settings.`,
  'text-animation': (note) => `Animation failed: the AI service could not make this one.${note} You can try again, or change the description or the animation.`,
  animation: (note) => `Animation failed: the AI service could not make this one.${note} You can try again, or change the picture or the action, or the frame count under More settings.`,
};
const REFUSAL_PAUSED = {
  generation: (note) => `Generation failed: the AI service could not make this one.${note}`,
  'text-animation': (note) => `Animation failed: the AI service could not make this one.${note}`,
  animation: (note) => `Animation failed: the AI service could not make this one.${note}`,
};
const KINDS = ['generation', 'text-animation', 'animation'];
// The words a kind falls back to for a failure that is not a refusal: Animate from Text
// keeps the generation words until G1, as today.
const fallbackKind = (kind) => (kind === 'animation' ? 'animation' : 'generation');

// ── Reading the switch ──
{
  const { pause } = await load('unset', undefined);
  const on = ['1', 'true', 'TRUE', ' True ', '1\n'];
  const off = [undefined, '', '0', 'false', 'yes', 'on', '2', ' ', 'paused'];
  check(`on for ${on.map((v) => JSON.stringify(v)).join(', ')}`, on.every((v) => pause.generationPausedFrom(v) === true));
  check(`off for ${off.map((v) => (v === undefined ? 'unset' : JSON.stringify(v))).join(', ')}`, off.every((v) => pause.generationPausedFrom(v) === false));
  check('the message is the text George approved, character for character', pause.GENERATION_PAUSED_MESSAGE === DRAFT);
}

// ── Off (unset, 0, false): nothing changes ──
for (const [tag, value] of [['unset', undefined], ['zero', '0'], ['false', 'false']]) {
  const { pause, client } = await load(tag, value);
  check(`${tag}: GENERATION_PAUSED is false`, pause.GENERATION_PAUSED === false);
  const calls = stubFetch();
  const result = await client.fetchGeneration({ prompt: 'x' }, 'token');
  check(`${tag}: fetchGeneration sends one POST to /api/generate and returns the job`,
    calls.length === 1 && calls[0].url === '/api/generate' && calls[0].init.method === 'POST'
      && result.mode === 'poll' && result.jobId === 'job-1');
  for (const kind of ['generation', 'animation']) {
    check(`${tag}: the ${kind} failure copy is unchanged, with and without the refund note`,
      pause.upstreamFailureMessage(kind, NOTE) === BEFORE[kind](NOTE)
        && pause.upstreamFailureMessage(kind, '') === BEFORE[kind](''));
  }
  for (const kind of KINDS) {
    check(`${tag}: a ${kind} refusal (rd_400, rd_200) shows the refusal words, with and without the refund note`,
      ['rd_400', 'rd_200'].every((code) => pause.providerFailureMessage(kind, NOTE, code) === REFUSAL[kind](NOTE)
        && pause.providerFailureMessage(kind, '', code) === REFUSAL[kind]('')));
    check(`${tag}: a ${kind} failure that is not a refusal (rd_429, rd_500, a timeout, no code) keeps today's words`,
      ['rd_429', 'rd_500', 'rd_async_timeout', 'rd_submit_orphaned_redelivery', undefined].every((code) =>
        pause.providerFailureMessage(kind, NOTE, code) === BEFORE[fallbackKind(kind)](NOTE)));
  }
}

// ── On (1, true): no request leaves, the copy drops its advice ──
for (const [tag, value] of [['one', '1'], ['true', 'true']]) {
  const { pause, client } = await load(tag, value);
  check(`${tag}: GENERATION_PAUSED is true`, pause.GENERATION_PAUSED === true);
  const calls = stubFetch();
  let err = null;
  try {
    await client.fetchGeneration({ prompt: 'x' }, 'token');
  } catch (e) {
    err = e;
  }
  check(`${tag}: fetchGeneration throws GenerationPausedError with the message`,
    err !== null && err.name === 'GenerationPausedError' && err.message === DRAFT);
  check(`${tag}: no request was made`, calls.length === 0);
  for (const kind of ['generation', 'animation']) {
    const m = pause.upstreamFailureMessage(kind, NOTE);
    check(`${tag}: the ${kind} failure copy keeps the refund note and drops "try again"`,
      m === BEFORE[kind](NOTE).split(NOTE)[0] + NOTE && !/try again|few minutes|frame count/i.test(m));
  }
  for (const kind of KINDS) {
    const r = pause.providerFailureMessage(kind, NOTE, 'rd_400');
    check(`${tag}: a ${kind} refusal keeps the refund note and drops its advice`,
      r === REFUSAL_PAUSED[kind](NOTE) && pause.providerFailureMessage(kind, '', 'rd_200') === REFUSAL_PAUSED[kind]('')
        && !/try again|change/i.test(r));
    check(`${tag}: a ${kind} failure that is not a refusal keeps the paused words`,
      pause.providerFailureMessage(kind, NOTE, 'rd_500') === pause.upstreamFailureMessage(fallbackKind(kind), NOTE));
  }
}

// ── Which failures show the provider-failure copy (HQ 2026-11-17-029, -033) ──
{
  const { pause } = await load('unset', undefined);
  const up = pause.isUpstreamFailure;
  // Every provider text the release 1 consumer (rdClient.ts, 1cf3734) writes starts "RD ".
  check('a text starting "RD " is the provider\'s, with or without a code',
    up('RD 500: {"error":"x"}') && up('RD async poll exceeded budget 600000ms for task t', 'rd_async_timeout') && up('RD sync call timed out after 240000ms'));
  check('the older markers still count: inference_failed, Unexpected response, timed out',
    up('task inference_failed') && up('Unexpected response: status=500') && up('request timed out'));
  // The one provider text that does not start "RD " (consumer index.ts 521 at 1cf3734).
  const orphan = 'submit orphaned on redelivery \u2014 RD may have created a task we lost';
  check('the orphaned-submit text alone is not caught, as before this change', up(orphan) === false);
  check('the orphaned-submit text with its code rd_submit_orphaned_redelivery is caught', up(orphan, 'rd_submit_orphaned_redelivery'));
  for (const code of ['rd_submit_orphaned', 'rd_async_timeout', 'rd_sync_timeout', 'rd_task_success_no_image', 'rd_task_unknown_status', 'rd_500', 'rd_0']) {
    check(`any text with code ${code} is caught`, up('anything at all', code));
  }
  for (const code of [undefined, null, 500, ['rd_500'], '', 'rd', 'rd500', 'consumer_unknown', 'dead_lettered', 'stale_running_swept', 'result_store_failed', 'submission_failed', 'RD_500', 'xrd_500']) {
    check(`a plain text with code ${code === undefined ? 'none' : JSON.stringify(code)} is shown as written`, up('This generation could not be started.', code) === false);
  }
  // Animate from Text (G1, AUDIT g1-tabs-r1 M2) is the third form.
  const forms = ['src/components/sprites/GenerationForm.tsx', 'src/components/sprites/AnimateForm.tsx', 'src/components/sprites/TextAnimationForm.tsx'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));
  check('all three forms decide with isUpstreamFailure and the job\'s errorCode',
    forms.every((s) => s.includes('const isUpstreamError = isUpstreamFailure(rawMessage, poll.error?.errorCode);')
      && !s.includes("rawMessage.startsWith('RD ')")));
  check('all three forms word a provider failure with providerFailureMessage, their own kind and the job\'s errorCode',
    forms[0].includes("? providerFailureMessage('generation', refundedNote, poll.error?.errorCode)")
      && forms[1].includes("? providerFailureMessage('animation', refundedNote, poll.error?.errorCode)")
      && forms[2].includes("? providerFailureMessage('text-animation', refundedNote, poll.error?.errorCode)")
      && forms.every((s) => !s.includes('upstreamFailureMessage(')));
}

// ── Which provider failures are refusals (AUDIT rd-swap-r1 M1; HQ 2026-11-17-155, -236) ──
{
  const { pause } = await load('unset', undefined);
  const refusal = pause.isProviderRefusal;
  const yes = ['rd_200', 'rd_400', 'rd_401', 'rd_402', 'rd_403', 'rd_404', 'rd_413', 'rd_422', 'rd_499'];
  const no = ['rd_429', 'rd_500', 'rd_502', 'rd_503', 'rd_0', 'rd_201', 'rd_2000', 'rd_4000', 'rd_40', 'rd_4xx',
    'rd_async_timeout', 'rd_sync_timeout', 'rd_submit_orphaned', 'rd_submit_orphaned_redelivery',
    'rd_task_success_no_image', 'rd_task_unknown_status', 'rd_create_outcome_unknown',
    'RD_400', ' rd_400', 'rd_400 ', 'xrd_400', '', 'consumer_unknown', 'dead_lettered', 'stale_running_swept',
    'result_store_failed', 'submission_failed', undefined, null, 400, ['rd_400']];
  check(`refusals: ${yes.join(', ')}`, yes.every((c) => refusal(c) === true));
  check(`not refusals: ${no.map((c) => (c === undefined ? 'none' : JSON.stringify(c))).join(', ')}`, no.every((c) => refusal(c) === false));
  const words = KINDS.flatMap((k) => [REFUSAL[k](NOTE), REFUSAL_PAUSED[k](NOTE)]);
  check('the refusal words carry no em dash and no "few minutes"', words.every((w) => !w.includes('\u2014') && !/few minutes/i.test(w)));
}

// ── No other copy of the advice in the client ──
{
  const hits = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(ent.name) && fs.readFileSync(p, 'utf8').includes('try again in a few minutes')) {
        hits.push(path.relative(ROOT, p));
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  check('"try again in a few minutes" appears only in src/lib/generationPause.ts', hits.length === 1 && hits[0] === path.join('src', 'lib', 'generationPause.ts'));
  const forms = ['src/components/sprites/GenerationForm.tsx', 'src/components/sprites/AnimateForm.tsx', 'src/components/sprites/TextAnimationForm.tsx'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));
  check('all three forms return from their Generate handler first thing while paused',
    forms[0].includes('if (GENERATION_PAUSED || !prompt.trim() || isGenerating) return;')
      && forms[1].includes('if (GENERATION_PAUSED || !characterDataUrl || isGenerating) return;')
      && forms[2].includes('if (GENERATION_PAUSED || !prompt.trim() || isGenerating) return;'));
}

console.log(failed ? `${failed} failed` : 'all pass');
process.exit(failed ? 1 : 0);
