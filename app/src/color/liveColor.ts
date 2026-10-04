export interface LiveColorSession {
  /** Show a colour right away, without an Undo entry. */
  preview(color: string): void;
  /** keep: one Undo entry original → last previewed; otherwise restore the original. */
  finish(keep: boolean): void;
}

/** Real-time recolouring from a HEX palette that still lands in history as a single step. */
export function liveColorSession(
  original: string,
  apply: (color: string) => void,
  commit: (color: string) => void,
): LiveColorSession {
  let last = original;
  let done = false;
  return {
    preview(color) {
      if (done) return;
      last = color;
      apply(color);
    },
    finish(keep) {
      if (done) return;
      done = true;
      if (last.toLowerCase() === original.toLowerCase()) return;
      apply(original);
      if (keep) commit(last);
    },
  };
}
