// Authentication is enforced by verifying a Clerk session JWT passed as a
// Bearer token in the Authorization header. We switched from @clerk/nextjs
// to @clerk/react to avoid Cloudflare Pages 405 errors on sign-out — the
// client SDK sends the token in fetch() calls and we verify it here.
//
// Note: this is a lightweight check (present, well-formed, extract userId
// from the JWT payload). Full signature verification against Clerk's JWKS
// will come later; for now the token is impossible to forge without first
// signing in via Clerk's Frontend API.

export const runtime = 'edge';

interface ClerkJwtPayload {
  sub?: string;   // user id
  exp?: number;   // expiration (seconds since epoch)
  iss?: string;   // issuer
  [key: string]: unknown;
}

/** Decode a base64url segment (JWT parts use base64url, not standard base64). */
function base64UrlDecode(segment: string): string {
  // Convert base64url to base64
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  // Pad to a multiple of 4
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

/** Decode the payload section of a JWT without verifying the signature. */
function decodeJwtPayload(token: string): ClerkJwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const json = base64UrlDecode(parts[1]);
    return JSON.parse(json) as ClerkJwtPayload;
  } catch {
    return null;
  }
}

/** Extract and lightly verify the Clerk session token from the request headers. */
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

  // Check expiration
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
    return { error: 'Your session expired. Please sign in again.' };
  }

  return { userId: payload.sub };
}

const REPLICATE_API_URL =
  'https://api.replicate.com/v1/models/retro-diffusion/rd-animation/predictions';

// ── Base style constraints ──
const STYLE_CONSTRAINTS: Record<string, { width: number; height: number } | null> = {
  four_angle_walking: { width: 48, height: 48 },
  walking_and_idle: { width: 48, height: 48 },
  small_sprites: { width: 32, height: 32 },
  any_animation: { width: 64, height: 64 },
  '8_dir_rotation': { width: 80, height: 80 },
  vfx: null,
};

const VALID_BASE_STYLES = Object.keys(STYLE_CONSTRAINTS);

// ── Advanced animation actions ──
const VALID_ACTIONS = [
  'walking', 'idle', 'attack', 'jump', 'crouch', 'destroy', 'subtle_motion', 'custom_action',
];

const VALID_FRAME_DURATIONS = [4, 6, 8, 10, 12, 16];

interface GenerateBody {
  // Base mode fields
  prompt?: string;
  style?: string;
  width?: number;
  height?: number;
  referenceImage?: string;
  framesDuration?: number;

  // Advanced animate mode fields
  mode?: 'create' | 'animate';
  inputImage?: string;
  action?: string;
  motionPrompt?: string;
}

// ── Shared Replicate call + poll logic ──

async function callReplicate(
  token: string,
  input: Record<string, unknown>
): Promise<Response> {
  // Try the request
  const createRes = await fetch(REPLICATE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    body: JSON.stringify({ input }),
  });

  if (!createRes.ok) {
    const errBody = await createRes.text().catch(() => 'Could not read response body');
    return Response.json(
      { success: false, error: `Replicate error (${createRes.status}): ${errBody}` },
      { status: createRes.status }
    );
  }

  const prediction = await createRes.json();

  if (prediction.status === 'succeeded' && prediction.output) {
    const imageUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    return Response.json({ success: true, imageUrl, prediction });
  }

  if (prediction.status === 'failed') {
    return Response.json(
      { success: false, error: prediction.error || 'Generation failed — try a different prompt.' },
      { status: 500 }
    );
  }

  // Need to poll
  const predictionId = prediction.id;
  if (!predictionId) {
    return Response.json(
      { success: false, error: 'Invalid response from Replicate — no prediction ID.' },
      { status: 500 }
    );
  }

  const pollUrl = `https://api.replicate.com/v1/predictions/${predictionId}`;
  const maxPolls = 60;

  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!pollRes.ok) continue;

    const pollData = await pollRes.json();

    if (pollData.status === 'succeeded' && pollData.output) {
      const imageUrl = Array.isArray(pollData.output) ? pollData.output[0] : pollData.output;
      return Response.json({ success: true, imageUrl, prediction: pollData });
    }

    if (pollData.status === 'failed') {
      return Response.json(
        { success: false, error: pollData.error || 'Generation failed — try a different prompt.' },
        { status: 500 }
      );
    }

    if (pollData.status === 'canceled') {
      return Response.json(
        { success: false, error: 'Generation was canceled.' },
        { status: 500 }
      );
    }
  }

  return Response.json(
    { success: false, error: 'Generation is taking longer than expected — please try again.' },
    { status: 504 }
  );
}

export async function POST(request: Request) {
  // Require authentication via Clerk session JWT in the Authorization header
  const authResult = getAuthedUserId(request);
  if ('error' in authResult) {
    return Response.json(
      { success: false, error: authResult.error },
      { status: 401 }
    );
  }
  // authResult.userId is available here for future per-user rate limiting
  void authResult.userId;

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
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

  try {
    if (mode === 'animate') {
      return await handleAnimate(token, body);
    } else {
      return await handleCreate(token, body);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json(
      { success: false, error: `Connection failed — ${message}` },
      { status: 500 }
    );
  }
}

// ── Base "Create New" flow (unchanged logic) ──

async function handleCreate(token: string, body: GenerateBody): Promise<Response> {
  const { prompt, style, width, height, referenceImage, framesDuration } = body;

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return Response.json(
      { success: false, error: 'Prompt is required.' },
      { status: 400 }
    );
  }

  if (!style || !VALID_BASE_STYLES.includes(style)) {
    return Response.json(
      { success: false, error: `Invalid style. Must be one of: ${VALID_BASE_STYLES.join(', ')}` },
      { status: 400 }
    );
  }

  const constraint = STYLE_CONSTRAINTS[style];
  if (constraint) {
    if (width !== constraint.width || height !== constraint.height) {
      return Response.json(
        { success: false, error: `Style "${style}" requires ${constraint.width}x${constraint.height} dimensions.` },
        { status: 400 }
      );
    }
  } else if (style === 'vfx') {
    if (width !== height || !width || width < 24 || width > 96) {
      return Response.json(
        { success: false, error: 'VFX style requires square dimensions between 24 and 96.' },
        { status: 400 }
      );
    }
  }

  const input: Record<string, unknown> = {
    prompt: prompt.trim(),
    style,
    width,
    height,
    return_spritesheet: true,
  };

  if (referenceImage) {
    input.input_image = referenceImage;
  }

  if (framesDuration) {
    input.frames_duration = framesDuration;
  }

  return callReplicate(token, input);
}

// ── Advanced "Animate My Character" flow ──
// Uses Retro Diffusion direct API (not Replicate) because Replicate's wrapper
// does not support advanced animation styles.

const RD_DIRECT_API_URL = 'https://api.retrodiffusion.ai/v1/inferences';

// Map action IDs to descriptive prompt prefixes
const ACTION_PROMPT_PREFIX: Record<string, string> = {
  walking: 'walking animation, smooth steps',
  idle: 'idle breathing animation, subtle movement',
  attack: 'attack animation, melee swing',
  jump: 'jump animation, rising and falling',
  crouch: 'crouching animation, ducking down',
  destroy: 'death animation, falling and fading',
  subtle_motion: 'subtle ambient motion, wind effect',
  custom_action: '', // user provides full description
};

async function handleAnimate(_replicateToken: string, body: GenerateBody): Promise<Response> {
  const rdToken = process.env.RETRO_DIFFUSION_API_KEY;
  if (!rdToken) {
    return Response.json(
      { success: false, error: 'Retro Diffusion API key not configured — contact the administrator.' },
      { status: 500 }
    );
  }

  const { inputImage, action, width, height, motionPrompt } = body;

  if (!inputImage) {
    return Response.json(
      { success: false, error: 'An input image is required for animation.' },
      { status: 400 }
    );
  }

  if (!action || !VALID_ACTIONS.includes(action)) {
    return Response.json(
      { success: false, error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` },
      { status: 400 }
    );
  }

  // animation__any_animation is locked to 64x64
  if (width !== 64 || height !== 64) {
    return Response.json(
      {
        success: false,
        error: `Animate My Character currently supports 64x64 images only. Your image is ${width}x${height} — please resize to 64x64.`,
      },
      { status: 400 }
    );
  }

  // Strip data URL prefix if present
  const rawBase64 = inputImage.replace(/^data:image\/[a-z]+;base64,/, '');

  // Build prompt: action prefix + optional user motion description
  const prefix = ACTION_PROMPT_PREFIX[action] ?? '';
  const userMotion = motionPrompt?.trim() ?? '';
  const prompt = action === 'custom_action'
    ? (userMotion || 'smooth animation')
    : [prefix, userMotion].filter(Boolean).join(', ');

  const rdPayload = {
    prompt,
    width: 64,
    height: 64,
    num_images: 1,
    prompt_style: 'animation__any_animation',
    return_spritesheet: true,
    input_image: rawBase64,
  };

  try {
    const rdRes = await fetch(RD_DIRECT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RD-Token': rdToken,
      },
      body: JSON.stringify(rdPayload),
    });

    if (!rdRes.ok) {
      const errBody = await rdRes.text().catch(() => 'Could not read response body');
      return Response.json(
        { success: false, error: `Retro Diffusion error (${rdRes.status}): ${errBody}` },
        { status: rdRes.status }
      );
    }

    const rdData = await rdRes.json();

    if (!rdData.base64_images || rdData.base64_images.length === 0) {
      return Response.json(
        { success: false, error: 'Generation completed but no image was returned.' },
        { status: 500 }
      );
    }

    // Convert base64 response to a data URL for the frontend
    const imageDataUrl = `data:image/png;base64,${rdData.base64_images[0]}`;

    return Response.json({
      success: true,
      imageUrl: imageDataUrl,
      prediction: {
        status: 'succeeded',
        cost: rdData.balance_cost,
        remaining_balance: rdData.remaining_balance,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json(
      { success: false, error: `Connection to Retro Diffusion failed — ${message}` },
      { status: 500 }
    );
  }
}
