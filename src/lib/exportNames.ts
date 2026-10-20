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
 * A sheet with no repeated names gets exactly today's names (except that an
 * all-symbol name, whose sanitized form is empty, now gets "animation"
 * instead of an empty base).
 */
export interface ExportName {
  file: string;
  label: string;
}

const EMPTY_FILE_BASE = 'animation';

/**
 * Assign each name in `names` a unique value: the name itself when free,
 * otherwise `name + sep + n` for the first n >= 2 that no other name owns and
 * no earlier assignment took.
 */
function uniqueInOrder(names: string[], sep: string): string[] {
  const owned = new Set(names);
  const taken = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    for (let n = 2; taken.has(candidate) || (candidate !== name && owned.has(candidate)); n++) {
      candidate = `${name}${sep}${n}`;
    }
    taken.add(candidate);
    return candidate;
  });
}

export function exportNames(names: string[]): ExportName[] {
  const files = uniqueInOrder(
    names.map((name) => sanitizeFilename(name) || EMPTY_FILE_BASE),
    '_'
  );
  const labels = uniqueInOrder(names, ' ');
  return names.map((_, i) => ({ file: files[i], label: labels[i] }));
}
