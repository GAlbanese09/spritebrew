// SSE-streaming API route for sprite generation.
//
// Cloudflare Pages has a 120-second proxy read timeout. If no data flows for
// 120s, the proxy kills the connection and returns 524. Since Retro Diffusion
// and Replicate can take 60-120+ seconds, we immediately return a streaming
// SSE response and send heartbeat comments every 15 seconds to keep the
// connection alive. The actual result is sent as an SSE data event when ready.
//
// Authentication: Clerk session JWT in the Authorization Bearer header.

export const runtime = 'edge';

// ── JWT helpers ──

interface ClerkJwtPayload {
  sub?: string;
  exp?: number;
  iss?: string;
  [key: string]: unknown;
}

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
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
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Please sign in to generate sprite sheets.' };
  }
  const token = authHeader.slice(7).trim();
  if (!token || token === 'null' || token === 'undefined') {
    return { error: 'Invalid session. Please sign in again.' };
  }
  const payload = decodeJwtPayload(token);
  if (!payload || !payload.sub) {
    return { error: 'Invalid token. Please sign in again.' };
  }
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
    return { error: 'Your session expired. Please sign in again.' };
  }
  return { userId: payload.sub };
}

// ── Constants ──

const REPLICATE_API_URL =
  'https://api.replicate.com/v1/models/retro-diffusion/rd-animation/predictions';
const RD_DIRECT_API_URL = 'https://api.retrodiffusion.ai/v1/inferences';

const STYLE_CONSTRAINTS: Record<string, { width: number; height: number } | null> = {
  four_angle_walking: { width: 48, height: 48 },
  walking_and_idle: { width: 48, height: 48 },
  small_sprites: { width: 32, height: 32 },
  any_animation: { width: 64, height: 64 },
  '8_dir_rotation': { width: 80, height: 80 },
  vfx: null,
};
const VALID_BASE_STYLES = Object.keys(STYLE_CONSTRAINTS);

const VALID_ACTIONS = [
  'walking', 'idle', 'attack', 'jump', 'crouch', 'destroy', 'subtle_motion', 'custom_action',
];
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
  style?: string;
  width?: number;
  height?: number;
  referenceImage?: string;
  framesDuration?: number;
  mode?: 'create' | 'animate';
  inputImage?: string;
  action?: string;
  motionPrompt?: string;
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

/** Start a heartbeat interval that writes SSE comments to keep the stream alive. */
function startHeartbeat(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  intervalMs = 15_000
): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    try {
      await writer.write(sseComment('heartbeat'));
    } catch {
      // Writer closed — the clearInterval in the caller will clean up
    }
  }, intervalMs);
}

// ── POST handler ──

export async function POST(request: Request) {
  // ── Pre-flight checks (fast, no streaming needed) ──

  const authResult = getAuthedUserId(request);
  if ('error' in authResult) {
    return Response.json(
      { success: false, error: authResult.error },
      { status: 401 }
    );
  }
  void authResult.userId;

  const replicateToken = process.env.REPLICATE_API_TOKEN;
  if (!replicateToken) {
    return Response.json(
      { success: false, error: 'API not configured — contact the administrator.' },
      { status: 500 }
    );
  }

  let body: GenerateBody;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: 'Invalid request body.' },
      { status: 400 }
    );
  }

  const mode = body.mode ?? 'create';

  // ── Validate before streaming (return errors as plain JSON) ──

  if (mode === 'create') {
    const err = validateCreateBody(body);
    if (err) return Response.json({ success: false, error: err }, { status: 400 });
  } else {
    const err = validateAnimateBody(body);
    if (err) return Response.json({ success: false, error: err }, { status: 400 });
  }

  // ── Open SSE stream ──

  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();

  // Async IIFE runs the generation in the background AFTER we return the stream
  (async () => {
    const heartbeat = startHeartbeat(writer);
    try {
      await writer.write(sseEvent({ type: 'status', message: 'Starting generation...' }));

      let result: Record<string, unknown>;
      if (mode === 'animate') {
        result = await runAnimate(body);
      } else {
        result = await runCreate(replicateToken, body);
      }

      await writer.write(sseEvent({ type: 'result', data: result }));
    } catch (err) {
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

// ── Validation helpers ──

function validateCreateBody(body: GenerateBody): string | null {
  const { prompt, style, width, height } = body;
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) return 'Prompt is required.';
  if (!style || !VALID_BASE_STYLES.includes(style))
    return `Invalid style. Must be one of: ${VALID_BASE_STYLES.join(', ')}`;
  const constraint = STYLE_CONSTRAINTS[style];
  if (constraint && (width !== constraint.width || height !== constraint.height))
    return `Style "${style}" requires ${constraint.width}x${constraint.height} dimensions.`;
  if (style === 'vfx' && (width !== height || !width || width < 24 || width > 96))
    return 'VFX style requires square dimensions between 24 and 96.';
  return null;
}

function validateAnimateBody(body: GenerateBody): string | null {
  const { inputImage, action, width, height } = body;
  if (!inputImage) return 'An input image is required for animation. Please upload a character first.';
  if (!action || !VALID_ACTIONS.includes(action))
    return `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`;
  if (width !== 64 || height !== 64)
    return `Animate My Character currently supports 64x64 images only. Your image is ${width}x${height}.`;
  return null;
}

// ── Generation runners (return the result payload, throw on errors) ──

async function runCreate(
  replicateToken: string,
  body: GenerateBody
): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {
    prompt: body.prompt!.trim(),
    style: body.style,
    width: body.width,
    height: body.height,
    return_spritesheet: true,
  };
  if (body.referenceImage) input.input_image = body.referenceImage;
  if (body.framesDuration) input.frames_duration = body.framesDuration;

  // Replicate with Prefer: wait
  const createRes = await fetch(REPLICATE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${replicateToken}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    body: JSON.stringify({ input }),
  });

  if (!createRes.ok) {
    const errBody = await createRes.text().catch(() => 'Unknown');
    throw new Error(`Replicate error (${createRes.status}): ${errBody.slice(0, 300)}`);
  }

  const prediction = await createRes.json();

  if (prediction.status === 'succeeded' && prediction.output) {
    const imageUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    return { success: true, imageUrl, prediction };
  }

  if (prediction.status === 'failed') {
    throw new Error(prediction.error || 'Generation failed — try a different prompt.');
  }

  // Poll
  const predictionId = prediction.id;
  if (!predictionId) throw new Error('Invalid Replicate response — no prediction ID.');

  const pollUrl = `https://api.replicate.com/v1/predictions/${predictionId}`;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${replicateToken}` },
    });
    if (!pollRes.ok) continue;
    const pollData = await pollRes.json();
    if (pollData.status === 'succeeded' && pollData.output) {
      const imageUrl = Array.isArray(pollData.output) ? pollData.output[0] : pollData.output;
      return { success: true, imageUrl, prediction: pollData };
    }
    if (pollData.status === 'failed') throw new Error(pollData.error || 'Generation failed.');
    if (pollData.status === 'canceled') throw new Error('Generation was canceled.');
  }

  throw new Error('Generation is taking longer than expected — please try again.');
}

async function runAnimate(body: GenerateBody): Promise<Record<string, unknown>> {
  const rdToken = process.env.RETRO_DIFFUSION_API_KEY;
  if (!rdToken) throw new Error('Retro Diffusion API key not configured.');

  const { inputImage, action, framesDuration, motionPrompt } = body;
  const duration =
    framesDuration && VALID_FRAME_DURATIONS.includes(framesDuration) ? framesDuration : 4;
  const rawBase64 = inputImage!.replace(/^data:image\/[a-z]+;base64,/, '');

  const prefix = ACTION_PROMPT_PREFIX[action!] ?? '';
  const userMotion = motionPrompt?.trim() ?? '';
  const prompt =
    action === 'custom_action'
      ? userMotion || 'smooth animation'
      : [prefix, userMotion].filter(Boolean).join(', ');

  const promptStyle = ACTION_STYLE_MAP[action!] ?? FALLBACK_STYLE;

  const rdPayload: Record<string, unknown> = {
    prompt,
    width: 64,
    height: 64,
    num_images: 1,
    prompt_style: promptStyle,
    frames_duration: duration,
    return_spritesheet: true,
    input_image: rawBase64,
  };

  let rdRes = await fetch(RD_DIRECT_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-RD-Token': rdToken },
    body: JSON.stringify(rdPayload),
  });

  // Fallback to animation__any_animation if advanced style fails
  if (!rdRes.ok && promptStyle !== FALLBACK_STYLE) {
    rdPayload.prompt_style = FALLBACK_STYLE;
    delete rdPayload.frames_duration;
    rdRes = await fetch(RD_DIRECT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-RD-Token': rdToken },
      body: JSON.stringify(rdPayload),
    });
  }

  if (!rdRes.ok) {
    const errBody = await rdRes.text().catch(() => 'Unknown');
    throw new Error(`Retro Diffusion error (${rdRes.status}): ${errBody.slice(0, 300)}`);
  }

  const rdData = await rdRes.json();
  if (!rdData.base64_images || rdData.base64_images.length === 0) {
    throw new Error('Generation completed but no image was returned.');
  }

  const imageDataUrl = `data:image/png;base64,${rdData.base64_images[0]}`;
  return {
    success: true,
    imageUrl: imageDataUrl,
    prediction: {
      status: 'succeeded',
      cost: rdData.balance_cost,
      remaining_balance: rdData.remaining_balance,
    },
  };
}
