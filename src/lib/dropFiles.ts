/**
 * A drop of several files on an upload zone (external product audit r2,
 * SB-13). The zone opens one image at a time, so it takes the first by name
 * in natural order (frame2 before frame10) and says how many came and which
 * one opened. Pure: no DOM.
 */

const NATURAL = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The file to open from a drop, and how many were dropped; null for none.
 * The first the zone accepts, by name, so a text file in the drop does not
 * stop the images (AUDIT ext-mediums r1 L6); with none it accepts, the
 * first by name, so the zone says what is wrong.
 */
export function pickDropped<T extends { name: string }>(
  files: readonly T[],
  accepts: (file: T) => boolean = () => true,
): { file: T; count: number } | null {
  if (files.length === 0) return null;
  const sorted = [...files].sort((a, b) => NATURAL.compare(a.name, b.name));
  const file = sorted.find(accepts) ?? sorted[0];
  return { file, count: files.length };
}

/** The line shown with the opened image when more than one was dropped. */
export function droppedNote(count: number, name: string): string | null {
  return count > 1 ? `${count} files were dropped. Only one opens at a time, so ${name} is open.` : null;
}
