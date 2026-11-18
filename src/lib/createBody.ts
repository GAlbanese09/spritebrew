/**
 * The body of a create job's request, the same for Create Sprite and
 * Animate from Text (DESIGN, design/generate-pass/generate-pass.md section 6,
 * G1's checks: for each animation style the body equals Create's for the
 * same style and words). The form adds the idempotency key after it. Pure,
 * so node tests it (scripts/generate-tabs-test.mjs).
 */

import type { Payload } from './sseClient';
import type { GenerationStyle } from './styleRegistry';

export interface CreateBodyInput {
  prompt: string;
  style: GenerationStyle;
  width: number;
  height: number;
  removeBg: boolean;
  referenceImages: readonly string[];
}

/** The keys in the order the Create form has always sent them. */
export function createBody(input: CreateBodyInput): Payload {
  const body: Payload = {
    prompt: input.prompt,
    promptStyle: input.style.promptStyle,
    width: input.width,
    height: input.height,
    expectedTokenCost: input.style.tokenCost,
  };
  if (input.removeBg && input.style.supportsRemoveBg) {
    body.removeBg = true;
  }
  if (input.referenceImages.length > 0 && input.style.supportsReferenceImages === true) {
    body.referenceImages = [...input.referenceImages];
  }
  return body;
}
