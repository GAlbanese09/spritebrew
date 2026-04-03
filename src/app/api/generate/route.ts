export const runtime = 'edge';

const REPLICATE_API_URL =
  'https://api.replicate.com/v1/models/retro-diffusion/rd-animation/predictions';

// Style constraints: each style locks to specific dimensions
const STYLE_CONSTRAINTS: Record<string, { width: number; height: number } | null> = {
  four_angle_walking: { width: 48, height: 48 },
  walking_and_idle: { width: 48, height: 48 },
  small_sprites: { width: 32, height: 32 },
  any_animation: { width: 64, height: 64 },
  '8_dir_rotation': { width: 80, height: 80 },
  vfx: null, // 24-96, square only
};

const VALID_STYLES = Object.keys(STYLE_CONSTRAINTS);

interface GenerateBody {
  prompt: string;
  style: string;
  width: number;
  height: number;
  referenceImage?: string;
  framesDuration?: number;
}

export async function POST(request: Request) {
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

  const { prompt, style, width, height, referenceImage, framesDuration } = body;

  // Validate required fields
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return Response.json(
      { success: false, error: 'Prompt is required.' },
      { status: 400 }
    );
  }

  if (!style || !VALID_STYLES.includes(style)) {
    return Response.json(
      { success: false, error: `Invalid style. Must be one of: ${VALID_STYLES.join(', ')}` },
      { status: 400 }
    );
  }

  // Validate dimensions against style constraints
  const constraint = STYLE_CONSTRAINTS[style];
  if (constraint) {
    if (width !== constraint.width || height !== constraint.height) {
      return Response.json(
        { success: false, error: `Style "${style}" requires ${constraint.width}x${constraint.height} dimensions.` },
        { status: 400 }
      );
    }
  } else if (style === 'vfx') {
    if (width !== height || width < 24 || width > 96) {
      return Response.json(
        { success: false, error: 'VFX style requires square dimensions between 24 and 96.' },
        { status: 400 }
      );
    }
  }

  // Build Replicate input
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

  try {
    // POST with Prefer: wait for sync response (up to 60s)
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

    // If sync completed, output is ready
    if (prediction.status === 'succeeded' && prediction.output) {
      const imageUrl = Array.isArray(prediction.output)
        ? prediction.output[0]
        : prediction.output;
      return Response.json({ success: true, imageUrl, prediction });
    }

    // If failed immediately
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
        const imageUrl = Array.isArray(pollData.output)
          ? pollData.output[0]
          : pollData.output;
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
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json(
      { success: false, error: `Connection failed — ${message}` },
      { status: 500 }
    );
  }
}
