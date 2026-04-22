export const runtime = 'edge';

import { stripe } from '@/lib/stripe';
import { getTokenPack } from '@/lib/tokenPacks';

// ── JWT helpers (same pattern as /api/generate) ──

interface ClerkJwtPayload {
  sub?: string;
  exp?: number;
  [key: string]: unknown;
}

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
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
  if (!authHeader?.startsWith('Bearer ')) return { error: 'Please sign in to purchase tokens.' };
  const token = authHeader.slice(7).trim();
  if (!token || token === 'null' || token === 'undefined') return { error: 'Invalid session. Please sign in again.' };
  const payload = decodeJwtPayload(token);
  if (!payload?.sub) return { error: 'Invalid token. Please sign in again.' };
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return { error: 'Your session expired. Please sign in again.' };
  return { userId: payload.sub };
}

// ── POST /api/stripe/checkout ──

export async function POST(request: Request) {
  const authResult = getAuthedUserId(request);
  if ('error' in authResult) {
    return Response.json({ success: false, error: authResult.error }, { status: 401 });
  }
  const userId = authResult.userId;

  let body: { packId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const packId = body.packId;
  if (!packId) {
    return Response.json({ success: false, error: 'Pack ID is required.' }, { status: 400 });
  }

  const pack = getTokenPack(packId);
  if (!pack) {
    return Response.json({ success: false, error: `Invalid pack ID: ${packId}` }, { status: 400 });
  }

  const origin = request.headers.get('Origin') || 'https://spritebrew.com';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: pack.priceInCents,
            product_data: {
              name: `SpriteBrew ${pack.name} Pack — ${pack.tokens.toLocaleString()} Tokens`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId,
        packId: pack.id,
        tokens: String(pack.tokens),
      },
      success_url: `${origin}/generate?purchase=success`,
      cancel_url: `${origin}/generate?purchase=cancelled`,
    });

    return Response.json({ success: true, url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ success: false, error: `Checkout failed: ${msg}` }, { status: 500 });
  }
}
