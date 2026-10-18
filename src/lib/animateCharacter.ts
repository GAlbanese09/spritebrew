// The Animate tab's character: the image Auto-Prep is working on, and the
// character the user accepted with Use This. Pure, no React, so the offline
// test (scripts/animate-character-test.mjs) can drive every transition.
//
// The rule (Second 049, Oct 16, 2026): an accepted character is never
// discarded by a resolution change, whatever caused it (a preset button, a
// template load, the restored config, the action's mode snap). A mismatch
// between the character and the selected resolution is derived from the two
// values and shown on the card; it changes no state. Only the user's own
// explicit act replaces the character: Use This on a new prep, Remove, a new
// upload, or a Send-to-Animator handoff. Cancelling a prep never touches the
// accepted character.

/** Auto-Prep's background-removal settings. */
export interface PrepSettings {
  skipBgRemoval: boolean;
  tolerance: number;
}

/** What Auto-Prep starts from: the upload or the handed-off sheet, with the
 *  settings Auto-Prep opens with. */
export interface PrepSource extends PrepSettings {
  dataUrl: string;
  width: number;
  height: number;
}

/** What Use This reported about the accepted image. */
export interface AcceptedPrep extends PrepSettings {
  /** The user saved pixel edits in Auto-Prep's editor. */
  edited: boolean;
}

export interface AcceptedCharacter {
  /** The image Use This accepted, pixel edits included. */
  dataUrl: string;
  width: number;
  height: number;
  edited: boolean;
  /** What it was prepared from, with the settings in force at Use This, so
   *  "Prepare at N" reopens Auto-Prep the same way at the new size. */
  source: PrepSource;
}

export interface CharacterState {
  character: AcceptedCharacter | null;
  /** Auto-Prep is open on this source. With a character present, this is a
   *  re-prep: the card stays until Use This replaces it. */
  pending: PrepSource | null;
}

export const DEFAULT_BG_TOLERANCE = 30;

export const EMPTY_CHARACTER_STATE: CharacterState = { character: null, pending: null };

/** A new upload or a Send-to-Animator handoff. The user chose a new image,
 *  so it replaces the accepted character and anything Auto-Prep had open. */
export function startPrep(source: PrepSource): CharacterState {
  return { character: null, pending: source };
}

/** "Prepare at N" on the character card: reopen Auto-Prep on the source the
 *  character came from. The accepted character stays until Use This. */
export function startReprep(state: CharacterState): CharacterState {
  if (!state.character) return state;
  return { character: state.character, pending: state.character.source };
}

/** Use This. The prepared image becomes the character; the source is kept
 *  with the settings Auto-Prep ended on. */
export function acceptPrep(
  state: CharacterState,
  prepared: { dataUrl: string; width: number; height: number } & AcceptedPrep
): CharacterState {
  if (!state.pending) return state;
  return {
    character: {
      dataUrl: prepared.dataUrl,
      width: prepared.width,
      height: prepared.height,
      edited: prepared.edited,
      source: {
        ...state.pending,
        skipBgRemoval: prepared.skipBgRemoval,
        tolerance: prepared.tolerance,
      },
    },
    pending: null,
  };
}

/** Upload Different on a fresh prep, or Keep NxN on a re-prep: Auto-Prep
 *  closes and the accepted character, if any, is untouched. */
export function cancelPrep(state: CharacterState): CharacterState {
  if (!state.pending) return state;
  return { character: state.character, pending: null };
}

/** Remove on the character card. */
export function removeCharacter(): CharacterState {
  return EMPTY_CHARACTER_STATE;
}

/** True when a character is present and is not the selected size. */
export function sizeMismatch(character: AcceptedCharacter | null, selectedResolution: number): boolean {
  return (
    !!character &&
    (character.width !== selectedResolution || character.height !== selectedResolution)
  );
}

export interface GenerateGateInput {
  character: AcceptedCharacter | null;
  selectedResolution: number;
  isCustomAction: boolean;
  motionPrompt: string;
  tokenBalance: number;
  tokenCost: number;
  isGenerating: boolean;
}

export interface GenerateGate {
  canGenerate: boolean;
  /** The character is present and not the selected size. */
  sizeWarning: boolean;
  /** The first reason Generate is disabled, in canGenerate's order; null
   *  while generating or when Generate is enabled. */
  blockedReason: string | null;
}

/** Whether Generate is enabled, and why not. Copy approved by George, Oct 15,
 *  2026 (ship list items 12 to 14). */
export function generateGate(input: GenerateGateInput): GenerateGate {
  const { character, isCustomAction, motionPrompt, tokenBalance, tokenCost, isGenerating } = input;
  const sizeWarning = sizeMismatch(character, input.selectedResolution);
  const needsPrompt = isCustomAction && !motionPrompt.trim();
  const tokensNeeded = tokenCost - tokenBalance;
  const canGenerate = !!character && !sizeWarning && !needsPrompt && tokensNeeded <= 0;
  const blockedReason =
    isGenerating || canGenerate
      ? null
      : !character
        ? 'Add a character first'
        : sizeWarning
          ? `This character is ${character.width}x${character.height}. Choose ${character.width} or prepare it again.`
          : needsPrompt
            ? 'Describe the motion first'
            : `Need ${tokensNeeded} more tokens`;
  return { canGenerate, sizeWarning, blockedReason };
}
