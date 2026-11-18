import { getAuthedUserId, type AuthMessages } from '@/lib/edgeAuth';
import { GENERATION_STYLES } from '@/lib/styleRegistry';
import { askCreateWords, parseCreateSpecIds } from '@/lib/createWords';

// src/lib/createWordsRoute.ts: GET /api/create-words?style=&card=&view=&framing=
//
// The words a Create Sprite card and its fine-tune rows add, for the page's
// "Adds" line (G2; HQ 2026-11-18-049, -056 change 5). The words live in the
// private generation service; this route forwards ids through the
// CREATE_WORDS binding and passes on its answer. It never generates, calls
// the provider, reads or writes money, or stores anything.
//
// - Signed in only. Ids are checked against fixed lists; the style must be
//   a registered one. `view` and `framing` may be empty for the card's own.
// - Answers carry the table's version. They are kept in this isolate by
//   their ids (the same for everyone) for ten minutes, and the browser may
//   keep them for ten minutes (AUDIT g2 r1 L3).
// - A soft limit per account and isolate: 120 uncached lookups a minute.
// - No binding, or a failing one: 503, and the page shows no "Adds" line.

const AUTH_MESSAGES: AuthMessages = {
  missing: 'Not signed in.',
  empty: 'Invalid session.',
  invalid: 'Invalid token.',
  expired: 'Session expired.',
};

const STYLES: ReadonlySet<string> = new Set(GENERATION_STYLES.map((s) => s.promptStyle));
const MEMO_MAX = 500;
const MEMO_TTL_MS = 10 * 60_000;
const BROWSER_CACHE = 'private, max-age=600';
type Kept = { at: number; version: string } & ({ ok: true; adds: string } | { ok: false; reason: string });
const memo = new Map<string, Kept>();
export const RATE_LIMIT_PER_MINUTE = 120;
const windows = new Map<string, { start: number; count: number }>();

/** For tests only: forget what this isolate kept. */
export function resetCreateWordsRouteState(): void {
  memo.clear();
  windows.clear();
}

function overLimit(userId: string, now: number): boolean {
  const w = windows.get(userId);
  if (!w || now - w.start >= 60_000) {
    if (windows.size > 10_000) windows.clear();
    windows.set(userId, { start: now, count: 1 });
    return false;
  }
  w.count += 1;
  return w.count > RATE_LIMIT_PER_MINUTE;
}

const json = (status: number, payload: unknown, cache = 'no-store') =>
  Response.json(payload, { status, headers: { 'Cache-Control': cache } });

export async function handleCreateWordsGet(request: Request): Promise<Response> {
  const auth = await getAuthedUserId(request, AUTH_MESSAGES);
  if ('error' in auth) return json(401, { success: false, error: auth.error });

  const q = new URL(request.url).searchParams;
  const style = q.get('style') ?? '';
  const ids = parseCreateSpecIds({
    card: q.get('card'),
    view: q.get('view') || null,
    framing: q.get('framing') || null,
  });
  if (!STYLES.has(style) || !ids) return json(400, { success: false, error: 'bad_request' });

  const key = `${style}|${ids.card}|${ids.view ?? ''}|${ids.framing ?? ''}`;
  const now = Date.now();
  const kept = memo.get(key);
  if (kept && now - kept.at < MEMO_TTL_MS) return answerOf(kept);

  if (overLimit(auth.userId, now)) return json(429, { success: false, error: 'rate_limited' });

  const answer = await askCreateWords(process.env as Record<string, unknown>, { style, promptSpec: ids });
  if (answer.kind === 'unavailable') return json(503, { success: false, error: 'unavailable' });
  const entry: Kept = answer.kind === 'ok'
    ? { at: now, version: answer.version, ok: true, adds: answer.adds }
    : { at: now, version: answer.version, ok: false, reason: answer.reason };
  if (memo.size >= MEMO_MAX) memo.clear();
  memo.set(key, entry);
  return answerOf(entry);
}

function answerOf(k: Kept): Response {
  return k.ok
    ? json(200, { success: true, adds: k.adds, version: k.version }, BROWSER_CACHE)
    : json(200, { success: false, reason: k.reason, version: k.version }, BROWSER_CACHE);
}
