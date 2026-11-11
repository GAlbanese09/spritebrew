/**
 * The result card's image and the versions kept beside it. Pure, so it is
 * tested offline (scripts/card-image-test.mjs); the sprite store holds the
 * fields and calls these.
 *
 * A result arrives as delivered. An editor save puts the edit on the card and
 * keeps the sheet from before it, so the card can show either ("Edited" and
 * "Before edit") and "Download original" still gives the delivered sheet.
 * Nothing here is lost until a new result arrives or the card is cleared.
 */

export type CardVersion = 'edited' | 'before';

export interface CardImage {
  /** The image the card shows and every button acts on. */
  shown: string | null;
  /** The sheet as delivered, kept from the first change to `shown`; null
   *  while `shown` is the delivered sheet itself. */
  original: string | null;
  /** The latest editor save; null until there is one. */
  edited: string | null;
  /** The card's sheet from before the first editor save; null until then. */
  beforeEdit: string | null;
  /** Which of the two `shown` is; null while there is no editor save. */
  version: CardVersion | null;
}

export const EMPTY_CARD: CardImage = { shown: null, original: null, edited: null, beforeEdit: null, version: null };

/** A new result: nothing of the previous one is kept. */
export function newResult(dataUrl: string): CardImage {
  return { ...EMPTY_CARD, shown: dataUrl };
}

/** An editor save: the edit is shown; the sheet from before the first save
 *  and the delivered sheet are kept. A later save replaces the edit only.
 *  With no result on the card there is nothing to save onto. */
export function saveEdit(card: CardImage, dataUrl: string): CardImage {
  if (!card.shown) return card;
  return {
    shown: dataUrl,
    original: card.original ?? card.shown,
    edited: dataUrl,
    beforeEdit: card.beforeEdit ?? card.shown,
    version: 'edited',
  };
}

/** Show the other version. No change without an editor save, or for the
 *  version already shown. */
export function showVersion(card: CardImage, version: CardVersion): CardImage {
  if (card.version === null || card.version === version) return card;
  const shown = version === 'edited' ? card.edited : card.beforeEdit;
  if (!shown) return card;
  return { ...card, shown, version };
}

/** The shown image is replaced by one made from it for a handoff (the
 *  card's own background removal on the way to the Slicer or the Animator).
 *  It takes the place of the version shown; the delivered sheet is kept. */
export function replaceShown(card: CardImage, dataUrl: string): CardImage {
  if (!card.shown || dataUrl === card.shown) return card;
  const original = card.original ?? card.shown;
  if (card.version === 'edited') return { ...card, shown: dataUrl, original, edited: dataUrl };
  if (card.version === 'before') return { ...card, shown: dataUrl, original, beforeEdit: dataUrl };
  return { ...card, shown: dataUrl, original };
}

/** What "Download original" saves: the delivered sheet. */
export function deliveredOf(card: CardImage): string | null {
  return card.original ?? card.shown;
}

/** The same for every image of one result (the delivered sheet), so what the
 *  user set on the card for a result survives an editor save and a switch
 *  between versions. */
export function resultKeyOf(card: CardImage): string | null {
  return card.original ?? card.shown;
}
