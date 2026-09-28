/**
 * The money-write pause (n1-ledger.md 005 section 4, as amended by 007 and
 * 008): one row in the `control` table of `spritebrew-ledger`, read on every
 * money write and every fresh generation. It FAILS CLOSED: a missing binding,
 * a read error, a timeout or an unexpected value all count as paused, so a D1
 * fault can never let an old-money write through during a switch.
 *
 * Consumer copy: spritebrew-rd-consumer/src/moneyPause.ts. Keep them in step.
 */

interface D1Like {
  prepare(sql: string): { first<T = Record<string, unknown>>(): Promise<T | null> };
}

/** Thrown where a money write is refused because money is paused. */
export class MoneyPausedError extends Error {
  constructor() {
    super('money writes are paused');
    this.name = 'MoneyPausedError';
  }
}

/** The customer-facing copy for a paused money write. */
export const PAUSED_MESSAGE = 'SpriteBrew is updating. Try again in a few minutes. You were not charged.';

/** The same, where nothing was being charged (a balance opening, a reward). */
export const UPDATING_MESSAGE = 'SpriteBrew is updating. Try again in a few minutes.';

const PAUSE_READ_TIMEOUT_MS = 2_000;

export async function isMoneyPaused(): Promise<boolean> {
  const env = process.env as Record<string, unknown>;
  const db = env.LEDGER_DB as D1Like | undefined;
  const started = Date.now();
  let paused = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!db || typeof db.prepare !== 'function') throw new Error('LEDGER_DB binding missing');
    const row = await Promise.race([
      db.prepare("SELECT value FROM control WHERE key = 'money_pause'").first<{ value: string }>(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('pause read timed out')), PAUSE_READ_TIMEOUT_MS);
      }),
    ]);
    // Only an explicit '0' opens the gate; a missing row or any other value
    // is logged below and read as paused.
    if (row?.value !== '0' && row?.value !== '1') {
      throw new Error(row ? 'unexpected money_pause value' : 'money_pause row missing');
    }
    paused = row.value !== '0';
  } catch (err) {
    console.error(JSON.stringify({
      source: 'money-pause',
      event: 'pause_read_failed',
      error: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
    }));
    paused = true;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  if (env.APP_ENV === 'dev') {
    // T11d: the read's latency, dev only.
    console.log(JSON.stringify({ source: 'money-pause', event: 'pause_read', ms: Date.now() - started, paused }));
  }
  return paused;
}

/**
 * Dev-only fault injection for the release 1 tests (T10c, ruling G): the
 * `dev_fault` row of the dev `control` table, a comma-separated list of fault
 * names. Read only when APP_ENV is 'dev'; production never reads it, and no
 * migration inserts it.
 */
export async function devFault(): Promise<string | null> {
  const env = process.env as Record<string, unknown>;
  if (env.APP_ENV !== 'dev') return null;
  try {
    const db = env.LEDGER_DB as D1Like | undefined;
    if (!db) return null;
    const row = await db.prepare("SELECT value FROM control WHERE key = 'dev_fault'").first<{ value: string }>();
    return row?.value ?? null;
  } catch {
    return null;
  }
}
