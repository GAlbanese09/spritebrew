/**
 * The editor and /resize hand an image to each other (external product
 * audit r2, SB-06): an image too large for the editor goes to /resize
 * without being chosen again, and the resized image comes back to the
 * editor. Each handoff is one-shot and lives only in this page's memory: no
 * storage, no request, so the image never leaves the device. A reload drops
 * it, and the person chooses the file again as before.
 */

/** The resized image, as /editor opens it. */
export interface EditorHandoffImage {
  dataUrl: string;
  width: number;
  height: number;
  name: string;
}

let forResize: File | null = null;
let forEditor: EditorHandoffImage | null = null;

/** The editor's refused file, for /resize to open. */
export function sendToResize(file: File): void {
  forResize = file;
}

/** The editor took another file, so a waiting one is dropped (AUDIT
 *  ext-mediums r1 L4). */
export function dropForResize(): void {
  forResize = null;
}

/** /resize takes it once. */
export function takeForResize(): File | null {
  const file = forResize;
  forResize = null;
  return file;
}

/** The resized image, for /editor to open. */
export function sendToEditor(image: EditorHandoffImage): void {
  forEditor = image;
}

/** /editor takes it once. */
export function takeForEditor(): EditorHandoffImage | null {
  const image = forEditor;
  forEditor = null;
  return image;
}
