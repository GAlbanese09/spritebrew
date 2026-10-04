/**
 * The purchase banner by state (HQ-14). After Stripe's checkout returns to
 * /generate?purchase=success&session_id={CHECKOUT_SESSION_ID}, the banner
 * says only what the evidence shows:
 *
 *   'added'    this checkout's own credit is in the D1 ledger: the session's
 *              payment intent finds the purchase row, this user's, naming this
 *              session (R9-8, HQ `2026-10-03-005` decision 2; read by the
 *              server, src/lib/purchaseEvidence.ts). No session id (an old
 *              tab), another user's session, or a failed read: no 'added'.
 *   'paused'   money is paused, or the pause could not be read (fail closed,
 *              as the status route does).
 *   'pending'  otherwise. The banner re-reads for up to a minute and moves to
 *              'added' when the credit lands; it never claims a credit without
 *              the evidence.
 *   'late'     'pending' when the minute ends without proof: a text swap only
 *              (HQ `2026-10-03-008`), with no further read.
 *
 * Evidence wins: a proven credit is 'added' even while paused. A latch (HQ
 * `2026-10-03-005` decision 1): once a return has shown 'paused', for an
 * explicit pause or a failed or unanswered read, it stays 'paused' until the
 * credit proves 'added', and never drops to 'pending'. 'added', once shown,
 * also stays. Both are read through `/api/token-balance?purchase=1`, only on
 * this return path; no money path reads it. S0's balance-rise baseline is
 * retired with it.
 */

export type PurchaseBannerState = 'added' | 'pending' | 'late' | 'paused';

export const PURCHASE_BANNER_COPY: Record<PurchaseBannerState, string> = {
  // HQ-14, approved with S0's production go (HQ `2026-10-04-002`).
  added: 'Payment received. Your tokens have been added.',
  // HQ-14, approved with S0's production go (HQ `2026-10-04-002`).
  pending: 'Payment received. Your tokens will appear in a moment.',
  // HQ-14 (`2026-10-03-008`), approved with S0's production go (HQ `2026-10-04-002`).
  late: "Payment received. Your tokens are taking longer than usual to appear. You don't need to pay again.",
  // HQ-14 (`2026-10-03-008`), approved with S0's production go (HQ `2026-10-04-002`).
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

/**
 * One read on the return path. `ok` false: no usable answer at all. `balance`
 * is present only when the route read it strictly; never a fallback.
 * `credited` is true only when the server found this checkout's own credit.
 */
export interface PurchaseRead {
  ok: boolean;
  balance?: number;
  moneyPaused?: boolean;
  credited?: boolean;
}

/** How often, and for how long, the banner re-reads while 'pending' or 'paused'. */
export const RECHECK_INTERVAL_MS = 3_000;
export const RECHECK_WINDOW_MS = 60_000;
/** Each read's own bound; a read that has not answered counts as failed. */
export const READ_TIMEOUT_MS = 8_000;

export function bannerStateFor(read: PurchaseRead): PurchaseBannerState {
  if (read.ok && read.credited === true) return 'added';
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
  read: PurchaseRead
): PurchaseBannerState {
  const state = bannerStateFor(read);
  if (state === 'added' || previous === 'added') return 'added';
  if (previous === 'paused') return 'paused';
  return state;
}

/** One return-path read: the balance, the pause and this checkout's credit, bounded. */
export function readPurchaseStatus(
  getToken: () => Promise<string | null>,
  sessionId: string | null,
  signal?: AbortSignal,
  timeoutMs: number = READ_TIMEOUT_MS
): Promise<PurchaseRead> {
  const path = `/api/token-balance?purchase=1${sessionId ? `&session=${encodeURIComponent(sessionId)}` : ''}`;
  return readBalance(path, getToken, signal, timeoutMs);
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
        { success?: boolean; balance?: number | null; moneyPaused?: boolean; credited?: boolean | null } | null;
      if (!res.ok || !data?.success) return { ok: false };
      return {
        ok: true,
        ...(typeof data.balance === 'number' && Number.isFinite(data.balance) ? { balance: data.balance } : {}),
        ...(typeof data.moneyPaused === 'boolean' ? { moneyPaused: data.moneyPaused } : {}),
        ...(data.credited === true ? { credited: true } : {}),
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
 * across a restart, and `startedAt`, the time of this return's first read,
 * carries its window (Second's 044): a restart reads only within the time
 * left, and once it is spent starts no read at all, keeping the shown state
 * ('pending' becomes 'late', as at the window's end). Answers the last state
 * shown.
 */
export async function watchPurchase(opts: {
  read: () => Promise<PurchaseRead>;
  previous?: PurchaseBannerState | null;
  startedAt?: number;
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
  const started = opts.startedAt ?? now();
  let last: PurchaseBannerState | null = opts.previous ?? null;
  // A restart after this return's window has run out starts no read.
  let windowEnded = now() - started > windowMs;
  while (!windowEnded && !opts.signal?.aborted) {
    const read = await opts.read();
    if (opts.signal?.aborted) break;
    if (read.ok && typeof read.balance === 'number') opts.onBalance?.(read.balance);
    last = nextBannerState(last, read);
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
