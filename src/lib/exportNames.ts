import { sanitizeFilename } from '@/lib/downloadUtils';

/**
 * Unique names for a sheet's animation groups in an export.
 *
 * Every exporter builds frame keys and file names from
 * sanitizeFilename(group name), which lowercases, so two groups named "Idle",
 * or "Idle" and "idle", used to overwrite each other's frames (TexturePacker
 * and Aseprite key frames by name, GameMaker strips and raw frames are files
 * by name, Godot animation names must be unique). This helper hands each
 * group, in order:
 *
 * - `file`: the base for frame keys and file names. sanitizeFilename(name),
 *   or "animation" when that is empty, then _2, _3 and so on for a repeat,
 *   compared on the sanitized form. A numbered base never collides with
 *   another group's own sanitized name (so two "Idle" groups beside a group
 *   named "Idle 2" give idle, idle_3 and idle_2).
 * - `label`: the name for tags, the manifest and Godot animations. The
 *   original name, with " 2", " 3" and so on for an exact repeat, likewise
 *   never taking another group's own name.
 *
 * Groups with no frames (`isEmpty`) are left out of the numbering, since
 * every exporter skips them: an empty "Idle" before a full one leaves the
 * full one its own name. A group whose name sanitizes to nothing gets
 * "animation", numbered after any group really named that.
 *
 * A sheet with no repeated names gets exactly today's names (except that an
 * all-symbol name, whose sanitized form is empty, now gets "animation"
 * instead of an empty base).
 */
export interface ExportName {
  file: string;
  label: string;
}

const EMPTY_FILE_BASE = 'animation';

interface NameItem {
  /** The value to make unique. */
  base: string;
  /** False for a substitute ("animation" for an empty sanitized name): it
   *  does not own its base, so a group really named that keeps it. */
  owns: boolean;
  /** Left out of the numbering (an empty group): returned as is. */
  skip: boolean;
}

/**
 * Assign each item a unique value: its base when free, otherwise
 * `base + sep + n` for the first n >= 2 that no other item owns and no
 * earlier assignment took.
 */
function uniqueInOrder(items: NameItem[], sep: string): string[] {
  const owned = new Set(items.filter((it) => it.owns && !it.skip).map((it) => it.base));
  const taken = new Set<string>();
  return items.map(({ base, owns, skip }) => {
    if (skip) return base;
    let candidate = base;
    for (let n = 2; taken.has(candidate) || ((candidate !== base || !owns) && owned.has(candidate)); n++) {
      candidate = `${base}${sep}${n}`;
    }
    taken.add(candidate);
    return candidate;
  });
}

export function exportNames(
  names: string[],
  isEmpty: (index: number) => boolean = () => false
): ExportName[] {
  const files = uniqueInOrder(
    names.map((name, i) => {
      const sanitized = sanitizeFilename(name);
      return { base: sanitized || EMPTY_FILE_BASE, owns: sanitized !== '', skip: isEmpty(i) };
    }),
    '_'
  );
  const labels = uniqueInOrder(
    names.map((name, i) => ({ base: name, owns: true, skip: isEmpty(i) })),
    ' '
  );
  return names.map((_, i) => ({ file: files[i], label: labels[i] }));
}
