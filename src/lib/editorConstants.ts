/**
 * Editor dimension caps — neutral home for the constants both editorStore
 * (runtime + helpers) and spriteProject (boundary validator) need.
 *
 * Wave 1b.1 lift: previously these lived in editorStore.ts and were
 * imported back by spriteProject.ts, creating a circular dependency. The
 * cycle was safe today (refs only inside function bodies) but fragile;
 * moving here makes the dependency one-directional:
 *
 *   editorStore ─┐
 *                ├─→ editorConstants
 *   spriteProject ┘
 *
 * Wave 1a-established values; do not change without revisiting both
 * importers' acceptance criteria.
 */

/** Per-side cap on any image loaded into the editor (px). */
export const EDITOR_MAX_DIMENSION = 1024;

/**
 * Total-pixel cap. Guards e.g. a 4096×64 strip whose per-side caps are
 * within bounds but whose total area is large. Kept derived from
 * EDITOR_MAX_DIMENSION so the two constants can't drift.
 */
export const EDITOR_MAX_PIXELS = EDITOR_MAX_DIMENSION * EDITOR_MAX_DIMENSION;
