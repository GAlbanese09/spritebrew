// src/lib/rdBodyBuilder.ts
//
// Pure functions that translate inbound GenerateBody (camelCase from request)
// into RD wire format (snake_case). Used by the queue-kickoff path (gate
// before enqueue) — Build #2A.1.
//
// MUST produce identical output to the inline construction in runCreate and
// runAnimate (src/app/api/generate/route.ts). The old SSE path still uses
// inline construction; this duplication is intentional for the gated rollout
// and will be reconciled when runCreate/runAnimate are deleted in Build #3.
//
// Single source of truth for RD wire format on the producer side. If you
// change RD's API contract, update both this file and the consumer's
// equivalent shapes at github.com/GAlbanese09/spritebrew-rd-consumer/src/rdClient.ts.

import type { GenerateBody } from '@/app/api/generate/route';

// === Constants — mirror route.ts exactly ===
// Duplicated from route.ts (which keeps these module-internal). Both copies
// must change together — refactor reconciles this in Build #3.

const VALID_FRAME_DURATIONS = [4, 6, 8, 10, 12, 16];

const ACTION_STYLE_MAP: Record<string, string> = {
  walking: 'rd_advanced_animation__walking',
  idle: 'rd_advanced_animation__idle',
  attack: 'rd_advanced_animation__attack',
  jump: 'rd_advanced_animation__jump',
  crouch: 'rd_advanced_animation__crouch',
  destroy: 'rd_advanced_animation__destroy',
  subtle_motion: 'rd_advanced_animation__subtle_motion',
  custom_action: 'rd_advanced_animation__custom_action',
};

const ACTION_PROMPT_PREFIX: Record<string, string> = {
  walking: 'walking animation, smooth steps',
  idle: 'idle breathing animation, subtle movement',
  attack: 'attack animation, melee swing',
  jump: 'jump animation, rising and falling',
  crouch: 'crouching animation, ducking down',
  destroy: 'death animation, falling and fading',
  subtle_motion: 'subtle ambient motion, wind effect',
  custom_action: '',
};

const FALLBACK_STYLE = 'animation__any_animation';

// === Wire-format types — match consumer's rdClient.ts ===

export interface RdCreateBody {
  prompt: string;
  prompt_style: string;
  width: number;
  height: number;
  num_images: 1;
  remove_bg?: boolean;
  return_spritesheet?: boolean;
  reference_images?: string[];
}

export interface RdAnimateBody {
  prompt: string;
  prompt_style: string;
  width: number;
  height: number;
  num_images: 1;
  frames_duration: number;
  return_spritesheet: true;
  input_image: string;
}

// === Builders ===
//
// Both functions mirror runCreate/runAnimate exactly, including:
//   - The same default values (none for width/height in create; 64 for animate).
//   - The same conditional inclusion semantics (omitted when condition false,
//     not set to false/null).
//   - The same trim()/replace() transformations on prompt and inputImage.
//   - The same fallback to FALLBACK_STYLE for unknown actions.
//
// The animate fallback retry (route.ts runAnimate catch block) is NOT
// replicated here — that's the consumer's responsibility now, handled by
// callRdAnimateWithFallback in the consumer Worker.

/**
 * Build the RD wire body for Create New mode.
 * Mirrors runCreate (route.ts) byte-for-byte for the initial RD request.
 */
export function buildRdCreateBody(body: GenerateBody): RdCreateBody {
  const promptStyle = body.promptStyle ?? body.style ?? '';
  const isAnimation = promptStyle.startsWith('animation__');

  const out: RdCreateBody = {
    prompt: body.prompt!.trim(),
    prompt_style: promptStyle,
    // runCreate passes width/height through verbatim, no defaults — preserve
    // that. JSON.stringify drops undefined fields, which is what RD sees today.
    width: body.width as number,
    height: body.height as number,
    num_images: 1,
  };

  if (body.removeBg) out.remove_bg = true;
  if (isAnimation) out.return_spritesheet = true;

  if (body.referenceImages && body.referenceImages.length > 0) {
    out.reference_images = body.referenceImages;
  }

  return out;
}

/**
 * Build the RD wire body for Animate My Character mode.
 * Mirrors runAnimate (route.ts) byte-for-byte for the initial RD request.
 * Does NOT encode the animation__any_animation fallback retry — the consumer
 * handles that via callRdAnimateWithFallback.
 */
export function buildRdAnimateBody(body: GenerateBody): RdAnimateBody {
  const { inputImage, action, framesDuration, motionPrompt } = body;
  const duration =
    framesDuration && VALID_FRAME_DURATIONS.includes(framesDuration)
      ? framesDuration
      : 4;
  const rawBase64 = inputImage!.replace(/^data:image\/[a-z]+;base64,/, '');
  const animSize = body.width ?? 64;

  const prefix = ACTION_PROMPT_PREFIX[action!] ?? '';
  const userMotion = motionPrompt?.trim() ?? '';
  const prompt =
    action === 'custom_action'
      ? userMotion || 'smooth animation'
      : [prefix, userMotion].filter(Boolean).join(', ');

  const promptStyle = ACTION_STYLE_MAP[action!] ?? FALLBACK_STYLE;

  return {
    prompt,
    width: animSize,
    height: animSize,
    num_images: 1,
    prompt_style: promptStyle,
    frames_duration: duration,
    return_spritesheet: true,
    input_image: rawBase64,
  };
}
