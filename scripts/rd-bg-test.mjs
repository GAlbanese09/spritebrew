// scripts/rd-bg-test.mjs
//
// Throwaway. Does NOT touch app code.
//
// DEFAULT MODE — the original transparency question:
//   Runs the SAME input through two conditions against /v1/inferences to
//   confirm remove_bg: true on rd_advanced_animation__walking returns real
//   alpha vs the native path.
//     1. remove_bg: true  + return_spritesheet: true
//     2. (native)         + return_spritesheet: true
//   Decodes data.base64_images[0] and reads the PNG IHDR color type at byte
//   offset 25 (PNG sig 8B + IHDR chunk: 4B length + 4B "IHDR" + 4B width +
//   4B height + 1B bit depth + 1B color type @ offset 8+4+4+4+4+4+1 = 25):
//     2 = RGB / opaque
//     6 = RGBA / has alpha
//
// FALLBACK-MATRIX MODE — --fallback-matrix flag:
//   Diagnoses the consumer's animation__any_animation fallback path against
//   a specific 400 inference_failed observed in production tail after a 524
//   on the primary rd_advanced_animation__* style.
//
//   Single-path invocation (~$0.50, one 64px PNG): the frames_duration
//   suspect. Two RD calls, C3 + C4:
//     C3 (baseline): animation__any_animation, no frames_duration, no remove_bg.
//     C4:            identical to C3 plus frames_duration: 16.
//
//   Two-path invocation (~$0.25, one 256px PNG as the SECOND positional):
//   the large-shape suspect. C3/C4 skipped (already receipted). One RD call,
//   C5, with the FAITHFUL production fallback shape:
//     C5: animation__any_animation @ 256×256 + frames_duration: 8, using the
//         SECOND path as input_image. animation__any_animation is
//         documented as 64×64-locked in our RD research, so this tests
//         whether the consumer's spread-based fallback can rescue a 256px
//         primary attempt as-is.
//
//   Each mode prints a verdict line and stops.
//
// ASYNC MODE — --async flag:
//   Diagnoses RD's async job API before the queue consumer migrates onto it.
//   Sends a normal-looking rd_advanced_animation__walking request with
//   `async_process: true`; RD should immediately return a task descriptor.
//   Prints the FULL raw JSON response (no field-name assumptions — task id
//   may be `task_id`, `id`, or something else; every key is dumped). Then
//   polls GET /v1/inferences/tasks/{taskId} every 5s until a terminal status
//   or 8-minute wall clock, printing each raw response with any base64-looking
//   strings truncated to 40 chars + total length. On success with an image
//   payload, saves rd-test-async.png and asks for the pixel verdict.
//
//   Optional second positional arg is a numeric SIZE (default 64):
//     node scripts/rd-bg-test.mjs --async ./input.png 256
//   Uses it for width and height in the submit payload. Also instruments
//   the submit itself: prints "submit returned after Ns" on response, or
//   "submit THREW after Ns" on a client-side abort (e.g. undici headers
//   timeout ~300s) — distinguishing a client-side give-up from a server
//   524 is the point.
//
// TASKS MODE — --tasks flag:
//   Bare GET against ${RD_API_URL}/tasks with the API key header. No POST,
//   costs nothing. Probes whether RD exposes a task LIST endpoint for
//   recovery of dropped submits (client abort after RD created the task
//   but before returning its id). Prints HTTP status + response body with
//   any base64-looking strings truncated to 40 chars + length.
//
// C6 MODE — --c6 flag:
//   Single sync POST: animation__any_animation @ 64px + frames_duration: 16 +
//   remove_bg: true. Saves rd-test-c6.png on 200 for the actual-pixel verdict
//   (per July 7, RD's IHDR color-type lies about alpha for animation styles;
//   only a pixel scan on the returned PNG is authoritative).
//
// Run:
//   RD_API_TOKEN=<token> node scripts/rd-bg-test.mjs ./path/to/opaque-character.png
//   RD_API_TOKEN=<token> node scripts/rd-bg-test.mjs --fallback-matrix ./path/to/64px.png
//   RD_API_TOKEN=<token> node scripts/rd-bg-test.mjs --fallback-matrix ./path/to/64px.png ./path/to/256px.png
//   RD_API_TOKEN=<token> node scripts/rd-bg-test.mjs --async ./path/to/input.png
//   RD_API_TOKEN=<token> node scripts/rd-bg-test.mjs --async ./path/to/input.png 256
//   RD_API_TOKEN=<token> node scripts/rd-bg-test.mjs --c6 ./path/to/64px.png
//   RD_API_TOKEN=<token> node scripts/rd-bg-test.mjs --tasks
//
// Input requirement: an OPAQUE RGB PNG (no alpha). RD rejects transparency on
// input. To mirror production, use a character on a magenta backdrop, but any
// opaque character works for this test.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

const RD_API_URL = 'https://api.retrodiffusion.ai/v1/inferences';
const FRAMES_DURATION = 4; // matches our app default

const token = process.env.RD_API_TOKEN;
if (!token) {
  console.error('Set RD_API_TOKEN in the environment.');
  process.exit(1);
}

const args = process.argv.slice(2);
const fallbackMatrixMode = args.includes('--fallback-matrix');
const asyncMode = args.includes('--async');
const c6Mode = args.includes('--c6');
const tasksMode = args.includes('--tasks');
const positional = args.filter((a) => !a.startsWith('--'));
const inputPath = positional[0];
// Second positional slot is mode-dependent:
//   --fallback-matrix: a second PATH (256px input) — triggers C5-only.
//   --async:           a numeric SIZE (defaults to 64) for width/height.
//   others:            ignored.
const inputPathC5 = positional[1];
const asyncSize = (() => {
  const raw = positional[1];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 64;
})();
// --tasks is a bare GET, no input needed. Skip the positional check for it.
if (!inputPath && !tasksMode) {
  console.error('Usage: RD_API_TOKEN=<token> node scripts/rd-bg-test.mjs [--fallback-matrix | --async | --c6 | --tasks] [<path-to-opaque.png>] [<second-path-or-async-size>]');
  process.exit(1);
}

// --tasks mode is a bare GET, so it may be invoked without a path. Skip the
// file read when there's no path; other modes still require the input and
// error naturally on the readFile below.
const inputBytes = inputPath ? await readFile(resolvePath(inputPath)) : null;
const inputB64 = inputBytes ? inputBytes.toString('base64') : '';

// Second input (C5-only mode). Loaded on demand — a 256px sheet, distinct
// from the 64px C3/C4 input. Bytes stay unread when this positional is absent.
const inputB64C5 = inputPathC5
  ? (await readFile(resolvePath(inputPathC5))).toString('base64')
  : null;

const basePayload = {
  prompt: 'walking character',
  prompt_style: 'rd_advanced_animation__walking',
  width: 64,
  height: 64,
  num_images: 1,
  frames_duration: FRAMES_DURATION,
  return_spritesheet: true,
  upscale_output_factor: 1,
  input_image: inputB64,
};

const conditions = [
  { name: 'remove_bg', outFile: './rd-test-removebg.png', payload: { ...basePayload, remove_bg: true } },
  { name: 'native', outFile: './rd-test-native.png', payload: { ...basePayload } },
];

async function runOne({ name, outFile, payload }) {
  const res = await fetch(RD_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RD-Token': token,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '(unreadable)');
    console.log(`${name}: HTTP ${res.status} :: ${body.slice(0, 400)}`);
    return;
  }

  const data = await res.json();
  const b64 = data?.base64_images?.[0];
  if (!b64) {
    console.log(`${name}: HTTP ${res.status} :: no base64_images[0] in response`);
    return;
  }

  const png = Buffer.from(b64, 'base64');
  // IHDR color type byte at offset 25.
  // (PNG sig 8B + chunk length 4B + "IHDR" 4B + width 4B + height 4B + bit depth 1B = 25)
  const colorType = png[25];
  const hasAlpha = colorType === 6 || colorType === 4; // 4 = grayscale+alpha, 6 = RGBA
  const colorTypeLabel =
    colorType === 6 ? 'RGBA (6, alpha)'
    : colorType === 2 ? 'RGB (2, opaque)'
    : colorType === 4 ? 'GrayAlpha (4, alpha)'
    : colorType === 0 ? 'Gray (0, opaque)'
    : colorType === 3 ? 'Palette (3, see tRNS for alpha)'
    : `unknown (${colorType})`;

  await writeFile(resolvePath(outFile), png);

  console.log(`${name}: HTTP ${res.status} :: color type ${colorTypeLabel} :: alpha ${hasAlpha ? 'YES' : 'NO'} :: ${outFile}`);
}

// Fallback-matrix helper: lighter than runOne — no PNG decode, no file
// write. Just returns whether RD accepted the payload, with status + body
// captured for the caller's verdict logic. Prints the per-condition line
// itself so the caller only has to reason about ok/status.
async function callFallback(label, payload) {
  try {
    const res = await fetch(RD_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RD-Token': token,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '(unreadable)');
      console.log(`${label}: HTTP ${res.status} :: ${body.slice(0, 400)}`);
      return { ok: false, status: res.status };
    }
    const data = await res.json();
    if (!data?.base64_images?.[0]) {
      console.log(`${label}: HTTP ${res.status} :: no base64_images[0] in response`);
      return { ok: false, status: res.status };
    }
    console.log(`${label}: HTTP ${res.status} :: ok`);
    return { ok: true, status: res.status };
  } catch (err) {
    console.log(`${label}: threw :: ${err?.message ?? err}`);
    return { ok: false, status: 0 };
  }
}

async function runFallbackMatrix() {
  // C5-only mode: caller passed a second positional path. C3/C4 (64px shapes)
  // have already returned 200 on file, so this run diagnoses the FAITHFUL
  // large-shape the consumer's fallback actually sends in production —
  // width/height 256 spread from the primary body into a style that our RD
  // research documents as 64×64-locked.
  if (inputB64C5) {
    const c5Payload = {
      prompt: 'walking character',
      prompt_style: 'animation__any_animation',
      width: 256,
      height: 256,
      num_images: 1,
      return_spritesheet: true,
      frames_duration: 8,
      input_image: inputB64C5,
    };
    const c5 = await callFallback('C5 (any_animation @ 256px + frames_duration 8)', c5Payload);

    let verdict;
    if (c5.status === 400) {
      verdict = 'CONFIRMED: fallback shape fails at 256px (deterministic); fallback cannot rescue large requests as-is';
    } else if (c5.ok) {
      verdict = '256px fallback shape OK; July 13 night was transient RD degradation';
    } else {
      verdict = `C5 failed with HTTP ${c5.status}; not a 400 rejection; no verdict`;
    }
    console.log(`VERDICT: ${verdict}`);
    return;
  }

  // Single-path mode: C3/C4 as before. Byte-identical to the prior version.
  //
  // C3: bare-minimum animation__any_animation body — no frames_duration, no
  // remove_bg. Everything else matches the shape the consumer's fallback
  // sends (return_spritesheet, num_images: 1, 64×64, input_image).
  const c3Payload = {
    prompt: 'walking character',
    prompt_style: 'animation__any_animation',
    width: 64,
    height: 64,
    num_images: 1,
    return_spritesheet: true,
    input_image: inputB64,
  };
  const c4Payload = { ...c3Payload, frames_duration: 16 };

  const c3 = await callFallback('C3 (any_animation baseline)', c3Payload);
  const c4 = await callFallback('C4 (any_animation + frames_duration 16)', c4Payload);

  let verdict;
  if (!c3.ok) {
    verdict = 'baseline failed; RD unhealthy or payload shape wrong; no verdict';
  } else if (c4.status === 400) {
    verdict = 'CONFIRMED: any_animation rejects frames_duration';
  } else if (c4.ok) {
    verdict = 'frames_duration tolerated; suspect size or transient load';
  } else {
    // c3 ok, c4 failed with something other than 400 (5xx, network, etc.).
    verdict = `C4 failed with HTTP ${c4.status}; not a 400 rejection — no verdict`;
  }
  console.log(`VERDICT: ${verdict}`);
}

// Truncate long string values in a JSON object recursively — any string
// > 200 chars is replaced with a prefix + total length marker. Base64
// image blobs land in this window; regular metadata strings do not.
// Threshold is intentionally generous so we don't accidentally clip a
// stringified UUID or a status message.
function truncateBase64Strings(node, maxLen = 200, previewLen = 40) {
  if (typeof node === 'string') {
    if (node.length > maxLen) {
      return `${node.slice(0, previewLen)}...[truncated, total length ${node.length}]`;
    }
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((v) => truncateBase64Strings(v, maxLen, previewLen));
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = truncateBase64Strings(v, maxLen, previewLen);
    }
    return out;
  }
  return node;
}

// Scan a JSON tree for the first plausible base64 PNG payload. Returns the
// raw string or null. Heuristic: string value >= 1000 chars containing only
// base64 characters. Enough to catch RD's output regardless of the field
// name (base64_image, image, data, etc.).
function findBase64Image(node) {
  if (typeof node === 'string') {
    if (node.length >= 1000 && /^[A-Za-z0-9+/=\s]+$/.test(node)) return node.replace(/\s+/g, '');
    return null;
  }
  if (Array.isArray(node)) {
    for (const v of node) {
      const hit = findBase64Image(v);
      if (hit) return hit;
    }
    return null;
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node)) {
      const hit = findBase64Image(v);
      if (hit) return hit;
    }
    return null;
  }
  return null;
}

async function runAsync() {
  // Size defaults to 64 unless a numeric second positional was given
  // (--async <input.png> [size]). Same value used for width AND height so
  // the shape stays square; RD accepts other rectangular sizes but the
  // useful probe values (64, 128, 256) are all square in production.
  console.log(`--async submit: size ${asyncSize}x${asyncSize}`);
  const payload = {
    prompt: 'walking character',
    prompt_style: 'rd_advanced_animation__walking',
    width: asyncSize,
    height: asyncSize,
    num_images: 1,
    frames_duration: 8,
    return_spritesheet: true,
    remove_bg: true,
    input_image: inputB64,
    async_process: true,
  };

  // Instrumentation: distinguish an HTTP 524 (server acknowledged the
  // request and hit the RD edge timeout — task may still exist) from a
  // client-side abort (undici's ~300s headers timeout — no task on the
  // server side, safe to resubmit). Both show up as failures to the
  // consumer, but only the first needs recovery via task-id polling.
  const submitStartedAt = Date.now();
  let submitRes;
  try {
    submitRes = await fetch(RD_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RD-Token': token,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const elapsedSec = Math.round((Date.now() - submitStartedAt) / 1000);
    const name = err?.name ?? 'Error';
    const message = err?.message ?? String(err);
    console.log(`--async submit THREW after ${elapsedSec}s: ${name}: ${message}`);
    console.log('VERDICT: client-side abort — no task id, no server-side record; safe to resubmit');
    return;
  }
  const submitElapsedSec = Math.round((Date.now() - submitStartedAt) / 1000);
  console.log(`--async submit returned after ${submitElapsedSec}s`);

  const submitText = await submitRes.text();
  console.log(`--async submit: HTTP ${submitRes.status}`);
  console.log('--async submit raw response:');
  console.log(submitText);

  if (!submitRes.ok) {
    console.log('VERDICT: async submit failed; no task to poll');
    return;
  }

  let submitJson;
  try {
    submitJson = JSON.parse(submitText);
  } catch {
    console.log('VERDICT: async submit response was not JSON; cannot extract task id');
    return;
  }

  // Field name is unknown — try common shapes. Fall through to a full-key
  // dump if none match, so we don't guess wrong on a future rename.
  const taskId =
    submitJson?.task_id ??
    submitJson?.id ??
    submitJson?.taskId ??
    submitJson?.job_id ??
    submitJson?.jobId ??
    null;

  if (typeof taskId !== 'string' || !taskId) {
    console.log('VERDICT: no task id in response; response keys:',
      submitJson && typeof submitJson === 'object' ? Object.keys(submitJson) : '(non-object)');
    process.exit(1);
  }

  console.log(`--async task id: ${taskId}`);
  const pollUrl = `${RD_API_URL}/tasks/${taskId}`;
  const startedAt = Date.now();
  const timeoutMs = 8 * 60 * 1000; // 8 minutes
  const intervalMs = 5000;
  const terminalStatuses = /^(succeeded|failed|completed|complete|error|errored|cancelled|canceled)$/i;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      console.log('VERDICT: async poll timed out after 8 minutes');
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));

    const pollRes = await fetch(pollUrl, {
      method: 'GET',
      headers: { 'X-RD-Token': token },
    });
    const pollText = await pollRes.text();
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    console.log(`--async poll @ ${elapsedSec}s: HTTP ${pollRes.status}`);

    let pollJson;
    try {
      pollJson = JSON.parse(pollText);
    } catch {
      console.log('--async poll: non-JSON response body:');
      console.log(pollText.slice(0, 800));
      continue;
    }
    console.log('--async poll raw response (base64 strings truncated):');
    console.log(JSON.stringify(truncateBase64Strings(pollJson), null, 2));

    // Terminal-status matching — try common status field names, loose match.
    const status =
      pollJson?.status ??
      pollJson?.state ??
      pollJson?.task_status ??
      pollJson?.result_status ??
      null;
    if (typeof status === 'string' && terminalStatuses.test(status)) {
      const isSuccess = /^(succeeded|completed|complete)$/i.test(status);
      if (isSuccess) {
        const b64 = findBase64Image(pollJson);
        if (b64) {
          const png = Buffer.from(b64, 'base64');
          const outPath = './rd-test-async.png';
          await writeFile(resolvePath(outPath), png);
          console.log(`--async: saved ${outPath} (${png.length} bytes)`);
          console.log('share rd-test-async.png for the pixel verdict');
        } else {
          console.log(`--async: terminal status "${status}" but no base64 image payload found`);
        }
      } else {
        console.log(`--async: terminal failure status "${status}"`);
      }
      return;
    }
  }
}

async function runC6() {
  const payload = {
    prompt: 'walking character',
    prompt_style: 'animation__any_animation',
    width: 64,
    height: 64,
    num_images: 1,
    frames_duration: 16,
    remove_bg: true,
    return_spritesheet: true,
    input_image: inputB64,
  };

  const res = await fetch(RD_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RD-Token': token,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '(unreadable)');
    console.log(`--c6: HTTP ${res.status} :: ${body.slice(0, 400)}`);
    return;
  }

  const data = await res.json();
  const b64 = data?.base64_images?.[0];
  if (!b64) {
    console.log(`--c6: HTTP ${res.status} :: no base64_images[0] in response`);
    return;
  }
  const png = Buffer.from(b64, 'base64');
  const outPath = './rd-test-c6.png';
  await writeFile(resolvePath(outPath), png);
  console.log(`--c6: saved ${outPath} (${png.length} bytes)`);
  console.log('share rd-test-c6.png for the pixel verdict (IHDR lies, per July 7)');
}

// --tasks: bare GET against the tasks collection endpoint (no id). Probes
// whether RD exposes a list of the caller's outstanding tasks, which would
// let the consumer recover the task id of a submit whose response was lost
// (client abort, edge timeout after task creation, etc.). No POST, so no
// generation is billed. Prints status + response body with any base64-looking
// strings truncated to 40 chars + total length.
async function runTasks() {
  const url = `${RD_API_URL}/tasks`;
  console.log(`--tasks GET: ${url}`);
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'X-RD-Token': token },
    });
  } catch (err) {
    console.log(`--tasks THREW: ${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`);
    return;
  }
  const text = await res.text();
  console.log(`--tasks: HTTP ${res.status}`);
  let asJson;
  try {
    asJson = JSON.parse(text);
  } catch {
    console.log('--tasks response body (non-JSON, first 800 chars):');
    console.log(text.slice(0, 800));
    return;
  }
  console.log('--tasks response body (base64 strings truncated):');
  console.log(JSON.stringify(truncateBase64Strings(asJson), null, 2));
}

if (asyncMode) {
  await runAsync();
} else if (c6Mode) {
  await runC6();
} else if (tasksMode) {
  await runTasks();
} else if (fallbackMatrixMode) {
  await runFallbackMatrix();
} else {
  for (const c of conditions) {
    try {
      await runOne(c);
    } catch (err) {
      console.log(`${c.name}: threw :: ${err?.message ?? err}`);
    }
  }
}
