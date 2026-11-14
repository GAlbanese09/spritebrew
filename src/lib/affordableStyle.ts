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
 * The style the form should show for this balance (HQ room 2026-11-11-034).
 * Once the person has acted (picked a style, typed a prompt or tapped an
 * example), whatever is in the field. Until then the default when the
 * balance covers it, else the first candidate the balance covers, else the
 * default.
 */
export function openingStyle({ balance, currentId, acted }: {
  balance: number;
  currentId: string;
  acted: boolean;
}): string {
  if (acted) return currentId;
  const covered = OPENING_CANDIDATES.find((id) => balance >= style(id).tokenCost);
  return covered ?? DEFAULT_STYLE_ID;
}

/**
 * The note under the style field, or null when the balance covers the
 * default style. Says what the person has, which style is ready and how to
 * get more. The newsletter is offered only once the daily reward's answer is
 * known and says it is not claimed.
 */
export function affordableNote({ balance, emailListClaimed, emailListClaimKnown }: {
  balance: number;
  emailListClaimed: boolean;
  emailListClaimKnown: boolean;
}): string | null {
  const classic = style(DEFAULT_STYLE_ID);
  if (balance >= classic.tokenCost) return null;
  const fast = style(OPENING_CANDIDATES[1]);
  const newsletter = emailListClaimKnown && !emailListClaimed;
  const more = `+${DAILY_LOGIN_TOKENS} a day${newsletter ? `, +${EMAIL_LIST_BONUS_TOKENS} for the newsletter` : ''}`;
  if (balance >= fast.tokenCost) {
    return `You have ${plural(balance)}: ${fast.label} is ready at ${fast.tokenCost}. ${classic.label} needs ${classic.tokenCost} (${more}).`;
  }
  return `You have ${plural(balance)}. ${fast.label} needs ${fast.tokenCost} (${more}).`;
}
