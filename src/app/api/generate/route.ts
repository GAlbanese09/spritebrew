// API route for sprite generation: charge, then enqueue for the consumer.
//
// Both Create New and Animate My Character use the Retro Diffusion direct
// API, called by the queue consumer (spritebrew-rd-consumer). This route
// charges the job and enqueues it; the browser polls /api/generation-status.
// The SSE path is retired (n1-ledger 007 section 4).
//
// Release 2 (n1-release-2-spec.md revision 9, 5.1): the job id, the request
// hash and the RD body exist before any money; the identity read answers a
// replay before the cap and the debit; the debit is 4.3, one guarded D1
// batch with the job's row; a charged job is sent, then marked enqueued
// (4.4); an enqueue that fails is refunded by 4.8's 'pages' fence, whose
// read-back decides the answer. No admission record, no KV money key.
//
// Authentication: Clerk session JWT in the Authorization Bearer header.

export const runtime = 'edge';

// This route's wording for the shared helper's four failure cases.
const AUTH_MESSAGES: AuthMessages = {
  missing: 'Please sign in to generate sprite sheets.',
  empty: 'Invalid session. Please sign in again.',
  invalid: 'Invalid token. Please sign in again.',
  expired: 'Your session expired. Please sign in again.',
};

// ── Constants ──

// Animate My Character: action → rd_advanced_animation__* prompt_style
const VALID_ACTIONS = ['walking', 'idle', 'attack', 'jump', 'crouch', 'destroy', 'subtle_motion', 'custom_action'];

const ACTION_STYLE_MAP: Record<string, string> = {
  walking: 'rd_advanced_animation__walking',
  idle: 'rd_advanced_animation__idle',
  attack: 'rd_advanced_animation__attack',
  jump: 'rd_advanced_animation__jump',
  crouch: 'rd_advanced_animation__crouch',
  destroy: 'rd_advanced_animation__destroy',
  subtle_motion: 'rd_advanced_animation__subtle_motion',
  custom_action: 'rd_advanced_animation__custom_action',
};

const FALLBACK_STYLE = 'animation__any_animation';

const RD_MAX_REFERENCE_IMAGES = 9;
// 12MB ceiling on total reference payload, expressed in base64 string length
// (base64 inflates raw bytes by ~4/3, so 12MB raw ≈ 16MB base64 chars).
const REF_TOTAL_BASE64_BUDGET = 12 * 1024 * 1024 * 4 / 3;

export interface GenerateBody {
  prompt?: string;
  // Create New fields
  promptStyle?: string;   // the RD prompt_style value from the style registry
  style?: string;         // legacy field name (alias for promptStyle)
  width?: number;
  height?: number;
  removeBg?: boolean;
  /** Optional base64-encoded reference images (no `data:` prefix). Max 9.
   *  Only honoured for rd_pro__* styles per RD's API. */
  referenceImages?: string[];
  // Animate My Character fields
  mode?: 'create' | 'animate';
  inputImage?: string;
  action?: string;
  motionPrompt?: string;
  framesDuration?: number;
  /** Client-supplied UUID for the queue-kickoff path (Build #2A).
   *  Required only when QUEUE_KICKOFF_ENABLED is on for this user. */
  idempotencyKey?: string;
  /**
   * Optional 64×64 opaque PNG base64 (no data: prefix) rendered by the
   * client alongside the primary inputImage. Threaded into the QUEUE
   * ENVELOPE only (never into the RD wire body). Consumer uses it as the
   * animation__any_animation fallback input when the primary style fails
   * on a >64px request. Omitted from the envelope when adding it would
   * push the message past the queue budget.
   */
  fallbackInputImage?: string;
}

// ── POST handler ──

import { getAuthedUserId, type AuthMessages } from '@/lib/edgeAuth';
import {
  getLifetimeFreeCount,
  incrementLifetimeFreeCount,
  hasUserPaid,
  type FreeTierBucket,
} from '@/lib/tokenBalance';
import { getTokenCost, getResolutionMode, getFreeTierBucket, GENERATION_STYLES } from '@/lib/styleRegistry';
import { getAccountStatus } from '@/lib/accountLock';
import { isAdminUser } from '@/lib/generationLimits';
import { isQueueKickoffEnabled } from '@/lib/featureFlag';
import { deriveJobId } from '@/lib/jobIdHelper';
import { putJobState, putJobStateStrict } from '@/lib/jobState';
import { enqueueJob } from '@/lib/queueProducer';
import { buildRdCreateBody, buildRdAnimateBody } from '@/lib/rdBodyBuilder';
import { devFaultScope, PAUSED_MESSAGE } from '@/lib/moneyPause';
import * as L from '@/lib/ledger';
import { chargeGeneration, ledgerCtx } from '@/lib/money';
import { recordLedgerAlarm, sha256Hex, stableStringify } from '@/lib/eventsRow';
import {
  FREE_TIER_LIFETIME_PRO_CAP,
  FREE_TIER_LIFETIME_FAST_CAP,
  ANIMATE_INPUT_B64_SERVER_MAX,
  REFS_TOTAL_B64_QUEUE_MAX,
} from '@/lib/constants';

const FREE_TIER_CAP: Record<FreeTierBucket, number> = {
  pro: FREE_TIER_LIFETIME_PRO_CAP,
  fast: FREE_TIER_LIFETIME_FAST_CAP,
};

// Approved by HQ, `2026-10-04-004` (HQ-2): the enqueue catch's refunded answer (5.1's r5 branch).
export const REFUNDED_COPY = 'Could not start your generation. Your tokens were refunded. Please try again.';
// Approved by HQ, `2026-10-04-004` (HQ-2): the enqueue catch's unconfirmed answer; it promises
// no refund and does not say the job never started (O4).
export const UNCONFIRMED_COPY = 'We could not confirm what happened to this generation. Check your gallery and your balance in a few minutes.';
// Approved by HQ, `2026-10-04-004` (HQ-7): the 409 for a request key used for a different generation (4.3).
export const CONFLICT_COPY = 'This request was already used for a different generation. Please refresh and try again.';
// Approved by HQ, `2026-10-04-004` (4.3): uncertain, and the identity read found no row.
export const NOT_CHARGED_COPY = 'You were not charged.';
// Approved by HQ, `2026-10-04-004` (4.3; content `L 004` ruling 3):
// uncertain, and the identity read failed. Nothing is enqueued, so the
// recovery sweep's candidate (1) refunds a charge that happened.
export const UNCONFIRMED_CHARGE_COPY = 'We could not confirm whether you were charged. If you were, your tokens will be returned automatically.';

/** 4.3's `:meta`: the width and height the RD body carries, as sent for a
 *  create (absent when not sent, so its size is unknown), `width ?? 64` for
 *  both on an animate (validated square). */
export function debitMeta(mode: 'create' | 'animate', rdBody: { width?: number; height?: number }): string | null {
  const dims: Record<string, number> = {};
  if (Number.isInteger(rdBody.width)) dims.width = rdBody.width as number;
  if (Number.isInteger(rdBody.height)) dims.height = rdBody.height as number;
  if (mode === 'animate') return JSON.stringify({ width: dims.width ?? 64, height: dims.width ?? 64 });
  return Object.keys(dims).length ? JSON.stringify(dims) : null;
}

/** 4.3's `:hash`: SHA-256 of the key-sorted JSON of { mode, tokenCost, rdBody }. */
export async function requestHash(mode: string, tokenCost: number, rdBody: unknown): Promise<string> {
  return sha256Hex(stableStringify({ mode, tokenCost, rdBody }));
}

const json = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });


export async function POST(request: Request) {
  const authResult = await getAuthedUserId(request, AUTH_MESSAGES);
  if ('error' in authResult) {
    return Response.json({ success: false, error: authResult.error }, { status: 401 });
  }
  const userId = authResult.userId;

  // Account lock check
  const accountStatus = await getAccountStatus(userId);
  if (accountStatus === 'refund_locked') {
    return Response.json(
      { success: false, error: 'Your account is temporarily locked because a recent refund resulted in a negative token balance. Contact support@spritebrew.com to resolve.' },
      { status: 403 }
    );
  }
  if (accountStatus === 'disputed') {
    return Response.json(
      { success: false, error: 'This account has been permanently closed due to a chargeback. If you believe this is an error, contact support@spritebrew.com.' },
      { status: 403 }
    );
  }

  let body: GenerateBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const mode = body.mode ?? 'create';

  // Validate before streaming (fast errors as plain JSON)
  if (mode === 'create') {
    const err = validateCreateBody(body);
    if (err) return Response.json({ success: false, error: err }, { status: 400 });
  } else {
    const err = validateAnimateBody(body);
    if (err) return Response.json({ success: false, error: err }, { status: 400 });
  }

  // Determine the prompt style and token cost
  let promptStyle: string;
  if (mode === 'animate') {
    promptStyle = ACTION_STYLE_MAP[body.action!] ?? FALLBACK_STYLE;
  } else {
    promptStyle = body.promptStyle ?? body.style ?? '';
  }
  const tokenCost = getTokenCost(promptStyle);
  const bucket: FreeTierBucket = getFreeTierBucket(promptStyle);
  const isAdmin = isAdminUser(userId);

  // 4.3's `:size`, the requested width: animate defaults to 64, matching
  // validateAnimateBody; create has no server-side default.
  const size = body.width ?? (mode === 'animate' ? 64 : undefined);

  // Queue-kickoff routing decision — hoisted so the pre-debit guards below
  // can short-circuit cleanly for users on the queue path without re-running
  // the feature-flag check inside the post-debit branch.
  const queueKickoff = isQueueKickoffEnabled(userId, process.env as Record<string, unknown>);

  // The SSE path is retired (n1-ledger 007 section 4): refused before any
  // debit. Unreachable while QUEUE_KICKOFF_ENABLED is "true".
  if (!queueKickoff) {
    return Response.json(
      { success: false, error: 'path_retired', message: 'This generation path is retired.' },
      { status: 503 }
    );
  }

  // Pre-debit gates for the queue-kickoff path. All return 400 BEFORE any
  // debit fires, so there's no refund/orphan-debit churn for these cases.

  // 1. idempotencyKey requirement — moved here from inside the queue branch
  //    (previously a post-debit 400 that orphaned the debit on misbehaving
  //    clients). Same JSON shape as the old check.
  if (queueKickoff) {
    const idempotencyKey = body.idempotencyKey;
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
      return new Response(
        JSON.stringify({ error: 'idempotencyKey required for queue-kickoff path' }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }
  }

  // 2. Animate inputImage payload-size guard. Cloudflare Queues caps a
  //    message at 128 KB and the base64-encoded inputImage is the dominant
  //    field. Reject above ANIMATE_INPUT_B64_SERVER_MAX with a friendly
  //    message; client now budgets to a stricter ANIMATE_INPUT_B64_CLIENT_MAX,
  //    so this only fires for misbehaving clients or stale tabs.
  if (
    queueKickoff &&
    mode === 'animate' &&
    typeof body.inputImage === 'string' &&
    body.inputImage.length > ANIMATE_INPUT_B64_SERVER_MAX
  ) {
    return Response.json(
      {
        success: false,
        error: 'input_image_too_large',
        message: 'Your character image is too large to process. Re-upload it (it will be optimized automatically) or choose a smaller resolution.',
      },
      { status: 400 }
    );
  }

  // 3. Create-mode reference-images total-size guard (queue path only).
  //    Reference uploads aren't client-side budgeted today, so this is the
  //    only line of defense against an oversized aggregate.
  if (
    queueKickoff &&
    mode === 'create' &&
    Array.isArray(body.referenceImages) &&
    body.referenceImages.length > 0
  ) {
    const totalRefBytes = body.referenceImages.reduce(
      (sum, img) => sum + (typeof img === 'string' ? img.length : 0),
      0
    );
    if (totalRefBytes > REFS_TOTAL_B64_QUEUE_MAX) {
      return Response.json(
        {
          success: false,
          error: 'reference_images_too_large',
          message: 'Reference images this large are not supported for queued generations yet. Use fewer or smaller references for now.',
        },
        { status: 400 }
      );
    }
  }

  // (S16: email-verify earn-back removed — bots pass OTP trivially. Engagement
  // rewards now live in the daily-login + email-list flows. We keep the
  // bonus_email_verified:* and email_verified_cache:* KV keys untouched for
  // historical analytics; nothing here writes to them anymore.)

  // The job id, the request hash and the RD body before any money (5.1, 4.3).
  // The job id is a pure hash of the user and the idempotency key validated
  // above; the request id names the request in its lines and pending record.
  const requestId = `gen:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const idempotencyKey = body.idempotencyKey as string;
  const jobId = await deriveJobId(userId, idempotencyKey);
  // Translate camelCase request body to the snake_case RD wire format: the
  // consumer forwards it verbatim (Build #2A.1).
  const rdBody = mode === 'animate' ? buildRdAnimateBody(body) : buildRdCreateBody(body);
  const hash = await requestHash(mode, tokenCost, rdBody);
  const log = (outcome: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ source: 'generate', request_id: requestId, job_id: jobId, user_id: userId, outcome, ...extra }));

  let ctx: L.LedgerCtx;
  try {
    ctx = ledgerCtx();
  } catch {
    log('ledger unbound (503)');
    return json({ success: false, error: 'not_charged', message: NOT_CHARGED_COPY }, 503);
  }

  // The replay, before the pause and the cap (5.1): an imported or tombstone
  // row of this user, or a d1 row with this user and hash, is answered from
  // its row, never charged and never enqueued; any other identity is a 409.
  let identity: L.JobIdentity | null;
  try {
    identity = await L.readGenerationIdentity(ctx, jobId);
  } catch {
    log('identity read failed (503)');
    return json({ success: false, error: 'not_charged', message: NOT_CHARGED_COPY }, 503);
  }
  const known = L.classifyIdentity((identity ?? undefined) as Record<string, unknown> | undefined, userId, hash, null);
  if (known === 'old_request' || known === 'replay') {
    log(`${known} (202)`);
    return json({ jobId, replayed: true }, 202);
  }
  if (known === 'conflict') {
    log('conflict (409)');
    return json({ success: false, error: 'idempotency_conflict', message: CONFLICT_COPY }, 409);
  }

  // Free-tier lifetime cap enforcement, only for users who haven't paid.
  // Admins are exempt. Plus / Pro / Animation roll up under the `pro` bucket;
  // Fast has its own counter.
  if (!isAdmin) {
    const paid = await hasUserPaid(userId);
    if (!paid) {
      const used = await getLifetimeFreeCount(userId, bucket);
      if (used >= FREE_TIER_CAP[bucket]) {
        log('free_tier_cap (402)');
        return json({
          success: false,
          error: 'free_tier_cap_reached',
          code: 'free_tier_cap_reached',
          message: `You've used all free generations for this style tier. Top up to continue.`,
          tier: bucket,
        }, 402);
      }
    }
  }

  // The debit with its job intent (4.3), its identity rules (A5).
  const debit = await chargeGeneration(ctx, {
    uid: userId, job: jobId, cost: tokenCost, mode, ckey: idempotencyKey, hash,
    style: promptStyle, size: size ?? null, meta: debitMeta(mode, rdBody),
  });
  switch (debit.outcome) {
    case 'charged':
      break;
    case 'old_request':
    case 'replay':
      log(`${debit.outcome} (202, never enqueued here)`);
      return json({ jobId, replayed: true }, 202);
    case 'conflict':
      log('conflict (409)');
      return json({ success: false, error: 'idempotency_conflict', message: CONFLICT_COPY }, 409);
    case 'paused':
      log('paused (503)');
      return json({ success: false, error: 'money_paused', message: PAUSED_MESSAGE }, 503);
    case 'insufficient':
      log('insufficient_tokens (402)');
      return json({ success: false, error: 'Insufficient tokens', balance: debit.balance, required: tokenCost }, 402);
    case 'not_charged':
      log('not charged (503)');
      return json({ success: false, error: 'not_charged', message: NOT_CHARGED_COPY }, 503);
    default:
      // unconfirmed, or an error: nothing is enqueued, so candidate (1)
      // refunds a charge that happened (`L 004` ruling 3).
      log(`${debit.outcome} (503)`);
      return json({ success: false, error: 'charge_unconfirmed', message: UNCONFIRMED_CHARGE_COPY }, 503);
  }

  // Free-tier lifetime counter: only when this execution charged (5.1). A
  // failed-and-refunded gen still counts as one free attempt.
  if (!isAdmin) {
    try {
      const paid = await hasUserPaid(userId);
      if (!paid) await incrementLifetimeFreeCount(userId, bucket);
    } catch { /* best effort */ }
  }

  let enqueuedAt: number | undefined;
  try {
    const env = process.env as Record<string, unknown>;
    const kv = env.SPRITEBREW_KV as {
      get: (k: string) => Promise<string | null>;
      put: (k: string, v: string, opts?: unknown) => Promise<void>;
    };

    const now = Date.now();
    enqueuedAt = now;
    // The pending record carries its cost and request id, both or neither
    // (S0, A3, N4).
    await putJobState(kv, jobId, {
      status: 'pending',
      userId,
      mode,
      enqueuedAt: now,
      tokenCost,
      requestId,
    });

    // fallbackInputImage: envelope-only (never sent to RD directly). Consumer
    // uses it as the animation__any_animation fallback input for oversized
    // primaries. Cloudflare Queues cap is 128KB per message; the primary
    // inputImage already spends up to ANIMATE_INPUT_B64_SERVER_MAX (124KB),
    // leaving ~4KB headroom. A 64x64 nearest-neighbor PNG is typically
    // ~1-2KB base64, so the fallback fits in the common case, but we
    // budget-check defensively and omit it if the combined size would
    // approach the cap. Consumer degrades gracefully when absent.
    const QUEUE_MSG_BUDGET_B64 = 125_000;
    const primaryLen = typeof body.inputImage === 'string' ? body.inputImage.length : 0;
    const fallbackLen =
      typeof body.fallbackInputImage === 'string' ? body.fallbackInputImage.length : 0;
    const includeFallback =
      mode === 'animate' &&
      typeof body.fallbackInputImage === 'string' &&
      body.fallbackInputImage.length > 0 &&
      primaryLen + fallbackLen <= QUEUE_MSG_BUDGET_B64;
    if (
      mode === 'animate' &&
      typeof body.fallbackInputImage === 'string' &&
      body.fallbackInputImage.length > 0 &&
      !includeFallback
    ) {
      console.warn(
        '[enqueue] fallbackInputImage omitted: total b64 would exceed queue budget',
        JSON.stringify({ jobId, primaryLen, fallbackLen, budget: QUEUE_MSG_BUDGET_B64 })
      );
    }

    // Dev only (10.3): `send_skip` ends the request before its send, as a
    // Pages instance dying there would (candidate (1) refunds it, T7).
    if ((await devFaultScope('send_skip')) !== undefined) {
      log('dev fault send_skip (202, never sent)');
      return json({ jobId }, 202);
    }

    await enqueueJob(env.RD_QUEUE, {
      jobId,
      userId,
      idempotencyKey,
      tokenCost,
      mode,
      body: rdBody,
      enqueuedAt: now,
      ...(includeFallback ? { fallbackInputImage: body.fallbackInputImage } : {}),
    });

    // Dev only (10.3): `send_throw_after`, a send that delivered and then
    // threw (T16: the consumer claims first; 202 uncertain, no refund).
    if ((await devFaultScope('send_throw_after')) !== undefined) {
      throw new Error('dev fault: send_throw_after');
    }

    // 4.4, best effort: a failure is logged by the library.
    await L.markEnqueued(ctx, jobId);

    log('enqueued (202)');
    return json({ jobId }, 202);
  } catch (err) {
    return enqueueCatch(ctx, {
      jobId, userId, mode, enqueuedAt, log,
      errMsg: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * The enqueue catch (5.1): 4.8's 'pages' fence with `submission_failed`, then
 * r5's branch. Refunded now: the strict error status record (a failed write
 * leaves the marker NULL for the repair pass) and 503 with the refunded copy.
 * Claimed by a consumer: no record, no refund, 202 uncertain. Finished: from
 * its outcome. Fenced by the migrator's phase, or uncertain and unread: 503
 * with the unconfirmed copy; the row is a debited debt the sweep settles.
 */
async function enqueueCatch(ctx: L.LedgerCtx, a: {
  jobId: string;
  userId: string;
  mode: 'create' | 'animate';
  enqueuedAt: number | undefined;
  errMsg: string;
  log: (outcome: string, extra?: Record<string, unknown>) => void;
}): Promise<Response> {
  let r: L.RefundResult;
  try {
    // Dev only (10.3): `catch_refund_fail`, the compensating refund failing.
    if ((await devFaultScope('catch_refund_fail')) !== undefined) throw new Error('dev fault: catch_refund_fail');
    r = await L.refundAndFinish(ctx, { job: a.jobId, fence: 'pages', code: 'submission_failed', msg: a.errMsg.slice(0, 500) });
  } catch {
    r = { outcome: 'error', id: '', amount: null, row: null };
  }
  const rowOutcome = (r.row as Record<string, unknown> | null)?.outcome;
  const unconfirmed = () => json({ success: false, error: 'submission_failed', message: UNCONFIRMED_COPY }, 503);

  if (r.outcome === 'refunded' || r.outcome === 'already_refunded_legacy') {
    const written = await writeRefundedStatus(ctx, a, r);
    a.log(`refunded (503)`, { refund: r.outcome, status_written: written });
    return json({ success: false, error: 'submission_failed', message: REFUNDED_COPY }, 503);
  }
  if (r.outcome === 'live_owner') {
    a.log('claimed by a consumer (202 uncertain)');
    return json({ jobId: a.jobId, uncertain: true }, 202);
  }
  if (r.outcome === 'already_finished') {
    a.log(`finished (${String(rowOutcome)})`);
    if (rowOutcome === 'refunded' || rowOutcome === 'refunded_legacy') {
      return json({ success: false, error: 'submission_failed', message: REFUNDED_COPY }, 503);
    }
    if (rowOutcome === 'succeeded' || rowOutcome === 'rescued') return json({ jobId: a.jobId }, 202);
    return unconfirmed();
  }
  if (r.outcome === 'corruption') {
    await recordLedgerAlarm({ kind: 'debit_missing', subject: a.jobId, subjectKind: 'job', userId: a.userId, fields: { fence: 'pages' } });
  }
  a.log(`refund ${r.outcome} (503 unconfirmed)`);
  return unconfirmed();
}

/** The strict error status record after a verified refund, then the marker
 *  (4.10). Answers whether the marker is set. */
async function writeRefundedStatus(ctx: L.LedgerCtx, a: {
  jobId: string; userId: string; mode: 'create' | 'animate'; enqueuedAt: number | undefined;
}, r: L.RefundResult): Promise<boolean> {
  try {
    const kv = (process.env as Record<string, unknown>).SPRITEBREW_KV as { put: (k: string, v: string, opts?: unknown) => Promise<void> } | undefined;
    if (!kv || typeof kv.put !== 'function') throw new Error('SPRITEBREW_KV unbound');
    const failedAt = Date.now();
    await putJobStateStrict(kv, a.jobId, {
      status: 'error',
      userId: a.userId,
      mode: a.mode,
      enqueuedAt: a.enqueuedAt ?? failedAt,
      failedAt,
      error: 'Could not start your generation.',
      errorCode: 'submission_failed',
      attempts: 0,
      refunded: true,
      ...(r.amount !== null ? { refundedAmount: r.amount } : {}),
    });
  } catch (err) {
    console.error(JSON.stringify({ source: 'generate', event: 'status_write_failed', job_id: a.jobId, error: err instanceof Error ? err.message.slice(0, 120) : 'unknown' }));
    return false;
  }
  try {
    return await L.markStatusWritten(ctx, a.jobId);
  } catch {
    return false;
  }
}

// ── Validation ──

function validateCreateBody(body: GenerateBody): string | null {
  if (!body.prompt?.trim()) return 'Prompt is required.';
  const ps = body.promptStyle ?? body.style;
  if (!ps) return 'Style is required.';

  // If the picked style has explicit resolutionMode metadata (animation styles),
  // enforce it. Other styles fall back to existing client-side minSize/maxSize clamping.
  const mode = getResolutionMode(ps);
  if (mode && body.width !== undefined && body.height !== undefined) {
    if (mode.kind === 'locked') {
      if (body.width !== mode.size || body.height !== mode.size) {
        return `This style is locked at ${mode.size}x${mode.size}. Got ${body.width}x${body.height}.`;
      }
    } else {
      if (body.width < mode.min || body.width > mode.max) {
        return `Width must be between ${mode.min} and ${mode.max} for this style. Got ${body.width}.`;
      }
      if (body.height < mode.min || body.height > mode.max) {
        return `Height must be between ${mode.min} and ${mode.max} for this style. Got ${body.height}.`;
      }
    }
  }

  // Reference images — only valid for styles flagged supportsReferenceImages.
  if (body.referenceImages && body.referenceImages.length > 0) {
    const style = GENERATION_STYLES.find((s) => s.promptStyle === ps);
    if (!style?.supportsReferenceImages) {
      return `Style "${ps}" does not support reference images. Use a Pro style.`;
    }
    if (body.referenceImages.length > RD_MAX_REFERENCE_IMAGES) {
      return `Maximum ${RD_MAX_REFERENCE_IMAGES} reference images. Received ${body.referenceImages.length}.`;
    }
    for (let i = 0; i < body.referenceImages.length; i++) {
      const img = body.referenceImages[i];
      if (typeof img !== 'string' || img.length === 0) {
        return `Reference image ${i + 1} is not a valid string.`;
      }
      if (img.startsWith('data:')) {
        return `Reference image ${i + 1} includes a data: prefix. Strip it before sending.`;
      }
    }
    const totalSize = body.referenceImages.reduce((sum, img) => sum + img.length, 0);
    if (totalSize > REF_TOTAL_BASE64_BUDGET) {
      return 'Total reference image payload too large. Reduce image count or size.';
    }
  }

  return null;
}

function validateAnimateBody(body: GenerateBody): string | null {
  if (!body.inputImage) return 'An input image is required for animation. Please upload a character first.';
  if (!body.action || !VALID_ACTIONS.includes(body.action))
    return `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`;
  const w = body.width ?? 64;
  const h = body.height ?? 64;
  if (w !== h) return `Animation requires square dimensions. Got ${w}x${h}.`;

  // Validate against the action's prompt style resolution mode
  const promptStyle = ACTION_STYLE_MAP[body.action] ?? FALLBACK_STYLE;
  const mode = getResolutionMode(promptStyle);
  if (mode) {
    if (mode.kind === 'locked') {
      if (w !== mode.size) {
        return `This style is locked at ${mode.size}x${mode.size}. Got ${w}x${h}.`;
      }
    } else {
      if (w < mode.min || w > mode.max) {
        return `Resolution must be between ${mode.min} and ${mode.max} for this style. Got ${w}.`;
      }
      if (mode.kind === 'variable_special' && !mode.presets.includes(w)) {
        return `Resolution must be one of: ${mode.presets.join(', ')}. Got ${w}.`;
      }
    }
  }
  return null;
}
