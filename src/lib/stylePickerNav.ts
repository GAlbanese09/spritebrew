/**
 * Arrow-key movement in the style picker's tile grid (StylePicker.tsx). Pure,
 * so node can test it (scripts/generate-picker-test.mjs).
 *
 * Left and Right move one tile, Up and Down one row, Home and End go to the
 * first and last tile. Nothing wraps: Left on the first tile, Right on the
 * last, Up on the first row and Down on the last row stay put. Down from a
 * column with no tile below lands on the last tile.
 */

export type PickerNavKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

/** The new index, or null when the key is not a grid key (or there are no tiles). */
export function nextIndex(index: number, key: string, count: number, columns: number): number | null {
  if (count <= 0) return null;
  const cols = Math.max(1, Math.floor(columns));
  const at = Math.min(Math.max(0, index), count - 1);
  const lastRow = Math.floor((count - 1) / cols);
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, at - 1);
    case 'ArrowRight':
      return Math.min(count - 1, at + 1);
    case 'ArrowUp':
      return at - cols >= 0 ? at - cols : at;
    case 'ArrowDown':
      if (Math.floor(at / cols) === lastRow) return at;
      return Math.min(count - 1, at + cols);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
