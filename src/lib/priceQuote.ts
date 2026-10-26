// The price the page showed, checked against the price the server charges
// (price-50 006, Second 077). The server alone sets the charge; a client number
// never sets it. A request whose price differs from the charge is refused before
// any money moves, so the button can never say less than we charge.

export const PRICE_CHANGED_MESSAGE =
  'Prices have changed since this page loaded. Refresh the page to see the current price.';

// A page loaded before a price change sends no price, so a request with no price
// for a style whose price has changed is refused. Never remove a style from this
// set: an old tab can stay open across any number of releases. The set may be
// retired only by a rule that refuses every request with no price. Each later
// price change adds its styles here, and the page that sells them must send its price.
export const QUOTE_REQUIRED_STYLES: ReadonlySet<string> = new Set([
  'animation__any_animation',
  'animation__8_dir_rotation',
]);

/** True when the request must be refused: a price that is present but is not a
 *  number equal to the charge, or no price for a style in QUOTE_REQUIRED_STYLES. */
export function refusesPriceQuote(
  body: { expectedTokenCost?: unknown },
  promptStyle: string,
  tokenCost: number
): boolean {
  if (body.expectedTokenCost !== undefined) {
    return typeof body.expectedTokenCost !== 'number' || body.expectedTokenCost !== tokenCost;
  }
  return QUOTE_REQUIRED_STYLES.has(promptStyle);
}
