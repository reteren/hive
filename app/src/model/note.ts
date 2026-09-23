/**
 * "note" — ordinary text node; "pro"/"con" — the green/red plus/minus mini-nodes (R3.5);
 * "importance"/"purpose" — a standalone (external) module on the board (R3.6): no text, its value
 * lives in `importance` / `purposes`, and it applies to the notes it links to.
 */
export type NoteKind = "note" | "pro" | "con" | "importance" | "purpose";

/** Importance levels (R3.3): white / yellow / red / purple / rainbow. */
export const IMPORTANCE_LEVELS = ["basic", "medium", "important", "immediately", "absolute"] as const;
export type ImportanceLevel = (typeof IMPORTANCE_LEVELS)[number];

/** Purpose labels (R3.4): visual meaning markers, a note may carry several. */
export const PURPOSE_KINDS = [
  "quote",
  "concept",
  "openQuestion",
  "decision",
  "hypothesis",
  "experiment",
  "compare",
  "timeline",
] as const;
export type PurposeKind = (typeof PURPOSE_KINDS)[number];

/** Task state (R3.1); absent/null means the note is not a task. */
export interface TaskState {
  done: boolean;
  /** When the task was last completed (ms since epoch), null while open. */
  doneAt: number | null;
}

/**
 * A plain board note (R1). Geometry is in board units (u); x/y is the top-left corner.
 * The Markdown body lives in `text` and is saved as its own .md file named after `name`.
 */
export interface Note {
  /** Permanent id, independent of the name (ROADMAP "Технические границы" §1). */
  id: string;
  type: NoteKind;
  /** Display name, unique within the project; also the .md file name. */
  name: string;
  /** Markdown body. */
  text: string;
  x: number;
  y: number;
  width: number;
  /** Manual height in u, or null while the note grows with its text. */
  height: number | null;
  /** Creation time (ms since epoch); older projects may lack it. Used by search ordering (R2.4). */
  createdAt?: number;
  /** Task flag and completion (R3.1). */
  task?: TaskState | null;
  /** Task state remembered while the task flag is off, restored when it is turned back on (A03). */
  taskMemory?: TaskState | null;
  /** Importance inserted into this note (R3.3); at most one per target, embedded or external. */
  importance?: ImportanceLevel | null;
  /** Purpose labels inserted into this note (R3.4). */
  purposes?: PurposeKind[];
}

/** New note width from the roadmap examples. */
export const DEFAULT_NOTE_WIDTH = 30;

export function newId(): string {
  return crypto.randomUUID();
}
