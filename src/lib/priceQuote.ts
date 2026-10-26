// The price the page showed, checked against the price the server charges
// (price-50 006, Second 077). The server alone sets the charge; a client number
// never sets it. A request whose price differs from the charge is refused before
// any money moves, so the button can never say less than we charge.

export const PRICE_CHANGED_MESSAGE =
  'Prices have changed since this page loaded. Refresh the page to see the current price.';

// A page loaded before this release sends no price, so a request for a style whose
// price changed in this release and that carries no price is refused. The set can
// go at the next release that touches this file.
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
