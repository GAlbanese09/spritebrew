// scripts/rd-bg-test.mjs
//
// Throwaway. Does NOT touch app code. Single question: when we ask RD for a
// transparent sprite sheet on rd_advanced_animation__walking, does it return
// real alpha?
//
// Runs the SAME input through two conditions against /v1/inferences:
//   1. remove_bg: true  + return_spritesheet: true
//   2. (native)         + return_spritesheet: true
// Decodes data.base64_images[0] and reads the PNG IHDR color type at byte
// offset 25 (PNG signature 8B + IHDR chunk: 4B length + 4B "IHDR" + 4B width
// + 4B height + 1B bit depth + 1B color type @ offset 8+4+4+4+4+4+1 = 25):
//   2 = RGB / opaque
//   6 = RGBA / has alpha
//
// Run:
//   RD_API_TOKEN=<token> node scripts/rd-bg-test.mjs ./path/to/opaque-character.png
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

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: RD_API_TOKEN=<token> node scripts/rd-bg-test.mjs <path-to-opaque.png>');
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

for (const c of conditions) {
  try {
    await runOne(c);
  } catch (err) {
    console.log(`${c.name}: threw :: ${err?.message ?? err}`);
  }
}
