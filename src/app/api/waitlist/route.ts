export const runtime = 'edge';

// Minimal KV interface — avoids requiring @cloudflare/workers-types
interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Try multiple ways to get the KV binding ──

async function getKV(): Promise<{ kv: KV | null; debug: Record<string, unknown> }> {
  const debug: Record<string, unknown> = {};

  // Attempt 1: OpenNext's getCloudflareContext
  try {
    const mod = await import('@opennextjs/cloudflare');
    const ctx = await mod.getCloudflareContext({ async: true });
    debug.opennext = {
      contextKeys: Object.keys(ctx || {}),
      envKeys: Object.keys((ctx as Record<string, unknown>)?.env || {}),
      envType: typeof (ctx as Record<string, unknown>)?.env,
      hasKV: !!(ctx?.env as Record<string, unknown>)?.SPRITEBREW_KV,
    };
    const kv = (ctx?.env as Record<string, unknown>)?.SPRITEBREW_KV as KV | undefined;
    if (kv) return { kv, debug };
  } catch (e) {
    debug.opennextError = (e as Error).message;
  }

  // Attempt 2: process.env (won't work for KV bindings but log what's there)
  try {
    debug.processEnvKV = typeof process.env.SPRITEBREW_KV;
    debug.processEnvKeys = Object.keys(process.env).filter(
      (k) => k.includes('KV') || k.includes('SPRITE') || k.includes('CLOUDFLARE')
    );
  } catch {
    debug.processEnvError = 'not available';
  }

  // Attempt 3: globalThis
  try {
    const g = globalThis as Record<string, unknown>;
    debug.globalThisKV = typeof g.SPRITEBREW_KV;
    if (g.SPRITEBREW_KV) return { kv: g.SPRITEBREW_KV as KV, debug };
  } catch {
    debug.globalThisError = 'not available';
  }

  return { kv: null, debug };
}

// ── POST /api/waitlist — collect a waitlist email ──

export async function POST(request: Request) {
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid request.' }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return Response.json(
      { success: false, error: 'Please enter a valid email address.' },
      { status: 400 }
    );
  }

  const timestamp = new Date().toISOString();

  // eslint-disable-next-line no-console
  console.log('[WAITLIST]', email, timestamp);

  const { kv, debug } = await getKV();

  // eslint-disable-next-line no-console
  console.log('[WAITLIST DEBUG]', JSON.stringify(debug));

  if (kv) {
    try {
      const key = `waitlist:${email}`;
      const existing = await kv.get(key);
      if (!existing) {
        await kv.put(
          key,
          JSON.stringify({ email, joinedAt: timestamp, source: 'landing-page' })
        );

        const allRaw = await kv.get('waitlist:__all_emails');
        const all: string[] = allRaw ? JSON.parse(allRaw) : [];
        if (!all.includes(email)) {
          all.push(email);
          await kv.put('waitlist:__all_emails', JSON.stringify(all));
        }
      }

      // TEMPORARY: include debug info in response to diagnose KV binding
      return Response.json({ success: true, stored: 'kv', debug });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[WAITLIST] KV write error:', err);
    }
  }

  // TEMPORARY: include debug info in response to diagnose KV binding
  return Response.json({ success: true, stored: 'fallback', debug });
}

// ── GET /api/waitlist — admin export (returns full email list) ──

export async function GET() {
  const { kv, debug } = await getKV();

  if (kv) {
    try {
      const allRaw = await kv.get('waitlist:__all_emails');
      const all: string[] = allRaw ? JSON.parse(allRaw) : [];
      return Response.json({ success: true, emails: all, count: all.length, debug });
    } catch {
      // fall through
    }
  }

  return Response.json({
    success: true,
    emails: [],
    count: 0,
    note: 'KV binding not available.',
    debug,
  });
}
