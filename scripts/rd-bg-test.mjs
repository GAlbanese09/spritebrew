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
//   on the primary rd_advanced_animation__* style. Prime suspect: the
//   consumer's fallback body still carries frames_duration (the producer's
//   inline runAnimate deletes it before the any_animation retry; the
//   consumer port kept it). Two RD calls total (~$0.50):
//     C3 (baseline): animation__any_animation, no frames_duration, no remove_bg.
//     C4:            identical to C3 plus frames_duration: 16.
//   Stops after C4 and prints a verdict line.
//
// Run:
//   RD_API_TOKEN=<token> node scripts/rd-bg-test.mjs ./path/to/opaque-character.png
//   RD_API_TOKEN=<token> node scripts/rd-bg-test.mjs --fallback-matrix ./path/to/opaque-character.png
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
const inputPath = args.find((a) => !a.startsWith('--'));
if (!inputPath) {
  console.error('Usage: RD_API_TOKEN=<token> node scripts/rd-bg-test.mjs [--fallback-matrix] <path-to-opaque.png>');
  process.exit(1);
}

const inputBytes = await readFile(resolvePath(inputPath));
const inputB64 = inputBytes.toString('base64');

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

if (fallbackMatrixMode) {
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
