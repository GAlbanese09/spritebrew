export const runtime = 'edge';

import { getCloudflareContext } from '@opennextjs/cloudflare';

// Minimal KV interface — avoids requiring @cloudflare/workers-types
interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

// Extend the CloudflareEnv interface to include our KV binding
declare global {
  interface CloudflareEnv {
    SPRITEBREW_KV?: KV;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  // Always log so emails are captured in Cloudflare's log stream as a backup
  // eslint-disable-next-line no-console
  console.log('[WAITLIST]', email, timestamp);

  // Try to access the KV binding via OpenNext's Cloudflare context
  let kv: KV | undefined;
  try {
    const { env } = await getCloudflareContext({ async: true });
    kv = env.SPRITEBREW_KV;
  } catch {
    // getCloudflareContext throws in local dev (next dev) — fall back gracefully
  }

  // TODO: remove after confirming KV works in production
  // eslint-disable-next-line no-console
  console.log('[WAITLIST] KV binding found:', !!kv);

  if (kv) {
    try {
      // Store individual email entry
      const key = `waitlist:${email}`;
      const existing = await kv.get(key);
      if (!existing) {
        await kv.put(
          key,
          JSON.stringify({ email, joinedAt: timestamp, source: 'landing-page' })
        );

        // Append to master list for easy export
        const allRaw = await kv.get('waitlist:__all_emails');
        const all: string[] = allRaw ? JSON.parse(allRaw) : [];
        if (!all.includes(email)) {
          all.push(email);
          await kv.put('waitlist:__all_emails', JSON.stringify(all));
        }
      }

      return Response.json({ success: true, stored: 'kv' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[WAITLIST] KV write error:', err);
      // Fall through to fallback response
    }
  }

  return Response.json({ success: true, stored: 'fallback' });
}

// ── GET /api/waitlist — admin export (returns full email list) ──

export async function GET() {
  let kv: KV | undefined;
  try {
    const { env } = await getCloudflareContext({ async: true });
    kv = env.SPRITEBREW_KV;
  } catch {
    // local dev fallback
  }

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
    note: 'KV binding not available. Check Cloudflare Pages logs for [WAITLIST] entries.',
  });
}
