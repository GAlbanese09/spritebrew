/**
 * The style a new account's Create form opens on, and the note under the
 * style field while the balance is below the default style's cost (HQ room
 * 2026-11-09-020). Pure: every id and number comes from styleRegistry and
 * constants, so a price change moves the note with it.
 */

import { getStyleById, type GenerationStyle } from '@/lib/styleRegistry';
import { DAILY_LOGIN_TOKENS, EMAIL_LIST_BONUS_TOKENS } from '@/lib/constants';

/** The form's default style. */
export const DEFAULT_STYLE_ID = 'plus-classic';
/** The styles a short balance may open on, in order: the default first. */
export const OPENING_CANDIDATES = [DEFAULT_STYLE_ID, 'fast-retro'] as const;

function style(id: string): GenerationStyle {
  const s = getStyleById(id);
  if (!s) throw new Error(`affordableStyle: ${id} is not in the registry`);
  return s;
}

const plural = (n: number) => `${n.toLocaleString('en-US')} token${n === 1 ? '' : 's'}`;

/**
 * The style the form should show once the server's balance is known. The
 * person's own pick, or any style other than the default, is kept; so is the
 * default when the balance covers it. Otherwise the first candidate the
 * balance covers, or the default when none is covered.
 */
export function openingStyle({ balance, currentId, picked }: {
  balance: number;
  currentId: string;
  picked: boolean;
}): string {
  if (picked || currentId !== DEFAULT_STYLE_ID) return currentId;
  if (balance >= style(DEFAULT_STYLE_ID).tokenCost) return currentId;
  const covered = OPENING_CANDIDATES.find((id) => balance >= style(id).tokenCost);
  return covered ?? DEFAULT_STYLE_ID;
}

/**
 * The note under the style field, or null when the balance covers the
 * default style. Says what the person has, what is ready and how to get
 * more; the newsletter is left out once it has been claimed.
 */
export function affordableNote({ balance, emailListClaimed }: {
  balance: number;
  emailListClaimed: boolean;
}): string | null {
  const classic = style(DEFAULT_STYLE_ID);
  if (balance >= classic.tokenCost) return null;
  const fast = style(OPENING_CANDIDATES[1]);
  const more = `+${DAILY_LOGIN_TOKENS} a day${emailListClaimed ? '' : `, +${EMAIL_LIST_BONUS_TOKENS} for the newsletter`}`;
  if (balance >= fast.tokenCost) {
    const tier = fast.tier.charAt(0).toUpperCase() + fast.tier.slice(1);
    return `You have ${plural(balance)}: ${tier} styles are ready. ${classic.label} needs ${classic.tokenCost} (${more}).`;
  }
  return `You have ${plural(balance)}. ${fast.label} needs ${fast.tokenCost} (${more}).`;
}
