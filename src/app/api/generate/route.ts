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

interface GenerateBody {
  prompt?: string;
  // Create New fields
  promptStyle?: string;   // the RD prompt_style value from the style registry
  style?: string;         // legacy field name (alias for promptStyle)
  width?: number;
  height?: number;
  removeBg?: boolean;
  referenceImage?: string;
  // Animate My Character fields
  mode?: 'create' | 'animate';
  inputImage?: string;
  action?: string;
  motionPrompt?: string;
  framesDuration?: number;
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

import { debitTokens, creditTokens } from '@/lib/tokenBalance';
import { getTokenCost } from '@/lib/styleRegistry';
import { getAccountStatus } from '@/lib/accountLock';

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
      { success: false, error: 'Your account is temporarily locked because a recent refund resulted in a negative token balance. Contact george@spritebrew.com to resolve.' },
      { status: 403 }
    );
  }
  if (accountStatus === 'disputed') {
    return Response.json(
      { success: false, error: 'This account has been permanently closed due to a chargeback. If you believe this is an error, contact george@spritebrew.com.' },
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
  return null;
}

function validateAnimateBody(body: GenerateBody): string | null {
  if (!body.inputImage) return 'An input image is required for animation. Please upload a character first.';
  if (!body.action || !VALID_ACTIONS.includes(body.action))
    return `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`;
  const w = body.width ?? 64;
  const h = body.height ?? 64;
  if (w !== h) return `Animation requires square dimensions. Got ${w}x${h}.`;
  if (w < 32 || w > 256) return `Animation resolution must be between 32 and 256. Got ${w}.`;
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
