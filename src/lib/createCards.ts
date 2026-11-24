/**
 * Create Sprite's "What's it for?" cards and fine-tune rows (G2), page side.
 * DESIGN, design/generate-pass/generate-pass.md 2.1 to 2.5, approved by HQ
 * (room 2026-11-18-079).
 *
 * Open core (HQ 2026-11-18-049, -056): the words a card and its rows add to
 * the description, and how they combine, are private; they live in the
 * private generation service. This file holds only the ids the page sends,
 * the words people read on the page (card names and lines, chip labels,
 * notes) and the rules for which choices show. The "Adds" line's words come
 * from GET /api/create-words. Pure, so node tests it
 * (scripts/create-cards-test.mjs).
 */

import type { Payload } from './sseClient';
import type { GenerationStyle } from './styleRegistry';

export type CreateCardId = 'platformer' | 'topdown' | 'portrait' | 'raw';
export type CreateViewId = 'front' | 'side' | 'three_quarter' | 'back' | 'topdown';
export type CreateFramingId = 'full' | 'waist' | 'head';

/** The cards, in the grid's order (2.2). */
export const CREATE_CARDS: readonly { id: CreateCardId; name: string; line: string }[] = [
  { id: 'platformer', name: 'Side-scroller or platformer', line: 'Side view, facing right, full body. Made for animating.' },
  { id: 'topdown', name: 'Top-down RPG', line: 'Front view, full body, the way top-down RPGs draw characters.' },
  { id: 'portrait', name: 'Portrait or icon', line: 'Front view, head and shoulders.' },
  { id: 'raw', name: 'Just a sprite', line: 'Your words, nothing added.' },
];

/** George's pick (2.2). */
export const DEFAULT_CARD: CreateCardId = 'platformer';

/** The fine-tune rows (2.3), in their order. */
export const CREATE_VIEWS: readonly { id: CreateViewId; label: string }[] = [
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'three_quarter', label: 'Three-quarter' },
  { id: 'back', label: 'Back' },
  { id: 'topdown', label: 'From above' },
];
export const CREATE_FRAMINGS: readonly { id: CreateFramingId; label: string }[] = [
  { id: 'full', label: 'Full body' },
  { id: 'waist', label: 'Waist up' },
  { id: 'head', label: 'Head only' },
];

/** Each card's own row values: what the rows show as checked when the card
 *  is chosen (2.3: "the Top-down card checks View: From above"). "Just a
 *  sprite" has none. */
export const CARD_ROWS: Readonly<Record<Exclude<CreateCardId, 'raw'>, { view: CreateViewId; framing: CreateFramingId }>> = {
  platformer: { view: 'side', framing: 'full' },
  topdown: { view: 'topdown', framing: 'full' },
  portrait: { view: 'front', framing: 'head' },
};

/** The one style that keeps Waist up (2.3, G5). */
export const WAIST_STYLE_ID = 'pro-default';
/** The character style the cards do not apply to (2.2). */
export const SPRITE_COLLECTION_ID = 'pro-spritesheet';

/** The words on the page (2.1 to 2.5). */
export const DESCRIBE_PLACEHOLDER = 'a knight in silver armor with a red cape';
export const GREYED_CARDS_LINE = 'This style draws as it is. Nothing is added.';
export const UNDER_CARDS_LINE = 'Making an item, tile or icon? Pick its style in step 3.';
export const CHANGED_LINE = 'Changed in fine-tune below.';
export const FINE_TUNE_LINK = 'Fine-tune view and framing';
export const RAW_ROWS_LINE = 'Pick another card to fine-tune.';
export const WAIST_LINE = 'Waist up works on Character (Pro). This style draws the full body.';
export const FAST_THREE_QUARTER_LINE = 'Fast styles often miss three-quarter views.';
export const ADDS_NOTHING_RAW = 'Adds nothing. Your words go as you wrote them.';
export const ADDS_NOTHING_STYLE = 'Adds nothing for this style.';
export const MORE_SETTINGS_LABEL = 'More settings: size, background, reference images';

/** Fine-tune and More settings, open or closed, per browser (2.3, 2.4). */
export const FINE_TUNE_OPEN_KEY = 'spritebrew_create_finetune_open_v1';
export const MORE_OPEN_KEY = 'spritebrew_create_more_open_v1';

/** What the person has chosen: a card and, for every card but "Just a
 *  sprite", the rows' values. */
export interface CreateChoice {
  card: CreateCardId;
  view: CreateViewId | null;
  framing: CreateFramingId | null;
}

/** A card chosen: the rows reset to its values (2.3). */
export function cardChoice(card: CreateCardId): CreateChoice {
  if (card === 'raw') return { card, view: null, framing: null };
  return { card, ...CARD_ROWS[card] };
}

export const DEFAULT_CHOICE: CreateChoice = cardChoice(DEFAULT_CARD);

/** Whether the cards and rows apply to this style: the character styles but
 *  Sprite Collection (2.2). */
export function cardsApply(style: Pick<GenerationStyle, 'id' | 'category' | 'isAnimation'>): boolean {
  return style.category === 'characters' && !style.isAnimation && style.id !== SPRITE_COLLECTION_ID;
}

export function waistAllowed(styleId: string): boolean {
  return styleId === WAIST_STYLE_ID;
}

/** The rows as they apply with this style: Waist up only where the style
 *  keeps it, otherwise the card's own framing. "Just a sprite" has none. */
export function effectiveRows(choice: CreateChoice, styleId: string): { view: CreateViewId; framing: CreateFramingId } | null {
  if (choice.card === 'raw') return null;
  const own = CARD_ROWS[choice.card];
  const view = choice.view ?? own.view;
  const framing = choice.framing === 'waist' && !waistAllowed(styleId) ? own.framing : choice.framing ?? own.framing;
  return { view, framing };
}

/** A row picked: the card stays, the row changes. Nothing under "Just a
 *  sprite", and Waist up only where the style keeps it. */
export function pickView(choice: CreateChoice, view: CreateViewId): CreateChoice {
  if (choice.card === 'raw') return choice;
  return { ...choice, view };
}
export function pickFraming(choice: CreateChoice, framing: CreateFramingId, styleId: string): CreateChoice {
  if (choice.card === 'raw') return choice;
  if (framing === 'waist' && !waistAllowed(styleId)) return choice;
  return { ...choice, framing };
}

/** Whether a row differs from the chosen card's own (2.2: the card's line
 *  then reads "Changed in fine-tune below."). */
export function changedInFineTune(choice: CreateChoice, styleId: string): boolean {
  const rows = effectiveRows(choice, styleId);
  if (!rows || choice.card === 'raw') return false;
  const own = CARD_ROWS[choice.card];
  return rows.view !== own.view || rows.framing !== own.framing;
}

/** The ids the page sends (HQ -049): the card, and each row only where it
 *  differs from the card's own (null means the card's own). None for "Just
 *  a sprite" or a style the cards do not apply to: those send the
 *  description as today. */
export interface CreateSpecIds {
  card: Exclude<CreateCardId, 'raw'>;
  view: CreateViewId | null;
  framing: CreateFramingId | null;
}

export function specFor(choice: CreateChoice, style: Pick<GenerationStyle, 'id' | 'category' | 'isAnimation'>): CreateSpecIds | null {
  if (!cardsApply(style) || choice.card === 'raw') return null;
  const rows = effectiveRows(choice, style.id)!;
  const own = CARD_ROWS[choice.card];
  return {
    card: choice.card,
    view: rows.view === own.view ? null : rows.view,
    framing: rows.framing === own.framing ? null : rows.framing,
  };
}

/** The key one "Adds" lookup answers for. */
export function wordsKey(promptStyle: string, spec: CreateSpecIds): string {
  return `${promptStyle}|${spec.card}|${spec.view ?? ''}|${spec.framing ?? ''}`;
}

/** GET /api/create-words's query for one lookup. */
export function wordsQuery(promptStyle: string, spec: CreateSpecIds): string {
  const q = new URLSearchParams({ style: promptStyle, card: spec.card, view: spec.view ?? '', framing: spec.framing ?? '' });
  return `/api/create-words?${q.toString()}`;
}

/** One lookup's answer, as the page uses it. */
export type WordsAnswer =
  | { state: 'none' }
  | { state: 'loading' }
  | { state: 'ok'; adds: string; version: string }
  | { state: 'refused'; version: string }
  | { state: 'unavailable' };

/** Reads the route's answer. Anything but a well-formed 200 is unavailable:
 *  then the page shows no words from the service and sends no ids (HQ -056
 *  change 6). */
export function readWordsAnswer(status: number, json: unknown): WordsAnswer {
  if (status !== 200 || json === null || typeof json !== 'object') return { state: 'unavailable' };
  const j = json as Record<string, unknown>;
  if (typeof j.version !== 'string' || j.version === '') return { state: 'unavailable' };
  if (j.success === true && typeof j.adds === 'string') return { state: 'ok', adds: j.adds, version: j.version };
  if (j.success === false && typeof j.reason === 'string') return { state: 'refused', version: j.version };
  return { state: 'unavailable' };
}

/** Whether the cards and rows are greyed: only a style they do not apply
 *  to. A failed lookup greys nothing: the choice stays, the line says
 *  nothing is added, and another card can be chosen, which asks at once
 *  (AUDIT g2-page-r1 M2). */
export function cardsGreyed(applies: boolean): boolean {
  return !applies;
}

/** The "Adds" line under the description (2.1). Empty while a lookup is
 *  out or was refused. */
export function addsLine(applies: boolean, card: CreateCardId, words: WordsAnswer): string {
  if (!applies) return ADDS_NOTHING_STYLE;
  if (card === 'raw') return ADDS_NOTHING_RAW;
  if (words.state === 'unavailable') return ADDS_NOTHING_RAW;
  if (words.state === 'ok') return words.adds.trim() === '' ? ADDS_NOTHING_STYLE : `Adds: ${words.adds}`;
  return '';
}

/** The line on screen while a new choice's lookup is out: the last line
 *  shown, marked as checking, so the cards and rows below do not move under
 *  the finger (AUDIT g2-page-r1 M1). Otherwise the line itself. */
export function shownAddsLine(line: string, words: WordsAnswer, held: string): { text: string; checking: boolean } {
  if (line !== '' || words.state !== 'loading' || held === '') return { text: line, checking: false };
  return { text: held, checking: true };
}

/** What the result card reads after a Generate (G0's setLastCreate; DESIGN
 *  room 2026-11-24-016, builder-create.md 8): the facing the View asked for
 *  (Side faces right; Back and anything else, none) and the subject, the
 *  description. "Just a sprite" and a style the cards do not apply to: none
 *  and none, as a description of the person's own. */
export type LastCreateFacing = 'right' | 'front' | 'three-quarter' | 'top-down' | null;
const FACING_OF_VIEW: Readonly<Record<CreateViewId, LastCreateFacing>> = {
  side: 'right',
  front: 'front',
  three_quarter: 'three-quarter',
  topdown: 'top-down',
  back: null,
};
export function lastCreateFor(
  style: Pick<GenerationStyle, 'id' | 'category' | 'isAnimation'>,
  choice: CreateChoice,
  description: string
): { facing: LastCreateFacing; subject: string | null } {
  const rows = cardsApply(style) ? effectiveRows(choice, style.id) : null;
  if (!rows) return { facing: null, subject: null };
  return { facing: FACING_OF_VIEW[rows.view], subject: description };
}

/** What a press of Generate sends besides the description: the ids, and
 *  the table version the "Adds" line showed, when it showed one. Nothing
 *  when no ids apply or the service did not answer. */
export function specToSend(spec: CreateSpecIds | null, words: WordsAnswer): { spec: CreateSpecIds; version?: string } | null {
  if (!spec || words.state === 'unavailable' || words.state === 'none') return null;
  if (words.state === 'ok' || words.state === 'refused') return { spec, version: words.version };
  return { spec };
}

/**
 * The request body with the page's ids (ENG, PR #81): the description goes
 * as `description` in place of `prompt`, so a route that does not know cards
 * refuses it rather than charging for the bare text; then the ids and the
 * version. Without ids, the body as built. Every other key, and its value,
 * is the body's own.
 */
export function withCreateSpec(body: Payload, send: { spec: CreateSpecIds; version?: string } | null): Payload {
  if (!send) return body;
  const out: Payload = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'prompt') out.description = v;
    else out[k] = v;
  }
  out.promptSpec = { card: send.spec.card, view: send.spec.view, framing: send.spec.framing };
  if (send.version) out.wordsVersion = send.version;
  return out;
}

/** The side-view line under the Style field (2.5), and the styles it may
 *  offer, while the card or the View row is Side. Untested styles: none. */
export interface StyleLine {
  text: string;
  offers: readonly string[];
}
const SIDE_LINES: Readonly<Record<string, StyleLine>> = {
  'fast-retro': { text: 'Retro Arcade faces right about 3 times in 4.', offers: [] },
  'plus-classic': {
    text: 'Classic Pixel Art faces right about half the time, often on a patch of ground. For a side view, Retro Arcade or Platformer keep it better.',
    offers: ['fast-retro', 'pro-platformer'],
  },
  'pro-default': {
    text: 'Character (Pro) faces right, usually in a three-quarter fighting stance. Platformer draws the calmest side view.',
    offers: ['pro-platformer'],
  },
};

export function sideViewLine(style: Pick<GenerationStyle, 'id' | 'category' | 'isAnimation'>, choice: CreateChoice): StyleLine | null {
  if (!cardsApply(style)) return null;
  const rows = effectiveRows(choice, style.id);
  if (!rows || rows.view !== 'side') return null;
  return SIDE_LINES[style.id] ?? null;
}

/** "Fast styles often miss three-quarter views." (2.3, builder-create.md 4). */
export function fastThreeQuarter(style: Pick<GenerationStyle, 'id' | 'category' | 'isAnimation' | 'tier'>, choice: CreateChoice): boolean {
  if (!cardsApply(style) || style.tier !== 'fast') return false;
  return effectiveRows(choice, style.id)?.view === 'three_quarter';
}

/** A choice read back from the visit, or the default where it is not one. */
export function validChoice(raw: unknown): CreateChoice {
  if (!raw || typeof raw !== 'object') return DEFAULT_CHOICE;
  const r = raw as Record<string, unknown>;
  const card = CREATE_CARDS.find((c) => c.id === r.card)?.id;
  if (!card) return DEFAULT_CHOICE;
  if (card === 'raw') return cardChoice('raw');
  const view = CREATE_VIEWS.find((v) => v.id === r.view)?.id;
  const framing = CREATE_FRAMINGS.find((f) => f.id === r.framing)?.id;
  if (!view || !framing) return cardChoice(card);
  return { card, view, framing };
}
