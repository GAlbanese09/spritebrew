// SSE-streaming API route for sprite generation.
//
// Both Create New and Animate My Character now use the Retro Diffusion direct
// API. Replicate has been fully removed. SSE streaming with 15-second heartbeat
// pings keeps the Cloudflare proxy alive during long generations.
//
// Authentication: Clerk session JWT in the Authorization Bearer header.

export const runtime = 'edge';

// ── JWT helpers ──

interface ClerkJwtPayload {
  sub?: string;
  exp?: number;
  [key: string]: unknown;
}

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
}

function decodeJwtPayload(token: string): ClerkJwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(base64UrlDecode(parts[1])) as ClerkJwtPayload;
  } catch {
    return null;
  }
}

function getAuthedUserId(request: Request): { userId: string } | { error: string } {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return { error: 'Please sign in to generate sprite sheets.' };
  const token = authHeader.slice(7).trim();
  if (!token || token === 'null' || token === 'undefined') return { error: 'Invalid session. Please sign in again.' };
  const payload = decodeJwtPayload(token);
  if (!payload?.sub) return { error: 'Invalid token. Please sign in again.' };
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return { error: 'Your session expired. Please sign in again.' };
  return { userId: payload.sub };
}

// ── Constants ──

const RD_API_URL = 'https://api.retrodiffusion.ai/v1/inferences';

// Animate My Character: action → rd_advanced_animation__* prompt_style
const VALID_ACTIONS = ['walking', 'idle', 'attack', 'jump', 'crouch', 'destroy', 'subtle_motion', 'custom_action'];
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

// RD API parameter name for reference images.
// Wrapped in a constant per recon recommendation — if RD ever renames this,
// change one line instead of hunting through the route.
const RD_REFERENCE_IMAGES_PARAM = 'reference_images';
const RD_MAX_REFERENCE_IMAGES = 9;
// 12MB ceiling on total reference payload, expressed in base64 string length
// (base64 inflates raw bytes by ~4/3, so 12MB raw ≈ 16MB base64 chars).
const REF_TOTAL_BASE64_BUDGET = 12 * 1024 * 1024 * 4 / 3;

export interface GenerateBody {
  prompt?: string;
  // Create New fields
  promptStyle?: string;   // the RD prompt_style value from the style registry
  style?: string;         // legacy field name (alias for promptStyle)
  width?: number;
  height?: number;
  removeBg?: boolean;
  /** Optional base64-encoded reference images (no `data:` prefix). Max 9.
   *  Only honoured for rd_pro__* styles per RD's API. */
  referenceImages?: string[];
  // Animate My Character fields
  mode?: 'create' | 'animate';
  inputImage?: string;
  action?: string;
  motionPrompt?: string;
  framesDuration?: number;
  /** Client-supplied UUID for the queue-kickoff path (Build #2A).
   *  Required only when QUEUE_KICKOFF_ENABLED is on for this user. */
  idempotencyKey?: string;
}

// ── SSE helpers ──

const encoder = new TextEncoder();
function sseEvent(data: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}
function sseComment(text: string): Uint8Array {
  return encoder.encode(`: ${text}\n\n`);
}
function sseDone(): Uint8Array {
  return encoder.encode('data: [DONE]\n\n');
}
function startHeartbeat(writer: WritableStreamDefaultWriter<Uint8Array>, ms = 15_000) {
  return setInterval(async () => {
    try { await writer.write(sseComment('heartbeat')); } catch { /* closed */ }
  }, ms);
}

// ── POST handler ──

import {
  debitTokens,
  creditTokens,
  getLifetimeFreeCount,
  incrementLifetimeFreeCount,
  hasUserPaid,
  type FreeTierBucket,
} from '@/lib/tokenBalance';
import { getTokenCost, getResolutionMode, getFreeTierBucket, GENERATION_STYLES } from '@/lib/styleRegistry';
import { getAccountStatus } from '@/lib/accountLock';
import { isAdminUser } from '@/lib/generationLimits';
import { isQueueKickoffEnabled } from '@/lib/featureFlag';
import { deriveJobId } from '@/lib/jobIdHelper';
import { enqueueJob } from '@/lib/queueProducer';
import { buildRdCreateBody, buildRdAnimateBody } from '@/lib/rdBodyBuilder';
import {
  FREE_TIER_LIFETIME_PRO_CAP,
  FREE_TIER_LIFETIME_FAST_CAP,
} from '@/lib/constants';

const FREE_TIER_CAP: Record<FreeTierBucket, number> = {
  pro: FREE_TIER_LIFETIME_PRO_CAP,
  fast: FREE_TIER_LIFETIME_FAST_CAP,
};


export async function POST(request: Request) {
  const authResult = getAuthedUserId(request);
  if ('error' in authResult) {
    return Response.json({ success: false, error: authResult.error }, { status: 401 });
  }
  const userId = authResult.userId;

  // Account lock check
  const accountStatus = await getAccountStatus(userId);
  if (accountStatus === 'refund_locked') {
    return Response.json(
      { success: false, error: 'Your account is temporarily locked because a recent refund resulted in a negative token balance. Contact support@spritebrew.com to resolve.' },
      { status: 403 }
    );
  }
  if (accountStatus === 'disputed') {
    return Response.json(
      { success: false, error: 'This account has been permanently closed due to a chargeback. If you believe this is an error, contact support@spritebrew.com.' },
      { status: 403 }
    );
  }

  let body: GenerateBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const mode = body.mode ?? 'create';

  // Validate before streaming (fast errors as plain JSON)
  if (mode === 'create') {
    const err = validateCreateBody(body);
    if (err) return Response.json({ success: false, error: err }, { status: 400 });
  } else {
    const err = validateAnimateBody(body);
    if (err) return Response.json({ success: false, error: err }, { status: 400 });
  }

  // Determine the prompt style and token cost
  let promptStyle: string;
  if (mode === 'animate') {
    promptStyle = ACTION_STYLE_MAP[body.action!] ?? FALLBACK_STYLE;
  } else {
    promptStyle = body.promptStyle ?? body.style ?? '';
  }
  const tokenCost = getTokenCost(promptStyle);
  const bucket: FreeTierBucket = getFreeTierBucket(promptStyle);
  const isAdmin = isAdminUser(userId);

  // (S16: email-verify earn-back removed — bots pass OTP trivially. Engagement
  // rewards now live in the daily-login + email-list flows. We keep the
  // bonus_email_verified:* and email_verified_cache:* KV keys untouched for
  // historical analytics; nothing here writes to them anymore.)

  // Free-tier lifetime cap enforcement — only for users who haven't paid.
  // Admins are exempt. Plus / Pro / Animation roll up under the `pro` bucket;
  // Fast has its own counter.
  if (!isAdmin) {
    const paid = await hasUserPaid(userId);
    if (!paid) {
      const used = await getLifetimeFreeCount(userId, bucket);
      if (used >= FREE_TIER_CAP[bucket]) {
        return Response.json(
          {
            success: false,
            error: 'free_tier_cap_reached',
            code: 'free_tier_cap_reached',
            message: `You've used all free generations for this style tier. Top up to continue.`,
            tier: bucket,
          },
          { status: 402 }
        );
      }
    }
  }

  // Generate a unique idempotency key for this request
  const requestId = `gen:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  // Debit tokens before generation
  const debitResult = await debitTokens(userId, tokenCost, requestId);
  if (!debitResult.success) {
    return Response.json(
      {
        success: false,
        error: 'Insufficient tokens',
        balance: debitResult.balance,
        required: debitResult.required,
      },
      { status: 402 }
    );
  }

  // Free-tier lifetime counter — increment after successful debit, before the
  // (potentially long) generation. A failed-and-refunded gen still counts as
  // one free attempt; that's intentional to keep cap enforcement tight.
  if (!isAdmin) {
    try {
      const paid = await hasUserPaid(userId);
      if (!paid) {
        await incrementLifetimeFreeCount(userId, bucket);
      }
    } catch { /* best effort */ }
  }

  // === QUEUE-KICKOFF FEATURE FLAG (Confluence 87490562 §14) ===
  // When enabled for this user, return 202 {jobId} after enqueueing instead
  // of opening the SSE stream. The consumer Worker (sibling repo) handles
  // the long-running RD call out-of-band; browser polls /api/generation-status.
  //
  // Day-1 rollout: env var stays 'false', admin auto-included via isAdminUser.
  // When flag is OFF, behavior below is byte-identical to pre-refactor.
  if (isQueueKickoffEnabled(userId, process.env as Record<string, unknown>)) {
    // Client must supply idempotencyKey for this path.
    const idempotencyKey = body.idempotencyKey;
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
      return new Response(
        JSON.stringify({ error: 'idempotencyKey required for queue-kickoff path' }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }

    const jobId = await deriveJobId(userId, idempotencyKey);
    const env = process.env as Record<string, unknown>;
    const kv = env.SPRITEBREW_KV as {
      get: (k: string) => Promise<string | null>;
      put: (k: string, v: string, opts?: unknown) => Promise<void>;
    };

    // Request-side idempotency: same jobId already exists → return it without re-enqueue.
    const existing = await kv.get(`job:${jobId}`);
    if (existing) {
      return new Response(
        JSON.stringify({ jobId, replayed: true }),
        { status: 202, headers: { 'content-type': 'application/json' } }
      );
    }

    const now = Date.now();
    await kv.put(
      `job:${jobId}`,
      JSON.stringify({
        status: 'pending',
        userId,
        mode,
        enqueuedAt: now,
      }),
      { expirationTtl: 3600 }
    );

    // Translate camelCase request body → snake_case RD wire format BEFORE
    // enqueueing. The consumer forwards body verbatim to RD, so the producer
    // must hand it the exact RD shape (Build #2A.1). Mirrors runCreate/runAnimate.
    const rdBody = mode === 'animate'
      ? buildRdAnimateBody(body)
      : buildRdCreateBody(body);

    await enqueueJob(env.RD_QUEUE, {
      jobId,
      userId,
      idempotencyKey,
      tokenCost,
      mode,
      body: rdBody,
      enqueuedAt: now,
    });

    return new Response(
      JSON.stringify({ jobId }),
      { status: 202, headers: { 'content-type': 'application/json' } }
    );
  }
  // === END QUEUE-KICKOFF GATE ===

  // Open SSE stream
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();

  (async () => {
    const heartbeat = startHeartbeat(writer);
    try {
      await writer.write(sseEvent({ type: 'status', message: 'Starting generation...' }));
      const result = mode === 'animate' ? await runAnimate(body) : await runCreate(body);
      await writer.write(sseEvent({ type: 'result', data: result }));
    } catch (err) {
      // RD API failure — refund the tokens
      const refundKey = `refund:${requestId}`;
      await creditTokens(userId, tokenCost, 'generation_failed_refund', refundKey);
      const message = err instanceof Error ? err.message : 'Unknown error';
      await writer.write(sseEvent({ type: 'error', message })).catch(() => {});
    } finally {
      clearInterval(heartbeat);
      await writer.write(sseDone()).catch(() => {});
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

// ── Validation ──

function validateCreateBody(body: GenerateBody): string | null {
  if (!body.prompt?.trim()) return 'Prompt is required.';
  const ps = body.promptStyle ?? body.style;
  if (!ps) return 'Style is required.';

  // If the picked style has explicit resolutionMode metadata (animation styles),
  // enforce it. Other styles fall back to existing client-side minSize/maxSize clamping.
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

  // Reference images — only valid for styles flagged supportsReferenceImages.
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

function validateAnimateBody(body: GenerateBody): string | null {
  if (!body.inputImage) return 'An input image is required for animation. Please upload a character first.';
  if (!body.action || !VALID_ACTIONS.includes(body.action))
    return `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`;
  const w = body.width ?? 64;
  const h = body.height ?? 64;
  if (w !== h) return `Animation requires square dimensions. Got ${w}x${h}.`;

  // Validate against the action's prompt style resolution mode
  const promptStyle = ACTION_STYLE_MAP[body.action] ?? FALLBACK_STYLE;
  const mode = getResolutionMode(promptStyle);
  if (mode) {
    if (mode.kind === 'locked') {
      if (w !== mode.size) {
        return `This style is locked at ${mode.size}x${mode.size}. Got ${w}x${h}.`;
      }
    } else {
      if (w < mode.min || w > mode.max) {
        return `Resolution must be between ${mode.min} and ${mode.max} for this style. Got ${w}.`;
      }
      if (mode.kind === 'variable_special' && !mode.presets.includes(w)) {
        return `Resolution must be one of: ${mode.presets.join(', ')}. Got ${w}.`;
      }
    }
  }
  return null;
}

// ── Runners ──

async function callRD(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const rdToken = process.env.RETRO_DIFFUSION_API_KEY;
  if (!rdToken) throw new Error('Retro Diffusion API key not configured — contact the administrator.');

  const res = await fetch(RD_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-RD-Token': rdToken },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => 'Unknown');
    throw new Error(`Retro Diffusion error (${res.status}): ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data.base64_images?.length) {
    throw new Error('Generation completed but no image was returned.');
  }

  return {
    success: true,
    imageUrl: `data:image/png;base64,${data.base64_images[0]}`,
    prediction: {
      status: 'succeeded',
      cost: data.balance_cost,
      remaining_balance: data.remaining_balance,
    },
  };
}

/** Create New — text-to-sprite via RD direct API. */
async function runCreate(body: GenerateBody): Promise<Record<string, unknown>> {
  const promptStyle = body.promptStyle ?? body.style;
  const isAnimation = promptStyle?.startsWith('animation__');

  const payload: Record<string, unknown> = {
    prompt: body.prompt!.trim(),
    prompt_style: promptStyle,
    width: body.width,
    height: body.height,
    num_images: 1,
  };

  if (body.removeBg) payload.remove_bg = true;
  if (isAnimation) payload.return_spritesheet = true;

  // Forward reference images only when present — keeps non-reference calls
  // unchanged on the RD side.
  if (body.referenceImages && body.referenceImages.length > 0) {
    payload[RD_REFERENCE_IMAGES_PARAM] = body.referenceImages;
  }

  return callRD(payload);
}

/** Animate My Character — advanced animation via RD direct API. */
async function runAnimate(body: GenerateBody): Promise<Record<string, unknown>> {
  const { inputImage, action, framesDuration, motionPrompt } = body;
  const duration = framesDuration && VALID_FRAME_DURATIONS.includes(framesDuration) ? framesDuration : 4;
  const rawBase64 = inputImage!.replace(/^data:image\/[a-z]+;base64,/, '');
  const animSize = body.width ?? 64;

  const prefix = ACTION_PROMPT_PREFIX[action!] ?? '';
  const userMotion = motionPrompt?.trim() ?? '';
  const prompt = action === 'custom_action'
    ? (userMotion || 'smooth animation')
    : [prefix, userMotion].filter(Boolean).join(', ');

  const promptStyle = ACTION_STYLE_MAP[action!] ?? FALLBACK_STYLE;

  const payload: Record<string, unknown> = {
    prompt, width: animSize, height: animSize, num_images: 1,
    prompt_style: promptStyle, frames_duration: duration,
    return_spritesheet: true, input_image: rawBase64,
  };

  try {
    return await callRD(payload);
  } catch {
    // Fallback to animation__any_animation if advanced style fails
    if (promptStyle !== FALLBACK_STYLE) {
      payload.prompt_style = FALLBACK_STYLE;
      delete payload.frames_duration;
      return callRD(payload);
    }
    throw new Error('Animation generation failed.');
  }
}
