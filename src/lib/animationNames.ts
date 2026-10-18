// Names and types for animations the user creates in Sheet Tools. Pure, no
// React and no store, so the offline test can drive it.

import { ANIMATION_TYPES } from '@/lib/constants';

export type AnimationTypeId = (typeof ANIMATION_TYPES)[number]['id'];

const FALLBACK_TYPE: AnimationTypeId = 'idle';

/** The type a new animation gets: the sheet's own type when the slicer was
 *  handed one (a generated animation), else Idle. */
export function defaultAnimationType(metadata: { animationType?: string } | null | undefined): AnimationTypeId {
  const wanted = metadata?.animationType;
  const match = ANIMATION_TYPES.find((t) => t.id === wanted);
  return match ? match.id : FALLBACK_TYPE;
}

/** The preset for a type id, or the Idle preset. */
export function animationPreset(typeId: string) {
  return ANIMATION_TYPES.find((t) => t.id === typeId) ?? ANIMATION_TYPES[0];
}

/** `base` if no existing animation has that name, else "base 2", "base 3",
 *  the first number free. Names compare trimmed and case-insensitive, so
 *  "idle" and "Idle " count as taken. */
export function nextAnimationName(base: string, existingNames: Iterable<string>): string {
  const taken = new Set<string>();
  for (const n of existingNames) taken.add(n.trim().toLowerCase());
  const root = base.trim() || 'Animation';
  if (!taken.has(root.toLowerCase())) return root;
  for (let i = 2; ; i++) {
    const candidate = `${root} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
