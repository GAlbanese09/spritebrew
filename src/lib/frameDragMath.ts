/** Pure helpers for dragging frames in the sheet tools. No DOM, no store, so
 *  scripts/frame-drag-test.mjs can exercise them under node. */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where a drop at (x, y) lands among tiles laid out left to right in
 *  wrapping rows. Returns an insertion index from 0 to boxes.length: the
 *  first tile the pointer is above, or level with and left of its center. */
export function insertionIndex(boxes: Box[], x: number, y: number): number {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (y < b.top) return i;
    if (y <= b.bottom && x < (b.left + b.right) / 2) return i;
  }
  return boxes.length;
}

/** Insertion index for a drop anywhere on a group card. Above the strip
 *  (the group's title or FPS row) means "add to the end", which is what a
 *  drop onto the group as a whole should do; on or below it, the position
 *  under the pointer. */
export function dropIndex(boxes: Box[], x: number, y: number): number {
  if (boxes.length > 0 && y < boxes[0].top) return boxes.length;
  return insertionIndex(boxes, x, y);
}

/** The thin bar that shows an insertion point: just left of the tile at
 *  `index`, or just right of the last tile when dropping at the end. Null
 *  when there are no tiles (the whole group is highlighted instead). */
export function indicatorBox(boxes: Box[], index: number, gap: number): Box | null {
  if (boxes.length === 0) return null;
  const half = gap / 2;
  if (index < boxes.length) {
    const b = boxes[index];
    return { left: b.left - half - 1, right: b.left - half + 1, top: b.top, bottom: b.bottom };
  }
  const b = boxes[boxes.length - 1];
  return { left: b.right + half - 1, right: b.right + half + 1, top: b.top, bottom: b.bottom };
}

/** Moves the item at `from` so it lands at insertion index `to` (0 to
 *  length, measured before removal). Returns the same array when the drop
 *  would leave the order unchanged. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return items;
  const clamped = Math.max(0, Math.min(items.length, to));
  if (clamped === from || clamped === from + 1) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(clamped > from ? clamped - 1 : clamped, 0, moved);
  return next;
}

/** Inserts a copy of `item` at insertion index `at`, keeping every existing
 *  entry, so the same frame can be used more than once. */
export function insertAt<T>(items: T[], at: number, item: T): T[] {
  const clamped = Math.max(0, Math.min(items.length, at));
  const next = items.slice();
  next.splice(clamped, 0, item);
  return next;
}
