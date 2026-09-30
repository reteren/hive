/**
 * R9 attachments contract (coordinator-owned; ask before changing).
 *
 * Storage (R9.1): every imported file is copied into the project's `attachments/` folder under a
 * content-addressed name `<sha256 hex, lowercase>.<ext>` (ext lowercase, from the MIME type or the
 * original name). Identical content is stored once; the model only ever refers to that file name,
 * never to an absolute path, so copying/exporting the project folder keeps every picture.
 * Files are immutable: nothing edits an attachment in place, so several nodes/cards/texts may share
 * one file and copies stay independent. Unreferenced files are not deleted while Undo/Trash/Archive
 * may still bring their owner back (cleanup is a separate, explicit step — not in R9.1).
 *
 * Backups (user decision 30.09): attachments are stored once in a shared pool next to the snapshots
 * and each snapshot lists the files it needs — no per-snapshot copies of the same file.
 */
export interface AttachmentRef {
  /** `<sha256>.<ext>` inside `attachments/`. */
  file: string;
  /** MIME type as detected on import, e.g. "image/png", "image/gif". */
  mime: string;
  /** Size in bytes. */
  size: number;
  /** Original file name, for display only; may be absent (clipboard screenshots). */
  name?: string;
}

/** Image metadata shared by board images, Tierlist image cards and inline images. */
export interface ImageRef extends AttachmentRef {
  /** Intrinsic pixel size, read once on import; used for aspect ratio before the file loads. */
  naturalWidth: number;
  naturalHeight: number;
}

/** Image formats accepted in R9.2 (verified list, not "all formats"). */
export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"] as const;

/**
 * Inline image inside note text (R9.2, user decision 30.09): a paragraph-level token
 *   ![alt](att:<file>){w=NN}
 * NN = width in percent of the text column, integer 5..100; default 50 (the user resizes freely).
 * The token is plain text in the note file, so copy/undo/search keep working on it. Aspect ratio is
 * always preserved for inline images.
 */
export const INLINE_IMAGE_DEFAULT_WIDTH_PERCENT = 50;
export const INLINE_IMAGE_PATTERN = /!\[([^\]\n]*)\]\(att:([0-9a-f]{64}\.[a-z0-9]{1,8})\)(?:\{w=(\d{1,3})\})?/g;
