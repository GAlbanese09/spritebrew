export const runtime = 'edge';

// TODO: Wire up Cloudflare KV namespace once created via `wrangler kv:namespace create SPRITEBREW_KV`.
// For now emails are logged to console (visible in Cloudflare Pages logs).
// When KV is ready, bind it and uncomment the KV sections below.

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

  // Log to Cloudflare's log stream so we capture emails even without KV
  // eslint-disable-next-line no-console
  console.log('[WAITLIST]', email, timestamp);

  // TODO: When KV is bound, store per-email and append to master list:
  //
  // const env = (request as any).cf?.env ?? {};
  // const kv = env.SPRITEBREW_KV;
  // if (kv) {
  //   const key = `waitlist:${email}`;
  //   const existing = await kv.get(key);
  //   if (!existing) {
  //     await kv.put(key, JSON.stringify({ email, joinedAt: timestamp, source: 'landing-page' }));
  //     // Append to master list
  //     const allRaw = await kv.get('waitlist:__all_emails');
  //     const all: string[] = allRaw ? JSON.parse(allRaw) : [];
  //     if (!all.includes(email)) {
  //       all.push(email);
  //       await kv.put('waitlist:__all_emails', JSON.stringify(all));
  //     }
  //   }
  // }

  return Response.json({ success: true });
}

// ── GET /api/waitlist — admin export (returns full email list) ──

export async function GET() {
  // TODO: When KV is bound, read the master list:
  //
  // const env = ...;
  // const kv = env.SPRITEBREW_KV;
  // if (kv) {
  //   const allRaw = await kv.get('waitlist:__all_emails');
  //   const all: string[] = allRaw ? JSON.parse(allRaw) : [];
  //   return Response.json({ success: true, emails: all, count: all.length });
  // }

  return Response.json({
    success: true,
    emails: [],
    count: 0,
    note: 'KV not configured yet. Check Cloudflare Pages logs for [WAITLIST] entries.',
  });
}
