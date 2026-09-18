/**
 * token_tx:* KV metadata contract.
 *
 * Every token_tx:{userId}:{ts}:{uid} row is written with this object as its
 * KV metadata so list() callers (the admin failure-rate scan) can classify a
 * row without a get() per key. The JSON value of the row is unchanged; the
 * metadata is an index, not the record of truth.
 *
 * Writers (keep in sync, same PR):
 *   - src/lib/tokenBalance.ts                 writeTx (generation debit + all credits)
 *   - src/lib/tokenDebit.ts                   debitTokensForRefund (Stripe refund/dispute)
 *   - spritebrew-rd-consumer/src/refund.ts    refundTokens (sibling repo, keeps its own copy)
 * Reader:
 *   - src/app/api/admin/failure-rate/route.ts
 *
 * KV metadata must serialize to <= 1024 bytes; this shape stays well under 200.
 * Rows written before 2026-09-18 have no metadata and are read via get().
 */

export type TxMode = 'create' | 'animate';

export interface TxMetadata {
  type: 'credit' | 'debit';
  reason: string;
  /** RD prompt_style, e.g. rd_pro__fantasy. Generation debits and refunds only. */
  style?: string;
  mode?: TxMode;
  /** Requested sprite size in px (square). Generation debits and refunds only. */
  size?: number;
}

/** The generation context a caller can attach to a debit or refund. */
export type TxContext = Pick<TxMetadata, 'style' | 'mode' | 'size'>;

/**
 * Build the metadata object. Undefined or invalid context fields are omitted
 * rather than written as null, so rows without generation context stay
 * compact and a `style` key on the metadata always means a real style.
 */
export function txMetadata(
  type: TxMetadata['type'],
  reason: string,
  ctx?: TxContext
): TxMetadata {
  const meta: TxMetadata = { type, reason };
  if (typeof ctx?.style === 'string' && ctx.style.length > 0) meta.style = ctx.style;
  if (ctx?.mode === 'create' || ctx?.mode === 'animate') meta.mode = ctx.mode;
  if (typeof ctx?.size === 'number' && Number.isFinite(ctx.size)) meta.size = ctx.size;
  return meta;
}
