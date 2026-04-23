export const runtime = 'edge';

import { stripe } from '@/lib/stripe';
import { getTokenPack } from '@/lib/tokenPacks';

// ── KV binding ──

interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

function getKV(): KV | null {
  const kv = (process.env as Record<string, unknown>).SPRITEBREW_KV;
  if (kv && typeof (kv as KV).put === 'function') return kv as KV;
  return null;
}

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

interface CheckoutBody {
  packId?: string;
  consent_given?: string;
  consent_timestamp?: string;
  consent_article?: string;
}

const CONSENT_TEXT =
  'I expressly consent to SpriteBrew beginning performance of this contract immediately by crediting the purchased tokens to my account. I acknowledge that I thereby lose my 14-day right of withdrawal under Article 16(m) of Directive 2011/83/EU and Regulation 37 of the UK Consumer Contracts Regulations 2013 once the tokens are credited and I begin using them.';

export async function POST(request: Request) {
  const authResult = getAuthedUserId(request);
  if ('error' in authResult) {
    return Response.json({ success: false, error: authResult.error }, { status: 401 });
  }
  const userId = authResult.userId;

  let body: CheckoutBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }

  // Validate consent
  if (body.consent_given !== 'true') {
    return Response.json(
      { success: false, error: 'Consent required for EU Article 16(m) compliance. Please tick the consent checkbox at checkout.' },
      { status: 400 }
    );
  }

  const packId = body.packId;
  if (!packId) {
    return Response.json({ success: false, error: 'Pack ID is required.' }, { status: 400 });
  }

  const pack = getTokenPack(packId);
  if (!pack) {
    return Response.json({ success: false, error: `Invalid pack ID: ${packId}` }, { status: 400 });
  }

  // Capture consent metadata
  const consentTimestamp = body.consent_timestamp || new Date().toISOString();
  const consentArticle = body.consent_article || 'EU_2011_83_Art_16m + UK_CCR_2013_Reg_37';
  const consentIp =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';

  const origin = request.headers.get('Origin') || 'https://spritebrew.com';
  const userAgent = request.headers.get('User-Agent') || 'unknown';

  const durableMediumDescription = `SpriteBrew token pack: ${pack.name}. Consent to immediate performance recorded ${consentTimestamp}. Right of withdrawal waived per EU Directive 2011/83/EU Article 16(m) and UK CCR 2013 Regulation 37.`;

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
        consent_given: 'true',
        consent_timestamp: consentTimestamp,
        consent_ip: consentIp,
        consent_article: consentArticle,
      },
      payment_intent_data: {
        description: durableMediumDescription,
      },
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: durableMediumDescription,
        },
      },
      custom_text: {
        submit: {
          message: 'By completing this purchase you confirm the consent you provided on SpriteBrew regarding immediate performance and loss of your 14-day right of withdrawal.',
        },
      },
      success_url: `${origin}/generate?purchase=success`,
      cancel_url: `${origin}/generate?purchase=cancelled`,
    });

    // Store consent snapshot in KV for evidence retention (400-day TTL for Visa CE 3.0)
    const kv = getKV();
    if (kv && session.id) {
      try {
        await kv.put(
          `consent:${session.id}`,
          JSON.stringify({
            userId,
            timestamp: consentTimestamp,
            ip: consentIp,
            userAgent,
            consentText: CONSENT_TEXT,
            policyUrl: 'https://spritebrew.com/refund-policy',
            policyVersion: '2026-04-22',
          }),
          { expirationTtl: 34_560_000 } // 400 days
        );
      } catch {
        // Best effort — don't block checkout if KV write fails
      }
    }

    return Response.json({ success: true, url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ success: false, error: `Checkout failed: ${msg}` }, { status: 500 });
  }
}
