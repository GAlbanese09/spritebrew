/**
 * token_tx:* KV metadata contract.
 *
 * Every token_tx:{userId}:{ts}:{uid} row is written with this object as its
 * KV metadata so list() callers (the admin failure-rate scan) can classify a
 * row without a get() per key. The JSON value of the row is unchanged; the
 * metadata is an index, not the record of truth.
 *
 * Writers: none from release 2 (n1-release-2-spec.md revision 9, 6.3; the
 * `token_tx:` mirror is dropped, `L 007` 009 A). Release 1 wrote these rows in
 * src/lib/tokenBalance.ts, src/lib/tokenDebit.ts and the consumer's
 * src/refund.ts; they stay readable until phase C.
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
