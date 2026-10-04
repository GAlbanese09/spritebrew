/**
 * The purchase banner by state (HQ-14, n1-ledger-03 016). After Stripe's
 * checkout returns to /generate?purchase=success, the banner says only what
 * the evidence shows:
 *
 *   'added'    the balance rose by at least the pack's tokens above a baseline
 *              taken just before the customer left for Stripe. No baseline
 *              (another tab, cleared storage, a different user), no 'added'.
 *   'paused'   money is paused, or the pause could not be read (fail closed,
 *              as the status route does).
 *   'pending'  otherwise. The banner re-reads for up to a minute and moves to
 *              'added' when the credit lands; it never claims a credit without
 *              the evidence.
 *   'late'     'pending' when the minute ends without proof: a text swap only
 *              (HQ `2026-10-03-008`), with no further read.
 *
 * Evidence wins: a balance already up by the pack is 'added' even while paused.
 * A latch (HQ `2026-10-03-005` decision 1, n1-ledger-03 020): once a return has
 * shown 'paused', for an explicit pause or a failed or unanswered read, it stays
 * 'paused' until the balance proves 'added', and never drops to 'pending'.
 * 'added', once shown, also stays. The pause is read through
 * `/api/token-balance?purchase=1`, only on this return path; no money path
 * reads it.
 */

export type PurchaseBannerState = 'added' | 'pending' | 'late' | 'paused';

export const PURCHASE_BANNER_COPY: Record<PurchaseBannerState, string> = {
  // UNAPPROVED COPY (HQ-14): HQ's text, built in S0; approval comes with S0's production go (HQ-4).
  added: 'Payment received. Your tokens have been added.',
  // UNAPPROVED COPY (HQ-14): HQ's text, built in S0; approval comes with S0's production go (HQ-4).
  pending: 'Payment received. Your tokens will appear in a moment.',
  // UNAPPROVED COPY (HQ-14, `2026-10-03-008`): HQ's text, built in S0; approval comes with S0's production go (HQ-4).
  late: "Payment received. Your tokens are taking longer than usual to appear. You don't need to pay again.",
  // UNAPPROVED COPY (HQ-14, `2026-10-03-008`): HQ's text, built in S0; approval comes with S0's production go (HQ-4).
  paused: "Payment received. We're finishing some maintenance, so your tokens may take a little while to appear. You don't need to do anything.",
};

/** A shown state, tagged with the user it was shown to. */
export interface BannerEntry {
  userId: string;
  state: PurchaseBannerState;
}

/** The state to show to `userId`: never another user's (Second's 042). */
export function shownFor(entry: BannerEntry | null, userId: string | null | undefined): PurchaseBannerState | null {
  return entry && userId && entry.userId === userId ? entry.state : null;
}

/** The balance before checkout, kept in this tab's sessionStorage. */
export interface PurchaseBaseline {
  userId: string;
  balance: number;
  /** The pack's tokens, which the webhook credits (`metadata.tokens`). */
  tokens: number;
  atMs: number;
}

/**
 * One read on the return path. `ok` false: no usable answer at all. `balance`
 * is present only when the route read it strictly; never a fallback.
 */
export interface PurchaseRead {
  ok: boolean;
  balance?: number;
  moneyPaused?: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const BASELINE_KEY = 'spritebrew:purchaseBaseline';
/** A baseline older than this is not evidence for a return. */
export const BASELINE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
/** How often, and for how long, the banner re-reads while 'pending' or 'paused'. */
export const RECHECK_INTERVAL_MS = 3_000;
export const RECHECK_WINDOW_MS = 60_000;
/** Each read's own bound; a read that has not answered counts as failed. */
export const READ_TIMEOUT_MS = 8_000;

function session(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function saveBaseline(baseline: PurchaseBaseline, storage: StorageLike | null = session()): void {
  try {
    storage?.setItem(BASELINE_KEY, JSON.stringify(baseline));
  } catch { /* storage unavailable: no baseline, so no 'added' */ }
}

export function clearBaseline(storage: StorageLike | null = session()): void {
  try {
    storage?.removeItem(BASELINE_KEY);
  } catch { /* nothing to clear */ }
}

/**
 * The baseline for this user's return, used once: it is removed as it is read.
 * Null when absent, malformed, another user's, or older than the bound.
 */
export function takeBaseline(
  userId: string,
  nowMs: number = Date.now(),
  storage: StorageLike | null = session()
): PurchaseBaseline | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(BASELINE_KEY) ?? null;
    storage?.removeItem(BASELINE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as Partial<PurchaseBaseline>;
    if (b.userId !== userId) return null;
    if (typeof b.balance !== 'number' || !Number.isFinite(b.balance)) return null;
    if (typeof b.tokens !== 'number' || !Number.isFinite(b.tokens) || b.tokens <= 0) return null;
    if (typeof b.atMs !== 'number' || nowMs - b.atMs > BASELINE_MAX_AGE_MS || b.atMs > nowMs) return null;
    return { userId: b.userId, balance: b.balance, tokens: b.tokens, atMs: b.atMs };
  } catch {
    return null;
  }
}

export function bannerStateFor(read: PurchaseRead, baseline: PurchaseBaseline | null): PurchaseBannerState {
  if (
    read.ok && baseline && typeof read.balance === 'number'
    && read.balance >= baseline.balance + baseline.tokens
  ) {
    return 'added';
  }
  // Only an explicit false is open; no answer or anything else is paused.
  if (!read.ok || read.moneyPaused !== false) return 'paused';
  return 'pending';
}

/**
 * The next state shown, given the one already shown on this return: the
 * latch. 'added' and 'paused' hold until the evidence shows 'added'.
 */
export function nextBannerState(
  previous: PurchaseBannerState | null,
  read: PurchaseRead,
  baseline: PurchaseBaseline | null
): PurchaseBannerState {
  const state = bannerStateFor(read, baseline);
  if (state === 'added' || previous === 'added') return 'added';
  if (previous === 'paused') return 'paused';
  return state;
}

/** The baseline read before checkout: a strict balance read, no pause read. */
export async function readBaselineBalance(
  getToken: () => Promise<string | null>,
  timeoutMs: number = 3_000
): Promise<number | null> {
  const read = await readBalance('/api/token-balance?purchase=baseline', getToken, undefined, timeoutMs);
  return read.ok && typeof read.balance === 'number' ? read.balance : null;
}

/**
 * The buy page's step just before it leaves for Stripe: clear any earlier
 * baseline, read the balance strictly, and save it with the pack's tokens. A
 * failed or unknown read saves none, so the return can never show 'added'.
 */
export async function prepareBaseline(args: {
  userId: string;
  tokens: number;
  getToken: () => Promise<string | null>;
  storage?: StorageLike | null;
  timeoutMs?: number;
  nowMs?: number;
}): Promise<PurchaseBaseline | null> {
  const storage = args.storage === undefined ? session() : args.storage;
  clearBaseline(storage);
  const balance = await readBaselineBalance(args.getToken, args.timeoutMs);
  if (balance === null) return null;
  const baseline = { userId: args.userId, balance, tokens: args.tokens, atMs: args.nowMs ?? Date.now() };
  saveBaseline(baseline, storage);
  return baseline;
}

/** One return-path read: the balance and the pause, bounded. */
export function readPurchaseStatus(
  getToken: () => Promise<string | null>,
  signal?: AbortSignal,
  timeoutMs: number = READ_TIMEOUT_MS
): Promise<PurchaseRead> {
  return readBalance('/api/token-balance?purchase=1', getToken, signal, timeoutMs);
}

async function readBalance(
  path: string,
  getToken: () => Promise<string | null>,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<PurchaseRead> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The bound covers the whole read (token, request and body), not only the request.
  const timedOut = new Promise<PurchaseRead>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false });
    }, timeoutMs);
  });
  const attempt = async (): Promise<PurchaseRead> => {
    try {
      const token = await getToken();
      const res = await fetch(path, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null) as
        { success?: boolean; balance?: number | null; moneyPaused?: boolean } | null;
      if (!res.ok || !data?.success) return { ok: false };
      return {
        ok: true,
        ...(typeof data.balance === 'number' && Number.isFinite(data.balance) ? { balance: data.balance } : {}),
        ...(typeof data.moneyPaused === 'boolean' ? { moneyPaused: data.moneyPaused } : {}),
      };
    } catch {
      return { ok: false };
    }
  };
  try {
    return await Promise.race([attempt(), timedOut]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Reads, shows the state, and re-reads every few seconds while the state is
 * not 'added'. No read starts more than `windowMs` after the first, counting
 * the reads' own time as well as the waits (Second's 042). Ends at 'added',
 * at the window's end, or on abort. At the window's end a 'pending' state is
 * swapped for 'late', a text swap with no further read; 'paused' and 'added'
 * stay. `previous`, the state this return already showed, carries the latch
 * across a restart. Answers the last state shown.
 */
export async function watchPurchase(opts: {
  read: () => Promise<PurchaseRead>;
  baseline: PurchaseBaseline | null;
  previous?: PurchaseBannerState | null;
  onState: (state: PurchaseBannerState) => void;
  onBalance?: (balance: number) => void;
  signal?: AbortSignal;
  intervalMs?: number;
  windowMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<PurchaseBannerState | null> {
  const intervalMs = opts.intervalMs ?? RECHECK_INTERVAL_MS;
  const windowMs = opts.windowMs ?? RECHECK_WINDOW_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const started = now();
  let last: PurchaseBannerState | null = opts.previous ?? null;
  let windowEnded = false;
  while (!opts.signal?.aborted) {
    const read = await opts.read();
    if (opts.signal?.aborted) break;
    if (read.ok && typeof read.balance === 'number') opts.onBalance?.(read.balance);
    last = nextBannerState(last, read, opts.baseline);
    opts.onState(last);
    if (last === 'added') break;
    if (now() - started + intervalMs > windowMs) { windowEnded = true; break; }
    await sleep(intervalMs);
    if (now() - started > windowMs) { windowEnded = true; break; }
  }
  // HQ `2026-10-03-008`: the late line, only from 'pending', only at the window's end.
  if (windowEnded && !opts.signal?.aborted && last === 'pending') {
    last = 'late';
    opts.onState(last);
  }
  return last;
}
