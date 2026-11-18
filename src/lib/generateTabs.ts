/**
 * The Generate page's three tabs and the words and rules they share (DESIGN,
 * design/generate-pass/generate-pass.md sections 1 and 3; ticket G1). Pure:
 * the page, the forms and the result card read it, and node tests it
 * (scripts/generate-tabs-test.mjs).
 *
 * Three tabs, still two kinds of job: a text animation is a `create` job
 * whose style is an animation style, so its tab follows from the job's mode
 * and style (tabForJob).
 */

import { ACTION_STYLE_MAP } from './animateConfig';
import { getStyleById, getTokenCost, OFFERED_STYLES, type GenerationStyle } from './styleRegistry';

export type GenerateTab = 'create' | 'text' | 'animate';
export type JobMode = 'create' | 'animate';

export const TAB_ORDER: readonly GenerateTab[] = ['create', 'text', 'animate'];

export const TAB_LABELS: Readonly<Record<GenerateTab, string>> = {
  create: 'Create Sprite',
  text: 'Animate from Text',
  animate: 'Animate My Character',
};

/** The line under the page's title. */
export const PAGE_LINE = 'Make a sprite from a description, animate one from a description, or bring your own character and animate it.';

/** The styles Create Sprite offers: the offered styles that are not animations. */
export const CREATE_STYLE_IDS: readonly string[] = OFFERED_STYLES.filter((s) => !s.isAnimation).map((s) => s.id);

/** Animate from Text's five cards, in DESIGN's order, each with its line. */
export const TEXT_ANIMATIONS: readonly { id: string; line: string }[] = [
  { id: 'anim-4angle-walking', line: 'A walk in 4 directions, 16 frames.' },
  { id: 'anim-walking-idle', line: 'A walk and an idle, side by side.' },
  { id: 'anim-small-sprites', line: 'Several actions for one small character.' },
  { id: 'anim-vfx', line: 'A looping effect: fire, magic, explosions.' },
  { id: 'anim-any', line: 'Describe any action. Costs more.' },
];
export const TEXT_ANIMATION_IDS: readonly string[] = TEXT_ANIMATIONS.map((a) => a.id);
export const DEFAULT_TEXT_ANIMATION_ID = 'anim-4angle-walking';
export const VFX_ID = 'anim-vfx';
export const CUSTOM_ANIMATION_ID = 'anim-any';

export function isTextAnimationId(id: string | null | undefined): id is string {
  return typeof id === 'string' && TEXT_ANIMATION_IDS.includes(id);
}

/** The tab whose form finishes a job: Animate My Character for an animate
 *  job; Animate from Text for a create job whose style is an animation
 *  style; Create Sprite for any other create job, and for one saved without
 *  its style (a reload reopens it as today). */
export function tabForJob(mode: JobMode, styleId: string | null | undefined): GenerateTab {
  if (mode === 'animate') return 'animate';
  return styleId && getStyleById(styleId)?.isAnimation ? 'text' : 'create';
}

/** Step 1's words on Animate from Text, by the card chosen. */
export function textDescribeWords(styleId: string): { label: string; placeholder: string; hint: string } {
  if (styleId === VFX_ID) return { label: 'Describe the effect', placeholder: 'a blue fireball with sparks', hint: 'Step 1: describe the effect.' };
  if (styleId === CUSTOM_ANIMATION_ID) return { label: 'Describe it and the action', placeholder: 'a knight swinging a sword overhead', hint: 'Step 1: describe your character.' };
  return { label: 'Describe it', placeholder: 'a knight in silver armor with a red cape', hint: 'Step 1: describe your character.' };
}

/** The cheapest offered cost for each tab, read from the registry and the
 *  action list, never typed. */
export function fromCosts(): Readonly<Record<GenerateTab, number>> {
  const create = Math.min(...CREATE_STYLE_IDS.map((id) => getStyleById(id)?.tokenCost ?? Infinity));
  const text = Math.min(...TEXT_ANIMATION_IDS.map((id) => getStyleById(id)?.tokenCost ?? Infinity));
  const animate = Math.min(...Object.values(ACTION_STYLE_MAP).map((style) => getTokenCost(style)));
  return { create, text, animate };
}

/** The first-visit guide's rows, in tab order. */
export function guideRows(): { tab: GenerateTab; text: string }[] {
  const from = fromCosts();
  return [
    { tab: 'create', text: `Create Sprite: a still character, item or icon from a description. From ${from.create} tokens.` },
    { tab: 'text', text: `Animate from Text: a moving sprite sheet from a description. From ${from.text} tokens.` },
    { tab: 'animate', text: `Animate My Character: bring your own picture and make it move. From ${from.animate} tokens.` },
  ];
}

export const GUIDE_HEADING = 'New here? Start with one of these.';
export const GUIDE_KEY = 'spritebrew_generate_guide_v1';

/** Whether the guide shows: signed in, storage readable, its key not set,
 *  and this browser's Recent Generations list empty. Any doubt: it does not. */
export function guideShows(input: { signedIn: boolean; storageReadable: boolean; keySet: boolean; recentCount: number | null }): boolean {
  return input.signedIn && input.storageReadable && !input.keySet && input.recentCount === 0;
}

/** The bar's states, in order; the first that applies is shown (section 1,
 *  rows 1, 2, 3, 5, 7 and 8; row 4 and row 6 are Animate My Character's). */
export type BarRow = 'generating' | 'paused' | 'guide' | 'required' | 'short' | 'ready';

export function barRow(state: { generating: boolean; paused: boolean; guideShowing: boolean; requiredMissing: boolean; shortBy: number }): BarRow {
  if (state.generating) return 'generating';
  if (state.paused) return 'paused';
  if (state.guideShowing) return 'guide';
  if (state.requiredMissing) return 'required';
  if (state.shortBy > 0) return 'short';
  return 'ready';
}

export const GUIDE_HINT = 'Pick one to start.';

/** A Generate button that cannot be pressed: its fill dims and its label
 *  stays at full strength, 4.5 to 1 or better (section 1; DESIGN's dimmed
 *  primary in mockups v5). Inline, so it wins over the button's own
 *  disabled:opacity-40. */
export const DIMMED_GENERATE = { opacity: 1, backgroundColor: '#5a3d14', borderColor: '#5a3d14', color: '#f3e6d3' } as const;
export const PAUSED_HINT = 'Generating is paused for now. Details are in the notice above.';

/** The step badges: a step with a default counts as done; an optional step
 *  is never next; the next step is the first required step not done; all
 *  plain while the guide shows. */
export type BadgeState = 'plain' | 'next' | 'done';

export function badgeStates(steps: readonly { required: boolean; done: boolean }[], guideShowing: boolean): BadgeState[] {
  if (guideShowing) return steps.map(() => 'plain');
  const next = steps.findIndex((s) => s.required && !s.done);
  return steps.map((s, i) => (i === next ? 'next' : s.done ? 'done' : 'plain'));
}

/** The tips each tab's empty result card shows (2.6, 3, 4.6). */
export function tipsFor(tab: GenerateTab, textStyleId?: string | null): { lead: string; heading: string; tips: string[] } {
  if (tab === 'create') {
    return {
      lead: 'Your sprite will appear here',
      heading: 'Tips for good descriptions',
      // Today's button is Send to Animator; G3 renames it Animate this and
      // this tip with it (DESIGN room 2026-11-18-072).
      tips: ['Say what it wears and holds.', 'Name the colors.', 'Keep it to one character.', 'Actions come later: use Send to Animator on your sprite.'],
    };
  }
  if (tab === 'text') {
    return {
      lead: 'Your animation will appear here',
      heading: 'Tips for good descriptions',
      tips: [
        textStyleId === CUSTOM_ANIMATION_ID
          ? 'For Custom Animation, describe the character and what it does.'
          : 'Describe the character, not the motion: the card you pick is the motion.',
        'One character per animation.',
        'Want your own picture to move? Use Animate My Character.',
      ],
    };
  }
  return {
    lead: 'Your animation will appear here',
    heading: 'Tips',
    tips: ['Pick the action first, then say how it moves: heavy steps, sneaking.', 'Direction comes from your picture. Walks face the way it does.'],
  };
}

/** Animate from Text's gate, one function so a test runs it (AUDIT g1-tabs-r1
 *  M6): the card's style and cost (the cost on the button is the cost sent),
 *  how short the balance is, the size sent (fixed for four cards; VFX's
 *  typed size clamped to its range), and whether Generate may be pressed. A
 *  short balance, an empty description, brewing or a pause each say no. */
export interface TextAnimationGate {
  style: GenerationStyle;
  tokenCost: number;
  shortBy: number;
  width: number;
  height: number;
  canGenerate: boolean;
}

export function textAnimationGate(input: {
  styleId: string;
  tokenBalance: number;
  prompt: string;
  generating: boolean;
  paused: boolean;
  width: number;
  height: number;
}): TextAnimationGate {
  const style = getStyleById(isTextAnimationId(input.styleId) ? input.styleId : DEFAULT_TEXT_ANIMATION_ID)!;
  const clamp = (n: number, fallback: number) => (Number.isFinite(n) ? Math.max(style.minSize, Math.min(style.maxSize, Math.round(n))) : fallback);
  const width = style.fixedSize ? style.defaultWidth : clamp(input.width, style.defaultWidth);
  const height = style.fixedSize ? style.defaultHeight : clamp(input.height, style.defaultHeight);
  const tokenCost = style.tokenCost;
  const shortBy = Math.max(0, tokenCost - input.tokenBalance);
  const canGenerate = !input.paused && !input.generating && input.prompt.trim() !== '' && shortBy === 0;
  return { style, tokenCost, shortBy, width, height, canGenerate };
}

/** The early-user notice and the guide (sections 1 and 6; AUDIT g1-tabs-r1
 *  M1): never together, and not in a page load whose guide has shown, even
 *  after the guide closes; it shows on a later load. Until this account's
 *  guide is known, neither. */
export function earlyNoticeMayShow(input: { guideKnown: boolean; guideShowing: boolean; guideShownThisLoad: boolean }): boolean {
  return input.guideKnown && !input.guideShowing && !input.guideShownThisLoad;
}
