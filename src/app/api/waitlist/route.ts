export const runtime = 'edge';

// Minimal KV interface — the binding is injected as an object on process.env
// by Cloudflare Pages, NOT via getCloudflareContext.
interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getKV(): KV | null {
  const kv = (process.env as Record<string, unknown>).SPRITEBREW_KV;
  if (kv && typeof (kv as KV).put === 'function') return kv as KV;
  return null;
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

  const kv = getKV();

  if (kv) {
    try {
      const key = `waitlist:${email}`;
      const existing = await kv.get(key);
      if (!existing) {
        await kv.put(key, JSON.stringify({ email, joinedAt: timestamp, source: 'landing-page' }));

        // Append to master list for easy export
        const allRaw = await kv.get('waitlist:__all_emails');
        const all: string[] = allRaw ? JSON.parse(allRaw) : [];
        if (!all.includes(email)) {
          all.push(email);
          await kv.put('waitlist:__all_emails', JSON.stringify(all));
        }
      }
      return Response.json({ success: true, stored: 'kv' });
    } catch {
      // KV write failed — fall through to fallback
    }
  }

  // Fallback: log to Cloudflare's log stream
  // eslint-disable-next-line no-console
  console.log('[WAITLIST]', email, timestamp);
  return Response.json({ success: true, stored: 'fallback' });
}

// ── GET /api/waitlist — admin export (returns full email list) ──

export async function GET() {
  const kv = getKV();

  if (kv) {
    try {
      const allRaw = await kv.get('waitlist:__all_emails');
      const all: string[] = allRaw ? JSON.parse(allRaw) : [];
      return Response.json({ success: true, emails: all, count: all.length });
    } catch {
      // fall through
    }
  }

  return Response.json({
    success: true,
    emails: [],
    count: 0,
    note: 'KV binding not available.',
  });
}
