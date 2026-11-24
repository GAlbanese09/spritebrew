/**
 * What /generate's Create form remembers for this page load (HQ room
 * 2026-11-11-034, ENG 2026-11-11-043): the style in the field, whether the
 * person has acted (chosen a style, typed a prompt or tapped an example),
 * and, with the style, "What's it for?"'s card and fine-tune rows (G2,
 * generate-pass.md 2.3; createCards.ts).
 * The page rebuilds the form after every result and on every Create or
 * Animate switch; this lets it come back where the person was.
 *
 * Module state only, never persisted, so a reload starts over. Held for one
 * account: a read for another userId gives the empty state and drops what
 * was held. Without a userId nothing is read or written. Pure apart from its
 * own state, so node can test it (scripts/polish-pr2-test.mjs).
 */

export interface FormVisit {
  /** The style last in the field, or null when none is remembered. */
  styleId: string | null;
  /** True once the person has acted; never cleared in the visit. */
  acted: boolean;
  /** The card and rows last chosen, or null when none is remembered. Kept as
   *  given; the form checks it (createCards.ts validChoice). */
  choice: unknown;
}

type UserId = string | null | undefined;

export function createFormVisit() {
  let held: (FormVisit & { userId: string }) | null = null;

  /** This account's record, started empty when another account's was held. */
  const forUser = (userId: string) => {
    if (!held || held.userId !== userId) held = { userId, styleId: null, acted: false, choice: null };
    return held;
  };

  return {
    /** What this account's form had. Another account's record is dropped. */
    read(userId: UserId): FormVisit {
      if (!userId) return { styleId: null, acted: false, choice: null };
      if (held && held.userId !== userId) held = null;
      return held ? { styleId: held.styleId, acted: held.acted, choice: held.choice } : { styleId: null, acted: false, choice: null };
    },
    /** The style now in the field. */
    rememberStyle(userId: UserId, styleId: string): void {
      if (userId) forUser(userId).styleId = styleId;
    },
    /** The person acted. */
    rememberActed(userId: UserId): void {
      if (userId) forUser(userId).acted = true;
    },
    /** The card and rows now chosen. */
    rememberChoice(userId: UserId, choice: unknown): void {
      if (userId) forUser(userId).choice = choice;
    },
  };
}

/** The app's one visit memory, for this page load. */
export const formVisit = createFormVisit();
