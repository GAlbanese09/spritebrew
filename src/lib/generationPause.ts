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

// DRAFT COPY (HQ `2026-10-22-002`, scoped after Second 063): George approves it before the pause is turned on.
export const GENERATION_PAUSED_MESSAGE =
  "Sprite generation is paused while our AI provider is down for maintenance. New generations can't be started until it's back, so no tokens are spent on them. We'll turn it back on as soon as it's back.";

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

/**
 * Provider refusals the consumer does not retry (AUDIT rd-swap-r1 M1): a 4xx
 * other than 429 (`rd_400`, `rd_403`, ...) and a task the provider reports as
 * failed (`rd_200`). Trying again in a few minutes cannot fix these, so their
 * words suggest a change instead. Timeouts, orphaned submits, 429 and 5xx keep
 * upstreamFailureMessage's words.
 */
export function isProviderRefusal(errorCode?: string): boolean {
  if (typeof errorCode !== 'string') return false;
  if (errorCode === 'rd_200') return true;
  return /^rd_4\d\d$/.test(errorCode) && errorCode !== 'rd_429';
}

/**
 * The customer message for a provider failure, by form: the refusal words
 * (design/generate-pass/failure-lines.md, HQ 2026-11-17-236) for a refusal,
 * otherwise upstreamFailureMessage's. `text-animation` is Animate from Text,
 * the tab G1 adds; until then its jobs come through the Create Sprite form as
 * `generation`, and its other failures keep the generation words, as today.
 * Create Sprite's line ends " under More settings", where its size now sits
 * (G2; AUDIT rd-swap-r3's note, HQ 2026-11-18-056). Animate My Character's
 * gets the same words when G4 adds its More settings. Paused, the advice is
 * left out, as in upstreamFailureMessage.
 */
export function providerFailureMessage(
  kind: 'generation' | 'text-animation' | 'animation',
  refundedNote: string,
  errorCode?: string,
  paused: boolean = GENERATION_PAUSED
): string {
  if (!isProviderRefusal(errorCode)) {
    return upstreamFailureMessage(kind === 'animation' ? 'animation' : 'generation', refundedNote, paused);
  }
  const head = kind === 'generation' ? 'Generation failed' : 'Animation failed';
  const lead = `${head}: the AI service could not make this one.${refundedNote}`;
  if (paused) return lead;
  if (kind === 'generation') {
    return `${lead} You can try again, or change the description or the style, or the size under More settings.`;
  }
  if (kind === 'text-animation') {
    return `${lead} You can try again, or change the description or the animation.`;
  }
  return `${lead} You can try again, or change the picture or the action, or the frame count.`;
}

/**
 * Whether a failed job's text is the provider's, so a form shows
 * upstreamFailureMessage in its place. The consumer starts its provider
 * errors with "RD " and gives each provider failure an errorCode starting
 * "rd_". The code also catches the one provider text that does not start
 * "RD ", the orphaned-submit message (HQ 2026-11-17-029 and -033), so a
 * form never shows the provider's text as its message. The text itself still
 * reaches the status reply and the browser console (AUDIT rd-swap-r1 L5).
 */
export function isUpstreamFailure(rawMessage: string, errorCode?: string): boolean {
  return (
    rawMessage.startsWith('RD ') ||
    rawMessage.includes('inference_failed') ||
    rawMessage.includes('Unexpected response') ||
    rawMessage.includes('timed out') ||
    (typeof errorCode === 'string' && errorCode.startsWith('rd_'))
  );
}
