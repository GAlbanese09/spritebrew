/**
 * Generation pause for a provider outage (INCIDENT 2026-10-22). One switch:
 * NEXT_PUBLIC_GENERATION_PAUSED set to 1 (or true) in the Pages variables of
 * the environment, then a new deployment, since Next inlines NEXT_PUBLIC_
 * values at build time. Unset or any other value leaves everything as it was.
 *
 * While it is on:
 *   - GenerationPauseBanner shows the message on every page;
 *   - Generate and Animate are disabled with the message as their reason, and
 *     their click handlers return before doing anything;
 *   - fetchGeneration (src/lib/sseClient.ts) throws before any request, so no
 *     generation request leaves the page by any path;
 *   - the upstream-failure messages drop their "try again" advice.
 *
 * Client only. It is not the server's money pause (src/lib/moneyPause.ts) and
 * changes nothing on the server.
 */

// DRAFT COPY (HQ `2026-10-22-002`): George approves it before the pause is turned on.
export const GENERATION_PAUSED_MESSAGE =
  "Sprite generation is paused while our AI provider is down for maintenance. Your tokens are safe, and nothing is charged while it's paused. We'll turn it back on as soon as it's back.";

/** Reads the switch's value: on only for 1 or true, any case, spaces ignored. */
export function generationPausedFrom(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

// Written out in full so Next replaces it with the build's value.
export const GENERATION_PAUSED = generationPausedFrom(process.env.NEXT_PUBLIC_GENERATION_PAUSED);

/** Thrown by fetchGeneration while generation is paused; nothing was sent. */
export class GenerationPausedError extends Error {
  constructor() {
    super(GENERATION_PAUSED_MESSAGE);
    this.name = 'GenerationPausedError';
  }
}

/**
 * The customer message for an upstream (provider) failure. Unpaused it is the
 * text the forms showed before this change, word for word; paused, the advice
 * to try again is left out, since trying again cannot work until the pause
 * lifts.
 */
export function upstreamFailureMessage(
  kind: 'generation' | 'animation',
  refundedNote: string,
  paused: boolean = GENERATION_PAUSED
): string {
  if (kind === 'generation') {
    return paused
      ? `Generation failed due to a temporary issue with the AI service.${refundedNote}`
      : `Generation failed due to a temporary issue with the AI service.${refundedNote} Please try again in a few minutes.`;
  }
  return paused
    ? `Animation failed due to a temporary issue with the AI service.${refundedNote}`
    : `Animation failed due to a temporary issue with the AI service.${refundedNote} Please try again in a few minutes, or try a smaller frame count (6 or 8) if the issue persists.`;
}
