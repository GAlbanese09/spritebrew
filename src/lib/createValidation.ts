// Create-request validation for /api/generate, moved out of the route so it can
// be tested offline (size-limits 001). It runs before the admission and the debit,
// so a refused request costs nothing and reaches neither.

import { getResolutionMode, GENERATION_STYLES } from '@/lib/styleRegistry';
import type { GenerateBody } from '@/app/api/generate/route';

const RD_MAX_REFERENCE_IMAGES = 9;
// 12MB ceiling on total reference payload, expressed in base64 string length
// (base64 inflates raw bytes by ~4/3, so 12MB raw ≈ 16MB base64 chars).
const REF_TOTAL_BASE64_BUDGET = 12 * 1024 * 1024 * 4 / 3;

export function validateCreateBody(body: GenerateBody): string | null {
  if (!body.prompt?.trim()) return 'Prompt is required.';
  const ps = body.promptStyle ?? body.style;
  if (!ps) return 'Style is required.';

  // size-limits 001 and 003: the server refuses what the Create form never sends.
  // Create takes registry styles only (an unregistered one was charged the 16
  // fallback and sent to RD), with whole-number width and height.
  const registered = GENERATION_STYLES.find((s) => s.promptStyle === ps);
  if (!registered) return 'Unknown style.';
  if (body.width === undefined) return 'Width is required.';
  if (body.height === undefined) return 'Height is required.';
  if (!Number.isInteger(body.width)) return 'Width must be a whole number.';
  if (!Number.isInteger(body.height)) return 'Height must be a whole number.';

  // If the picked style has explicit resolutionMode metadata (animation styles),
  // enforce it. Other styles are checked against the registry's minSize and maxSize below.
  const mode = getResolutionMode(ps);
  if (mode && body.width !== undefined && body.height !== undefined) {
    if (mode.kind === 'locked') {
      if (body.width !== mode.size || body.height !== mode.size) {
        return `This style is locked at ${mode.size}x${mode.size}. Got ${body.width}x${body.height}.`;
      }
    } else {
      if (body.width < mode.min || body.width > mode.max) {
        return `Width must be between ${mode.min} and ${mode.max} for this style. Got ${body.width}.`;
      }
      if (body.height < mode.min || body.height > mode.max) {
        return `Height must be between ${mode.min} and ${mode.max} for this style. Got ${body.height}.`;
      }
    }
  }

  // size-limits 001: styles with no resolution mode (Fast, Plus, Pro) keep to the
  // registry's minSize and maxSize, the bounds the Create form clamps to.
  if (!mode) {
    const { minSize, maxSize } = registered;
    if (body.width < minSize || body.width > maxSize) {
      return `Width must be between ${minSize} and ${maxSize} for this style. Got ${body.width}.`;
    }
    if (body.height < minSize || body.height > maxSize) {
      return `Height must be between ${minSize} and ${maxSize} for this style. Got ${body.height}.`;
    }
  }

  // Reference images: only valid for styles flagged supportsReferenceImages.
  if (body.referenceImages && body.referenceImages.length > 0) {
    const style = GENERATION_STYLES.find((s) => s.promptStyle === ps);
    if (!style?.supportsReferenceImages) {
      return `Style "${ps}" does not support reference images. Use a Pro style.`;
    }
    if (body.referenceImages.length > RD_MAX_REFERENCE_IMAGES) {
      return `Maximum ${RD_MAX_REFERENCE_IMAGES} reference images. Received ${body.referenceImages.length}.`;
    }
    for (let i = 0; i < body.referenceImages.length; i++) {
      const img = body.referenceImages[i];
      if (typeof img !== 'string' || img.length === 0) {
        return `Reference image ${i + 1} is not a valid string.`;
      }
      if (img.startsWith('data:')) {
        return `Reference image ${i + 1} includes a data: prefix. Strip it before sending.`;
      }
    }
    const totalSize = body.referenceImages.reduce((sum, img) => sum + img.length, 0);
    if (totalSize > REF_TOTAL_BASE64_BUDGET) {
      return 'Total reference image payload too large. Reduce image count or size.';
    }
  }

  return null;
}
