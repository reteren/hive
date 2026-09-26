import type { NodeScope, TierRow } from "./nodeData";

/**
 * "note" — ordinary text node; "pro"/"con" — the green/red plus/minus mini-nodes (R3.5);
 * "importance"/"purpose"/"mood" — a standalone (external) module on the board (R3.6): no text, its
 * value lives in `importance` / `purposes` / `moods`, and it applies to the notes it links to;
 * "beacon" — an organising beacon (R4): fixed 7.2 u circle, name + `color`, only outgoing links;
 * R5 nodes that show and calculate: "goal", "progress", "calculator", "tierlist", "stats".
 */
export type NoteKind =
  | "note" | "pro" | "con" | "importance" | "purpose" | "mood" | "beacon"
  | "goal" | "progress" | "calculator" | "tierlist" | "stats";

/** R5 kinds, in create-menu order. */
export const R5_KINDS = ["goal", "progress", "calculator", "tierlist", "stats"] as const;

/** Default R5 node widths (u), shared by creation and resize limits. */
export const R5_BASE_WIDTHS = { goal: 30, progress: 30, calculator: 40, tierlist: 60, stats: 30 } as const;

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

/** Mood labels (user idea after R3): describe the mood of a note; a note may carry several. */
export const MOOD_KINDS = [
  "anger",
  "happiness",
  "sadness",
  "disgust",
  "fear",
  "surprise",
  "joy",
  "love",
  "excitement",
  "gratitude",
  "pride",
  "envy",
  "guilt",
  "shame",
  "jealousy",
  "disappointment",
  "confusion",
  "curiosity",
  "boredom",
  "relief",
] as const;
export type MoodKind = (typeof MOOD_KINDS)[number];

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
  /** Mood labels inserted into this note (rows: Importance, then Purpose, then Mood). */
  moods?: MoodKind[];
  /** Beacon colour (kind "beacon"), hex "#rrggbb". */
  color?: string;
  /** Zone this object belongs to (R4.3); kept to resolve equal-area ties in favour of the previous zone (H19). */
  zoneId?: string | null;
  /** Progress / Statistics (R5): what the node counts. */
  scope?: NodeScope;
  /** Tierlist (R5.7): rows and their cards. */
  tiers?: TierRow[];
}

/** Beacon diameter in u (fixed size, ROADMAP R4.0). */
export const BEACON_SIZE = 7.2;

/** New note width from the roadmap examples. */
export const DEFAULT_NOTE_WIDTH = 30;

export function newId(): string {
  return crypto.randomUUID();
}
