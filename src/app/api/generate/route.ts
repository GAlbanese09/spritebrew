export const runtime = 'edge';

const REPLICATE_API_URL =
  'https://api.replicate.com/v1/models/retro-diffusion/rd-animation/predictions';

// ── Rate limiting ──
const RATE_LIMIT = 15;
const RATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory store — resets on every deploy. Move to Redis/KV for persistence.
const rateLimitMap = new Map<string, number[]>();

function getClientIp(request: Request): string {
  const headers = request.headers;
  return (
    headers.get('cf-connecting-ip') ??
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headers.get('x-real-ip') ??
    'unknown'
  );
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(ip) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
  rateLimitMap.set(ip, recent);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  return true;
}

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

  if (createRes.status === 429) {
    return Response.json(
      { success: false, error: 'Too many requests — please wait a moment and try again.' },
      { status: 429 }
    );
  }

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => 'Unknown error');
    return Response.json(
      { success: false, error: `Replicate API error (${createRes.status}): ${errText}` },
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
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return Response.json(
      { success: false, error: 'API not configured — contact the administrator.' },
      { status: 500 }
    );
  }

  const clientIp = getClientIp(request);
  if (!checkRateLimit(clientIp)) {
    return Response.json(
      {
        success: false,
        error: 'Rate limit exceeded. You can generate up to 10 sprite sheets per day. Try again tomorrow.',
      },
      { status: 429 }
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

async function handleAnimate(token: string, body: GenerateBody): Promise<Response> {
  const { inputImage, action, width, height, framesDuration, motionPrompt } = body;

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

  if (!width || !height || width < 32 || height < 32 || width > 256 || height > 256) {
    return Response.json(
      { success: false, error: 'Image dimensions must be between 32x32 and 256x256.' },
      { status: 400 }
    );
  }

  if (framesDuration && !VALID_FRAME_DURATIONS.includes(framesDuration)) {
    return Response.json(
      { success: false, error: `Frame count must be one of: ${VALID_FRAME_DURATIONS.join(', ')}` },
      { status: 400 }
    );
  }

  const advancedStyle = `rd_advanced_animation__${action}`;

  // Strip data URL prefix if present
  const rawBase64 = inputImage.replace(/^data:image\/[a-z]+;base64,/, '');

  const prompt = motionPrompt?.trim() || 'smooth animation';

  const input: Record<string, unknown> = {
    style: advancedStyle,
    input_image: rawBase64,
    width,
    height,
    frames_duration: framesDuration ?? 4,
    return_spritesheet: true,
    prompt,
  };

  // Try with `style` field first
  const result = await callReplicate(token, input);

  // If it failed due to invalid style, retry with prompt_style
  const resultData = await result.clone().json();
  if (
    !resultData.success &&
    typeof resultData.error === 'string' &&
    (resultData.error.includes('style') || resultData.error.includes('invalid'))
  ) {
    delete input.style;
    input.prompt_style = advancedStyle;
    return callReplicate(token, input);
  }

  return result;
}
