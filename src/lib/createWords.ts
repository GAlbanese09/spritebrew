// src/lib/createWords.ts
//
// Create Sprite's "What's it for?" card and fine-tune rows (G2), server side.
// HQ 2026-11-18-049 and -056 (open core, C21 as amended Nov 18): the words
// these ids stand for, and the rules that combine them, live in the private
// generation service. This app holds only the ids. It never builds, stores
// or logs a prompt word; it asks the private side through the CREATE_WORDS
// service binding and passes on what it answers.
//
// - The "Adds" line: GET /api/create-words asks for the words a spec adds.
// - The generate route: before any admission or debit, it asks whether the
//   spec and the description make a prompt the service accepts. A refusal is
//   answered with nothing charged; so is a missing or failing binding, so a
//   card the person chose is never dropped silently (HQ -056, changes 3 and 6).

/** The ids the page sends. Ids only; no words. */
export const CREATE_CARDS = ['platformer', 'topdown', 'portrait', 'raw'] as const;
export const CREATE_VIEWS = ['front', 'side', 'three_quarter', 'back', 'topdown'] as const;
export const CREATE_FRAMINGS = ['full', 'waist', 'head'] as const;

export interface CreateSpecIds {
  card: (typeof CREATE_CARDS)[number];
  view: (typeof CREATE_VIEWS)[number] | null;
  framing: (typeof CREATE_FRAMINGS)[number] | null;
}

/** The refusals the private side may answer. */
export const CREATE_REFUSALS = ['spec', 'description', 'framing_style', 'too_long'] as const;
export type CreateRefusal = (typeof CREATE_REFUSALS)[number];

/**
 * The spec's shape: an object with exactly `card`, `view` and `framing`, ids
 * from the lists above or null; "Just a sprite" (`raw`) takes no rows. The
 * private side checks it again against its own table.
 */
export function parseCreateSpecIds(raw: unknown): CreateSpecIds | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const keys = Object.keys(raw).sort();
  if (keys.length !== 3 || keys[0] !== 'card' || keys[1] !== 'framing' || keys[2] !== 'view') return null;
  const { card, view, framing } = raw as Record<string, unknown>;
  if (typeof card !== 'string' || !(CREATE_CARDS as readonly string[]).includes(card)) return null;
  if (view !== null && (typeof view !== 'string' || !(CREATE_VIEWS as readonly string[]).includes(view))) return null;
  if (framing !== null && (typeof framing !== 'string' || !(CREATE_FRAMINGS as readonly string[]).includes(framing))) return null;
  if (card === 'raw' && (view !== null || framing !== null)) return null;
  return { card, view, framing } as CreateSpecIds;
}

export type CreateWordsAnswer =
  | { kind: 'ok'; adds: string; length?: number; version: string }
  | { kind: 'refused'; reason: CreateRefusal; version: string }
  | { kind: 'unavailable' };

interface ServiceBinding {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

/** How long the route waits for the private side before it counts as down. */
export const CREATE_WORDS_TIMEOUT_MS = 3000;

/**
 * Asks the private side. `description` present: the check before a debit
 * (the answer carries the final prompt's length). Absent: an "Adds" lookup.
 * Anything but a well-formed answer, including a missing binding, a timeout
 * or a non-200, is `unavailable`. Never throws.
 */
export async function askCreateWords(
  env: Record<string, unknown>,
  input: { style: string; promptSpec: CreateSpecIds; description?: string }
): Promise<CreateWordsAnswer> {
  const binding = env.CREATE_WORDS as ServiceBinding | undefined;
  if (!binding || typeof binding.fetch !== 'function') return { kind: 'unavailable' };
  try {
    const res = await binding.fetch('https://create-words.internal/create-words', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(CREATE_WORDS_TIMEOUT_MS),
    });
    // The service bounds its request body; only a description past any length
    // the page allows reaches that bound (AUDIT g2 r1 L2).
    if (res.status === 413) return { kind: 'refused', reason: 'too_long', version: '' };
    if (res.status !== 200) return { kind: 'unavailable' };
    const j = (await res.json()) as Record<string, unknown>;
    if (typeof j.version !== 'string' || j.version === '') return { kind: 'unavailable' };
    const version = j.version;
    if (j.ok === true && typeof j.adds === 'string') {
      if (input.description === undefined) return { kind: 'ok', adds: j.adds, version };
      if (typeof j.length === 'number' && Number.isInteger(j.length) && j.length >= 0) {
        return { kind: 'ok', adds: j.adds, length: j.length, version };
      }
      return { kind: 'unavailable' };
    }
    if (j.ok === false && typeof j.reason === 'string' && (CREATE_REFUSALS as readonly string[]).includes(j.reason)) {
      return { kind: 'refused', reason: j.reason as CreateRefusal, version };
    }
    return { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** The words people read when the route refuses a spec. Nothing is charged
 *  in any of these cases. DESIGN to approve (open with ENG's READY). */
export const CREATE_SPEC_MESSAGES: Readonly<Record<CreateRefusal | 'unavailable' | 'changed', string>> = {
  spec: 'This choice could not be used. Refresh the page and try again. You were not charged.',
  description: 'This choice could not be used. Refresh the page and try again. You were not charged.',
  framing_style: 'Waist up works on Character (Pro). This style draws the full body. Pick another framing. You were not charged.',
  too_long: 'Your description is too long. Shorten it and try again. You were not charged.',
  unavailable: 'We could not start this generation. You were not charged. Please try again in a moment.',
  changed: 'The options were just updated. Refresh the page and try again. You were not charged.',
};
