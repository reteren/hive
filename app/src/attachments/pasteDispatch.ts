/**
 * R9 image paste routing (coordinator-owned). Ctrl+V with image files in the clipboard goes through
 * ONE place: the board paste path (clipboard/commands, IMG task) calls `dispatchImagePaste` instead
 * of creating a board image directly. Handlers run by priority, highest first; the first that
 * returns true consumes the paste. Priorities mirror the file-drop handlers:
 * Tierlist row 30, active text editor 20, board fallback 0.
 */
export type ImagePasteHandler = (files: File[]) => boolean;

const handlers: { priority: number; handler: ImagePasteHandler; order: number }[] = [];
let registrations = 0;

export function registerImagePasteHandler(priority: number, handler: ImagePasteHandler): () => void {
  const entry = { priority, handler, order: registrations++ };
  handlers.push(entry);
  handlers.sort((a, b) => b.priority - a.priority || a.order - b.order);
  return () => {
    const index = handlers.indexOf(entry);
    if (index >= 0) handlers.splice(index, 1);
  };
}

/** Returns true when some handler took the images; false leaves the paste to hive's own clipboard. */
export function dispatchImagePaste(files: File[]): boolean {
  if (files.length === 0) return false;
  return handlers.some((entry) => entry.handler(files));
}
