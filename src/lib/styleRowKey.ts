import { getStyleById } from './styleRegistry';

/**
 * Resolve the STYLE_ROW_NAMES / STYLE_ROW_TYPES key for whatever the store's
 * generationStyle holds. A Create tab style id (anim-4angle-walking) maps to
 * its promptStyle; an RD wire style (animation__walking_and_idle) is used as
 * is. Either way the animation__ prefix is stripped. Anything else, such as
 * any_animation_walking, comes back unchanged.
 */
export function resolveStyleRowKey(generationStyle: string): string {
  const wire = getStyleById(generationStyle)?.promptStyle ?? generationStyle;
  return wire.startsWith('animation__') ? wire.slice('animation__'.length) : wire;
}
