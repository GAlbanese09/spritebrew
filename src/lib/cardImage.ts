/**
 * The result card's image and the versions kept beside it. Pure, so it is
 * tested offline (scripts/edit-save-test.mjs); the sprite store holds the
 * fields and calls these.
 *
 * A result arrives as delivered. An editor save puts the edit on the card and
 * keeps the sheet from before it, so the card can show either ("Edited" and
 * "Before edit") and "Download original" still gives the delivered sheet.
 * Nothing here is lost until a new result arrives or the card is cleared.
 *
 * Two images are kept apart on purpose. `working` is the image the rest of
 * the app works on (the store's generatedImageDataUrl: what the Slicer, the
 * Animator and the forms read). It changes only with a new result, an editor
 * save and a handoff. Which version the card shows is a view: switching it
 * changes `version` and nothing else, so no reader of `working` takes a
 * switch for a new image (audit r1, findings 1, 2 and 6).
 */

export type CardVersion = 'edited' | 'before';

export interface CardImage {
  /** The image the rest of the app works on. */
  working: string | null;
  /** The sheet as delivered, kept from the first change to `working`; null
   *  while `working` is the delivered sheet itself. */
  original: string | null;
  /** The latest editor save; null until there is one. */
  edited: string | null;
  /** The card's sheet from before the first editor save; null until then. */
  beforeEdit: string | null;
  /** Which of the two the card shows; null while there is no editor save. */
  version: CardVersion | null;
}

export const EMPTY_CARD: CardImage = { working: null, original: null, edited: null, beforeEdit: null, version: null };

/** The image the card shows and every button on it acts on. */
export function shownOf(card: CardImage): string | null {
  if (card.version === 'edited') return card.edited;
  if (card.version === 'before') return card.beforeEdit;
  return card.working;
}

/** A new result: nothing of the previous one is kept. */
export function newResult(dataUrl: string): CardImage {
  return { ...EMPTY_CARD, working: dataUrl };
}

/** An editor save: the edit is shown and becomes the working image; the
 *  sheet from before the first save and the delivered sheet are kept. A
 *  later save replaces the edit only. With no result on the card there is
 *  nothing to save onto. */
export function saveEdit(card: CardImage, dataUrl: string): CardImage {
  if (!card.working) return card;
  return {
    working: dataUrl,
    original: card.original ?? card.working,
    edited: dataUrl,
    beforeEdit: card.beforeEdit ?? shownOf(card),
    version: 'edited',
  };
}

/** Show the other version: a view change only. No change without an editor
 *  save, or for the version already shown. */
export function showVersion(card: CardImage, version: CardVersion): CardImage {
  if (card.version === null || card.version === version) return card;
  return { ...card, version };
}

/** A handoff to another tool (the Slicer, the Animator): the image shown, or
 *  one made from it (the card's background removal), becomes the working
 *  image and takes the place of the version shown. The delivered sheet is
 *  kept. No change when that image is already both. */
export function handOff(card: CardImage, dataUrl: string): CardImage {
  if (!card.working) return card;
  if (dataUrl === card.working && dataUrl === shownOf(card)) return card;
  const original = card.original ?? card.working;
  if (card.version === 'edited') return { ...card, working: dataUrl, original, edited: dataUrl };
  if (card.version === 'before') return { ...card, working: dataUrl, original, beforeEdit: dataUrl };
  return { ...card, working: dataUrl, original };
}

/** What "Download original" saves: the delivered sheet. */
export function deliveredOf(card: CardImage): string | null {
  return card.original ?? card.working;
}

/** The same for every image of one result (the delivered sheet), so what the
 *  user set on the card for a result survives an editor save and a switch
 *  between versions. */
export function resultKeyOf(card: CardImage): string | null {
  return card.original ?? card.working;
}
