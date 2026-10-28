/**
 * The low-balance banner on /generate (HQ 2026-10-27-021 and -023, George's
 * words): a paid account whose balance is below LOW_BALANCE_THRESHOLD sees
 * one line and a button to Buy Tokens. "Not now" hides it until the balance
 * next falls below the threshold, so a dismissal ends once the balance is
 * seen at or above it. Pure, so it is tested offline
 * (scripts/low-balance-test.mjs); the banner itself is
 * src/components/sprites/LowBalanceBanner.tsx.
 */

/** Below this many tokens a paid account sees the banner. */
export const LOW_BALANCE_THRESHOLD = 25;

/** George's line (HQ 2026-10-27-023), with the balance in it. */
export function lowBalanceLine(balance: number): string {
  return `You're running low on tokens: ${balance} left, not enough for an animation.`;
}

export const LOW_BALANCE_BUTTON = 'Buy tokens';
export const LOW_BALANCE_DISMISS = 'Not now';

/** Whether the banner shows: an account that has paid (the balance read's
 *  hasPaid, false for a refund-locked or disputed account), a balance read
 *  for it below the threshold, and no dismissal still in force. */
export function showLowBalance(args: { hasPaid: boolean; balance: number | null; dismissed: boolean }): boolean {
  return args.hasPaid && args.balance !== null && args.balance < LOW_BALANCE_THRESHOLD && !args.dismissed;
}

/** A dismissal after a balance is seen: it ends once the balance is at or
 *  above the threshold, so the next fall below it shows the banner again. */
export function dismissedAfter(dismissed: boolean, balance: number | null): boolean {
  return dismissed && !(balance !== null && balance >= LOW_BALANCE_THRESHOLD);
}

/** Whether the banner starts dismissed: the account's kept "Not now", or a
 *  return from Checkout (`?purchase=success`, the page's query at mount),
 *  whose tokens may still be on their way. Either ends by dismissedAfter;
 *  only "Not now" is kept. */
export function initialDismissed(stored: boolean, search: string): boolean {
  return stored || new URLSearchParams(search).get('purchase') === 'success';
}

/** The localStorage key of an account's dismissal. */
export function lowBalanceDismissKey(userId: string): string {
  return `spritebrew_low_balance_dismissed_${userId}`;
}
