import { readWordsAnswer, wordsKey, wordsQuery, type CreateSpecIds, type WordsAnswer } from '@/lib/createCards';

/**
 * The "Adds" lookup for Create Sprite's card and rows (G2), from GET
 * /api/create-words (ENG, PR #81), with no React in it so a test drives it
 * on a stand-in (AUDIT g2-page-r1 M3). useCreateWords.ts is its hook.
 *
 * - Each lookup goes past the browser's cache (`cache: 'no-store'`): the page
 *   keeps its own answers, and a cached answer from before a words table
 *   change would be refused at Generate every time (r1 H1).
 * - A well-formed answer is kept for this page load by its own key, ten
 *   minutes, as the route keeps it; an answer that lands after the choice
 *   moved on is kept too (r1 L9). The answer on screen is asked again when it
 *   is ten minutes old.
 * - A new choice is asked after a short pause, so a held arrow key asks once
 *   (r1 L9). No answer in eight seconds is no answer (r1 L2).
 * - No answer (no service, a failure, the rate limit) is "unavailable" and is
 *   asked again after 20 s, then 40, 80, 160 and every 5 minutes (r1 L3).
 * - `renew` forgets every kept answer and asks again at once: the page calls
 *   it when Generate says the words changed (r1 H1).
 */

export const KEEP_MS = 10 * 60_000;
export const ANSWER_TIMEOUT_MS = 8_000;
export const ASK_AFTER_MS = 150;
const RETRY_STEPS_MS = [20_000, 40_000, 80_000, 160_000, 300_000] as const;

/** The pause before asking again after the n-th unanswered lookup in a row. */
export function retryDelay(failures: number): number {
  const i = Math.min(Math.max(failures, 1), RETRY_STEPS_MS.length) - 1;
  return RETRY_STEPS_MS[i];
}

type Timer = unknown;

/** The browser boundary, passed in. */
export interface LookupDeps {
  fetch: (url: string, init: RequestInit) => Promise<{ status: number; json: () => Promise<unknown> }>;
  getToken: () => Promise<string | null>;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => Timer;
  clearTimer: (t: Timer) => void;
}

/** One lookup: the session token, past the browser's cache, eight seconds at most. */
export async function lookupWords(deps: LookupDeps, promptStyle: string, spec: CreateSpecIds): Promise<WordsAnswer> {
  const controller = new AbortController();
  const timer = deps.setTimer(() => controller.abort(), ANSWER_TIMEOUT_MS);
  try {
    const token = await deps.getToken();
    const res = await deps.fetch(wordsQuery(promptStyle, spec), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
      signal: controller.signal,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch { /* not JSON: unavailable */ }
    return readWordsAnswer(res.status, json);
  } catch {
    return { state: 'unavailable' };
  } finally {
    deps.clearTimer(timer);
  }
}

/** The answers kept for this page load, by key. Only well-formed answers. */
export class KeptWords {
  private readonly map = new Map<string, { at: number; answer: WordsAnswer }>();

  get(key: string, now: number): { at: number; answer: WordsAnswer } | null {
    const k = this.map.get(key);
    if (!k) return null;
    if (now - k.at >= KEEP_MS) {
      this.map.delete(key);
      return null;
    }
    return k;
  }

  set(key: string, answer: WordsAnswer, at: number): void {
    if (answer.state === 'ok' || answer.state === 'refused') this.map.set(key, { at, answer });
  }

  drop(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

/** The page's kept answers (one page load). */
export const pageKeptWords = new KeptWords();

export interface LastWords {
  key: string;
  answer: WordsAnswer;
}

/** What the page shows for the choice it renders: the last answer only when
 *  it is this choice's (the key guard); nothing to look up gives "none". */
export function shownWords(key: string | null, last: LastWords | null): WordsAnswer {
  if (!key) return { state: 'none' };
  if (last && last.key === key) return last.answer;
  return { state: 'loading' };
}

/**
 * The lookup's state for one form: the choice it asks for, the last answer
 * (by its key), the timers. Subscribe and `last` suit useSyncExternalStore.
 */
export class WordsLookup {
  private key: string | null = null;
  private style = '';
  private spec: CreateSpecIds | null = null;
  private lastWords: LastWords | null = null;
  private timer: Timer | null = null;
  private gen = 0;
  private failures = { key: '', n: 0 };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: LookupDeps, private readonly kept: KeptWords = pageKeptWords) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  last = (): LastWords | null => this.lastWords;

  /** The choice the form shows; a new key asks after a short pause, or at
   *  once from a kept answer. */
  choose(promptStyle: string, spec: CreateSpecIds | null): void {
    const key = spec ? wordsKey(promptStyle, spec) : null;
    if (key === this.key) return;
    this.key = key;
    this.style = promptStyle;
    this.spec = spec;
    this.cancel();
    this.ask(ASK_AFTER_MS);
  }

  /** Forget every kept answer and ask again at once (the words changed). */
  renew(): void {
    this.kept.clear();
    this.lastWords = null;
    this.emit();
    this.cancel();
    this.ask(0);
  }

  /** Stops the timers and forgets the choice, so a later `choose` (React's
   *  dev remount) asks again. Listeners leave by their own unsubscribe. */
  dispose(): void {
    this.cancel();
    this.key = null;
    this.spec = null;
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private cancel(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.gen += 1;
  }

  private ask(delay: number): void {
    const { key, style, spec } = this;
    if (!key || !spec) return;
    const g = this.gen;
    const known = this.kept.get(key, this.deps.now());
    if (known) {
      this.settle(g, key, known.answer, known.at);
      return;
    }
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void lookupWords(this.deps, style, spec).then((answer) => {
        const at = this.deps.now();
        this.kept.set(key, answer, at);
        if (g === this.gen) this.settle(g, key, answer, at);
      });
    }, delay);
  }

  private settle(g: number, key: string, answer: WordsAnswer, at: number): void {
    this.lastWords = { key, answer };
    this.emit();
    if (answer.state === 'unavailable') {
      const n = this.failures.key === key ? this.failures.n + 1 : 1;
      this.failures = { key, n };
      this.timer = this.deps.setTimer(() => {
        this.timer = null;
        if (g === this.gen) this.ask(0);
      }, retryDelay(n));
      return;
    }
    this.failures = { key: '', n: 0 };
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      if (g !== this.gen) return;
      this.kept.drop(key);
      this.ask(0);
    }, Math.max(0, at + KEEP_MS - this.deps.now()));
  }
}
