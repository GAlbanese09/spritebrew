/**
 * Prompt help for Animate's motion box (DESIGN, design/tickets/prompt-help-v1a.md;
 * HQ 2026-11-11-075). The picture decides which way an animation goes; the
 * motion text cannot. People still type directions there and spend tokens
 * on a result that ignores them, so the form says so as they type.
 *
 * Pure, no network: small word lists matched in the browser. A false alarm
 * costs one line of text, never tokens, and nothing here blocks Generate.
 * Tested in scripts/motion-words-test.mjs.
 */

/** What the motion text asks for that an animation cannot do. */
export type MotionCatch = 'directions' | 'direction' | null;

/** The actions whose result keeps the way the picture faces, so a direction
 *  word in the motion text is ignored. The others (crouch, destroy, subtle
 *  motion, a custom action) get no direction line. */
export const DIRECTION_ACTIONS: readonly string[] = ['walking', 'idle', 'attack', 'jump'];

/** Asking for more than one direction in so many words, on any action.
 *  "left and right" and "front and back" are not here: they are often
 *  about legs. */
const DIRECTIONS_PATTERNS: readonly RegExp[] = [
  /\b(?:8|eight|4|four)[ -]?direction(?:al|s)?\b/,
  /\bmulti[ -]?direction(?:al|s)?\b/,
  /\b(?:4|four)[ -]?angles?\b/,
];

/** Looser ways to ask for many directions. On Walk and Idle they are about
 *  facing; on the other actions they are usually about the motion itself
 *  ("pieces fly in all directions", "360 flip", "rotating blade", "8-way
 *  shot", "turnaround kick"), so they count only on these two (DESIGN, room
 *  2026-11-14-028 and the round 2 rulings). */
export const LOOSE_DIRECTIONS_ACTIONS: readonly string[] = ['walking', 'idle'];
const LOOSE_DIRECTIONS_PATTERNS: readonly RegExp[] = [
  /\b(?:all|every|both|multiple) directions?\b/,
  /\brotat(?:e|es|ed|ing|ion)\b/,
  /\b360\b/,
  /\b(?:8|eight|4|four)[ -]?ways?\b/,
  /\bturnarounds?\b/,
];

/** A side of the body is not a direction: "right hand", "left legs",
 *  "right-handed", "left hook", "left front paw". The word before it is
 *  taken with it (see TRAVEL). A part followed by a place ("to the right
 *  hand side", "the right-hand corner") is a direction and is left in. */
const BODY_SIDE = /(\b[a-z]+ )?\b(?:left|right)[ -]+(?:(?:front|back|hind)[ -]+)?(?:hand|arm|leg|foot|feet|eye|ear|fist|knee|shoulder|wing|claw|paw|hook|jab|uppercut|kick|wrist|elbow|hip|palm|finger|thumb|heel|toe|horn|tentacle|fin|hoof|tail)(?:s|ed)?\b(?![ -]+(?:side|corner|edge|wall|lane|half)\b)/g;

/** Verbs of travel. Right after one, "left" or "right" is where the
 *  character goes, whatever follows: "walk left arms swinging" is a
 *  direction, "raises left arm" is not. A miss costs the person tokens; a
 *  false alarm ("moves left arm") costs a line of text. */
const TRAVEL = /^(?:walk|walks|walked|walking|run|runs|ran|running|move|moves|moved|moving|go|goes|went|going|step|steps|stepped|stepping|march|marches|marched|marching|dash|dashes|dashed|dashing) $/;

/** Direction words and phrases, whole words only. */
const DIRECTION_PATTERNS: readonly RegExp[] = [
  /\b(?:left|right)(?:wards?)?\b/,
  /\bsideways\b/,
  /\bto (?:the|one|either) side\b/,
  /\b(?:side|front|back)[ -]?view\b/,
  /\btowards?\b/,
  /\b(?:forward|backward)s?\b/,
  /\bturn(?:s|ed|ing)?\b/,
  /\bfacing\b/,
];

/**
 * What to say about a motion text for an action: 'directions' when it asks
 * for more than one direction (it wins), 'direction' when it names a
 * direction on an action that keeps the picture's facing, else null.
 */
export function motionCatch(text: string, action: string): MotionCatch {
  // Any run of spaces, tabs, line breaks or underscores reads as one space,
  // and a hyphen with spaces round it as a hyphen, so a phrase on the lists
  // is caught however its words are spaced.
  const t = text.toLowerCase().replace(/[\s_]+/g, ' ').replace(/ ?- ?/g, '-');
  if (DIRECTIONS_PATTERNS.some((p) => p.test(t))) return 'directions';
  if (LOOSE_DIRECTIONS_ACTIONS.includes(action) && LOOSE_DIRECTIONS_PATTERNS.some((p) => p.test(t))) return 'directions';
  if (!DIRECTION_ACTIONS.includes(action)) return null;
  const withoutBodySides = t.replace(BODY_SIDE, (side: string, before: string | undefined) =>
    before !== undefined && TRAVEL.test(before) ? side : `${before ?? ''} `,
  );
  return DIRECTION_PATTERNS.some((p) => p.test(withoutBodySides)) ? 'direction' : null;
}

/** How long after the last key the line is worked out, so it does not
 *  flicker or get read out on every key. */
export const MOTION_CATCH_DELAY_MS = 400;

/** A line is read out once. The same line coming back is read out again
 *  only after it has been gone this long, so a word that grows ("turn" to
 *  "turning") is not announced twice. */
export const MOTION_SPEAK_AGAIN_MS = 3000;

/** How long the words stay in the read-out element: long enough to be
 *  picked up, then gone, so the line is not found twice on the page. */
export const MOTION_SPOKEN_CLEAR_MS = 1000;

/** The motion box's example text, by action. */
export function motionPlaceholder(action: string): string {
  switch (action) {
    case 'walking': return 'Leave blank, or say how: heavy steps, sneaking, limping';
    case 'idle': return 'Leave blank, or: breathing, cape blowing';
    case 'attack': return 'Leave blank, or: sword swing, punch';
    case 'jump': return 'Leave blank, or: high jump, hop';
    case 'custom_action': return 'Required: what it does, e.g. waving hello';
    default: return 'Leave blank, or a few words';
  }
}

/** The motion box's label. */
export function motionLabel(required: boolean): string {
  return required ? 'Motion description (required)' : 'Motion description (optional, less is more)';
}

/** The one help line under the box. */
export const MOTION_HELP = 'Say how it moves, not which way. The way it faces comes from the picture.';

/** The style a side view is made with, and the 4-direction walk's style
 *  (ids in styleRegistry); the lines take their names and costs from there. */
export const SIDE_VIEW_STYLE_ID = 'pro-platformer';
export const FOUR_ANGLE_STYLE_ID = 'anim-4angle-walking';

/** The line for a direction word. Create has no "Side, facing right"
 *  control until the builder ships, so the line says what to type there
 *  (DESIGN, room 2026-11-14-028). The cost reads number first, like the
 *  action cards on the form, and a no-break space keeps the number and its
 *  coin on one line. */
export function directionLine(styleLabel: string, cost: number): string {
  return `The animation keeps the way your character faces, so direction words in the motion box are ignored. To walk sideways, make a side view first: on Create, pick ${styleLabel} (${cost}\u00A0\u{1FA99}) and start your description with "facing right, side view, full body".`;
}

/** The line for a request for more than one direction. The 4-direction
 *  style draws a new character from text; it cannot use the person's
 *  picture, and the line says so. */
export function directionsLine(styleLabel: string, cost: number): string {
  return `One animation makes one direction. For each other direction, make a picture of your character facing that way and animate it. For a new character walking 4 ways, ${styleLabel} on Create (${cost}\u00A0\u{1FA99}) draws one from text.`;
}
