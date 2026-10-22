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
  "Sprite generation is paused while our AI provider is down for maintenance. Your tokens are safe, and nothing is charged while it's paused. We'll turn it back on as soon as it's back.";

// The upstream-failure copy on main before this change, word for word.
const BEFORE = {
  generation: (note) => `Generation failed due to a temporary issue with the AI service.${note} Please try again in a few minutes.`,
  animation: (note) => `Animation failed due to a temporary issue with the AI service.${note} Please try again in a few minutes, or try a smaller frame count (6 or 8) if the issue persists.`,
};
const NOTE = ' Your tokens have been refunded.';

// ── Reading the switch ──
{
  const { pause } = await load('unset', undefined);
  const on = ['1', 'true', 'TRUE', ' True ', '1\n'];
  const off = [undefined, '', '0', 'false', 'yes', 'on', '2', ' ', 'paused'];
  check(`on for ${on.map((v) => JSON.stringify(v)).join(', ')}`, on.every((v) => pause.generationPausedFrom(v) === true));
  check(`off for ${off.map((v) => (v === undefined ? 'unset' : JSON.stringify(v))).join(', ')}`, off.every((v) => pause.generationPausedFrom(v) === false));
  check('the message is HQ\'s draft, character for character', pause.GENERATION_PAUSED_MESSAGE === DRAFT);
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
  const forms = ['src/components/sprites/GenerationForm.tsx', 'src/components/sprites/AnimateForm.tsx'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));
  check('both forms return from their Generate handler first thing while paused',
    forms[0].includes('if (GENERATION_PAUSED || !prompt.trim() || isGenerating) return;')
      && forms[1].includes('if (GENERATION_PAUSED || !characterDataUrl || isGenerating) return;'));
}

console.log(failed ? `${failed} failed` : 'all pass');
process.exit(failed ? 1 : 0);
