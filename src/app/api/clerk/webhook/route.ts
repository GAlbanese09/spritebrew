// Clerk webhook handler — listens for `user.created` events to flag disposable
// email signups before the lazy-init bonus is granted on first generation.
//
// Auth: Svix signature verification using Web Crypto (edge-compatible).
//   - Headers: svix-id, svix-timestamp, svix-signature
//   - Signed content: `${svix_id}.${svix_timestamp}.${body}`
//   - Secret: `CLERK_WEBHOOK_SECRET`, prefixed with `whsec_`
//
// On `user.created` with a disposable email domain, set
// `disposable_blocked:{userId}` so initBalance() grants 0 tokens instead of 30.

export const runtime = 'edge';

import { isDisposableEmail } from '@/lib/disposableEmail';
import { setDisposableBlocked } from '@/lib/tokenBalance';

interface ClerkUserCreatedPayload {
  type: string;
  data: {
    id: string;
    primary_email_address_id?: string;
    email_addresses?: Array<{
      id: string;
      email_address: string;
    }>;
  };
}

// ── Svix signature verification ──

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Constant-time compare of two equal-length base64 signatures. */
function timingSafeEqualBase64(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySvixSignature(
  body: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string
): Promise<boolean> {
  // Secret format is `whsec_<base64>`. Strip prefix; decode base64 to raw HMAC key.
  const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(rawSecret);
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signed = `${svixId}.${svixTimestamp}.${body}`;
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signed) as BufferSource
  );
  const expected = bytesToBase64(new Uint8Array(mac));

  // svix-signature is space-separated entries like `v1,<base64sig> v1,<base64sig>`.
  // We accept if any v1 entry matches (Svix's documented format).
  const parts = svixSignature.split(' ');
  for (const p of parts) {
    const [version, sig] = p.split(',');
    if (version !== 'v1' || !sig) continue;
    if (timingSafeEqualBase64(sig, expected)) return true;
  }
  return false;
}

// ── POST handler ──

export async function POST(request: Request) {
  const body = await request.text();
  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return Response.json(
      { error: 'Missing Svix headers.' },
      { status: 400 }
    );
  }

  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[Clerk Webhook] CLERK_WEBHOOK_SECRET not configured');
    return Response.json(
      { error: 'Webhook secret not configured.' },
      { status: 500 }
    );
  }

  const ok = await verifySvixSignature(body, svixId, svixTimestamp, svixSignature, secret);
  if (!ok) {
    console.error('[Clerk Webhook] Signature verification failed');
    return Response.json(
      { error: 'Invalid signature.' },
      { status: 401 }
    );
  }

  let payload: ClerkUserCreatedPayload;
  try {
    payload = JSON.parse(body) as ClerkUserCreatedPayload;
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (payload.type === 'user.created') {
    const userId = payload.data?.id;
    const primary = payload.data?.email_addresses?.find(
      (e) => e.id === payload.data?.primary_email_address_id
    );
    const email = primary?.email_address ?? payload.data?.email_addresses?.[0]?.email_address;

    if (userId && email && isDisposableEmail(email)) {
      await setDisposableBlocked(userId);
      console.warn(`[Clerk Webhook] Flagged disposable email signup: ${userId} (${email})`);
    }
  }

  return Response.json({ received: true });
}
