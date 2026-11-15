export const runtime = 'edge';

// Minimal KV interface — the binding is injected as an object on process.env
// by Cloudflare Pages, NOT via getCloudflareContext.
interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// An address longer than this is not a real address (RFC 5321), and it would
// make a store key over KV's 512-byte limit, so the sign-up could never save.
const MAX_EMAIL_BYTES = 254;
// The pages that call this route. Anything else is stored as 'other'.
const SOURCES = new Set(['pixel_pass', 'landing-page']);
const LIST_KEY = 'waitlist:__all_emails';

function getKV(): KV | null {
  const kv = (process.env as Record<string, unknown>).SPRITEBREW_KV;
  if (kv && typeof (kv as KV).put === 'function') return kv as KV;
  return null;
}

// ── POST /api/waitlist — collect a waitlist email ──

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid request.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return Response.json({ success: false, error: 'Invalid request.' }, { status: 400 });
  }
  const { email: rawEmail, source: rawSource } = body as { email?: unknown; source?: unknown };

  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  const source =
    rawSource === undefined || rawSource === null || rawSource === ''
      ? 'landing-page'
      : typeof rawSource === 'string' && SOURCES.has(rawSource)
        ? rawSource
        : 'other';
  if (!email || new TextEncoder().encode(email).length > MAX_EMAIL_BYTES || !EMAIL_RE.test(email)) {
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
        await kv.put(key, JSON.stringify({ email, joinedAt: timestamp, source }));
      }

      // Append to the master list for easy export, on every call: if the record
      // was saved but the list write failed, the person sees the error, tries
      // again, and is added then.
      const allRaw = await kv.get(LIST_KEY);
      let all: unknown;
      try {
        all = allRaw ? JSON.parse(allRaw) : [];
      } catch {
        all = null;
      }
      if (!Array.isArray(all)) {
        // The list is unreadable (not JSON, or not an array). Never overwrite
        // it, and do not tell the person to retry: their record is saved and a
        // retry cannot repair the list. Its own fixed line, with no address.
        console.warn('[WAITLIST] export list unreadable; record saved, list not updated');
        return Response.json({ success: true, stored: 'kv' });
      }
      if (!all.includes(email)) {
        all.push(email);
        await kv.put(LIST_KEY, JSON.stringify(all));
      }
      return Response.json({ success: true, stored: 'kv' });
    } catch {
      // A store read or write failed: fall through to the error answer below.
    }
  }

  // The sign-up is not fully saved (no store, or a read or write failed). Say
  // so, so the page can ask the person to try again. Never log the address:
  // Pages logs are not stored, so a log line would only expose it, not keep it.
  console.warn('[WAITLIST] store unavailable; sign-up not saved');
  return Response.json(
    { success: false, error: "We couldn't save your email just now. Please try again in a moment." },
    { status: 503 }
  );
}
