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

/**
 * R9.3–R9.6 media contract (coordinator-owned, 01.10). User defaults (not objected):
 * - Format/text files are edited as a COPY inside the project. Attachments stay immutable: every
 *   save writes the new text as a new content-addressed file and points the node at it (one Undo
 *   step), so Undo/backups keep working. "Save as…" exports the current text to a file the user picks.
 * - Size limits: images, PDF and text 200 MB; audio and video 2 GB, copied by streaming (never
 *   loaded whole into memory).
 * - Supported types are the verified lists below, not "all formats".
 */
export type MediaKind = "pdf" | "text" | "audio" | "video";

export const PDF_MIME_TYPES = ["application/pdf"] as const;
export const AUDIO_MIME_TYPES = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/flac"] as const;
export const VIDEO_MIME_TYPES = ["video/mp4", "video/webm"] as const;
/** Text formats the Format node opens and edits; the key is the file extension (lowercase). */
export const TEXT_FORMAT_LANGUAGES = {
  txt: "plain", md: "markdown", json: "json", py: "python", js: "javascript", ts: "typescript",
  css: "css", html: "html", xml: "xml", yaml: "yaml", yml: "yaml", toml: "toml", csv: "csv",
  ini: "ini", sql: "sql", sh: "shell", ps1: "powershell", rs: "rust", c: "c", cpp: "cpp", h: "c",
  cs: "csharp", java: "java", go: "go", lua: "lua", log: "plain",
} as const;
export type TextFormatExtension = keyof typeof TEXT_FORMAT_LANGUAGES;

export const MEDIA_LIMIT_BYTES: Record<MediaKind | "image", number> = {
  image: 200 * 1024 * 1024,
  pdf: 200 * 1024 * 1024,
  text: 200 * 1024 * 1024,
  audio: 2 * 1024 * 1024 * 1024,
  video: 2 * 1024 * 1024 * 1024,
};

/** A non-image attachment on a node ("pdf", "format", "audio", "video" kinds). */
export interface MediaRef extends AttachmentRef {
  kind: MediaKind;
  /** Duration in seconds for audio/video, read on import when the webview can decode it. */
  duration?: number;
  /** Intrinsic video size, for the initial node aspect ratio. */
  naturalWidth?: number;
  naturalHeight?: number;
}

/** YouTube node data (R9.6). Only the id is authoritative; title/author come from oEmbed when online. */
export interface YouTubeRef {
  videoId: string;
  /** The URL the user pasted, kept for "Open source". */
  url: string;
  title?: string;
  author?: string;
  /** Start offset in seconds parsed from t=/start=. */
  start?: number;
}
