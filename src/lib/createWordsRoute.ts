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
// - Answers carry the table's version (AUDIT g2 r1 L3). Nothing is kept,
//   here or in the browser: every lookup asks the private side, so a words
//   change shows at the next lookup and a press never waits out an old
//   answer (AUDIT G2 page round 1, H1; HQ 2026-11-24-053). The call goes
//   through the service binding, which adds no request fee, to a pure
//   function there.
// - A soft limit per account and isolate: 120 lookups a minute.
// - No binding, or a failing one: 503, and the page shows no "Adds" line.

const AUTH_MESSAGES: AuthMessages = {
  missing: 'Not signed in.',
  empty: 'Invalid session.',
  invalid: 'Invalid token.',
  expired: 'Session expired.',
};

const STYLES: ReadonlySet<string> = new Set(GENERATION_STYLES.map((s) => s.promptStyle));
export const RATE_LIMIT_PER_MINUTE = 120;
const windows = new Map<string, { start: number; count: number }>();

/** For tests only: forget this isolate's lookup counts. */
export function resetCreateWordsRouteState(): void {
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

  if (overLimit(auth.userId, Date.now())) return json(429, { success: false, error: 'rate_limited' });

  const answer = await askCreateWords(process.env as Record<string, unknown>, { style, promptSpec: ids });
  if (answer.kind === 'unavailable') return json(503, { success: false, error: 'unavailable' });
  return answer.kind === 'ok'
    ? json(200, { success: true, adds: answer.adds, version: answer.version })
    : json(200, { success: false, reason: answer.reason, version: answer.version });
}
