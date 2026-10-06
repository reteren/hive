import type { CustomMark, ListItem, NodeScope, RandomPick, SourceData, TierRow } from "./nodeData";
import type { LinkAnchor } from "./link";
import type { MessageNodeData, TimeNodeData } from "../time/types";
import type { EmbedSectionState } from "../combo/data";
import type { ImageRef, MediaRef, YouTubeRef } from "../attachments/types";

/**
 * "note" — ordinary text node; "pro"/"con" — the green/red plus/minus mini-nodes (R3.5);
 * "importance"/"purpose"/"mood" — a standalone (external) module on the board (R3.6): no text, its
 * value lives in `importance` / `purposes` / `moods`, and it applies to the notes it links to;
 * "beacon" — an organising beacon (R4): fixed 7.2 u circle, name + `color`, only outgoing links;
 * R5 nodes that show and calculate: "goal", "progress", "calculator", "tierlist", "stats";
 * R6 view nodes: "archive", "trash".
 */
export type NoteKind =
  | "note" | "pro" | "con" | "importance" | "purpose" | "mood" | "beacon"
  | "goal" | "progress" | "calculator" | "tierlist" | "stats"
  | "archive" | "trash"
  | "inbox" | "list" | "source" | "glossary" | "map" | "random"
  | "markas"
  | "time" | "message" | "calendar"
  | "image" | "pdf" | "format" | "audio" | "video" | "youtube";

/** R5 kinds, in create-menu order. */
export const R5_KINDS = ["goal", "progress", "calculator", "tierlist", "stats"] as const;

/** R6 view nodes: Archive and Trash show the project-wide archive / trash (all instances show the same data). */
export const R6_KINDS = ["archive", "trash"] as const;

/** R7 organisational nodes. */
export const R7_KINDS = ["inbox", "list", "source", "glossary", "map", "random", "markas"] as const;

/** R8 time and message nodes (contract in src/time/types.ts). */
export const R8_KINDS = ["time", "message", "calendar"] as const;

/** R9 media objects (contract in src/attachments/types.ts). "image" lies below all other nodes. */
export const R9_KINDS = ["image", "pdf", "format", "audio", "video", "youtube"] as const;

/** Default R5 node widths (u), shared by creation and resize limits. */
export const R5_BASE_WIDTHS = { goal: 30, progress: 30, calculator: 40, tierlist: 60, stats: 30, archive: 40, trash: 40, inbox: 30, list: 30, source: 34, glossary: 40, map: 40, random: 30, markas: 30, time: 30, message: 30, calendar: 36, image: 30, pdf: 40, format: 50, audio: 34, video: 48, youtube: 48 } as const;

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

/** Optional static outer glow. Size is measured in board units and scales with the node zoom. */
export interface NoteGlow {
  color: string;
  opacity: number;
  size: number;
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
  /** A user-adjusted text note width must not be changed by typing. */
  widthLocked?: boolean;
  /** Manual height in u, or null while the note grows with its text. */
  height: number | null;
  /** Uniform visual scale, omitted for the default 1× size. */
  scale?: number;
  /** When true, the note's title header is hidden. */
  headerHidden?: boolean;
  /** Keep rectangular line attachments distributed while preserving them through project retention. */
  smoothLines?: boolean;
  /** Per-link owner-side anchors before smoothing; null means the default automatic attachment. */
  smoothLineAnchors?: Record<string, LinkAnchor | null>;
  /** Creation time (ms since epoch); older projects may lack it. Used by search ordering (R2.4). */
  createdAt?: number;
  /** Task flag and completion (R3.1). */
  task?: TaskState | null;
  /** R8 Time schedule; may be embedded on a note/task or Message host. */
  time?: TimeNodeData;
  /** R8 Message settings; on a note/task host, the message text is `text`. */
  message?: MessageNodeData;
  /** Visibility of embedded Message/Time sections; absent or true means expanded. */
  embedSections?: EmbedSectionState;
  /** Task state remembered while the task flag is off, restored when it is turned back on (A03). */
  taskMemory?: TaskState | null;
  /** Importance inserted into this note (R3.3); at most one per target, embedded or external. */
  importance?: ImportanceLevel | null;
  /** Purpose labels inserted into this note (R3.4). */
  purposes?: PurposeKind[];
  /** Mood labels inserted into this note (rows: Importance, then Purpose, then Mood). */
  moods?: MoodKind[];
  /** Main colour, hex "#rrggbb": a beacon's colour, or a node's frame/header (Change color); also tints its lines. */
  color?: string;
  /** Inner colour of a node, hex "#rrggbb" (Change accent color): the body behind the content. */
  accentColor?: string;
  /** Static outer glow; size is the box-shadow blur radius in board units. */
  glow?: NoteGlow;
  /** Zone this object belongs to (R4.3); kept to resolve equal-area ties in favour of the previous zone (H19). */
  zoneId?: string | null;
  /** Progress / Statistics (R5): what the node counts. */
  scope?: NodeScope;
  /** Board image (kind "image", R9.2): the picture file and its intrinsic size. */
  image?: ImageRef;
  /** Image node opacity from 0.1 to 1; absent means fully opaque. */
  opacity?: number;
  /** R9.3–R9.5 file of a "pdf" / "format" / "audio" / "video" node (see src/attachments/types.ts). */
  media?: MediaRef;
  /** PDF viewer zoom percentage (50–300); absent means fit to width. */
  pdfZoom?: number;
  /** Dictaphone recordings stored as independent immutable audio attachments. */
  recordings?: { id: string; name: string; media: MediaRef }[];
  /** R9.6 YouTube node. */
  youtube?: YouTubeRef;
  /** Hide the outer frame on video and YouTube nodes, leaving the player surface. */
  frameHidden?: true;
  /** Mirror an image horizontally when its resize handle crosses the opposite edge. */
  flipX?: true;
  /** Mirror an image vertically when its resize handle crosses the opposite edge. */
  flipY?: true;
  /** A user-stopped GIF stays still until explicitly played again. */
  gifStopped?: true;
  /** Tierlist (R5.7): rows and their cards. */
  tiers?: TierRow[];
  /** List (R7.3): ordered items, each a link to a board object or a missing target. */
  listItems?: ListItem[];
  /** Source (R7.4): a web link and/or a file with a description. */
  source?: SourceData;
  /** Inbox twins (R7.2/H35): notes created by one quick entry near several Inbox nodes share this id until one is chosen. */
  inboxGroup?: string;
  /** Random Choice (R7.7): the last picked list item. */
  randomPick?: RandomPick;
  /** Mark as (custom module, 27.09): user tags; on a "markas" node its own tags, on other notes the inserted tags. */
  customMarks?: CustomMark[];
  /** Mark as: colour the node frame with the tag colours (several → animated gradient). */
  customMarkFrame?: boolean;
  /** List: a Statistics extension inserted into this list (shows per-row stats on the right). */
  listStats?: boolean;
}

export const MAX_NOTE_SCALE = 4;

export function isValidNoteScale(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= MAX_NOTE_SCALE;
}

export function normalizeNoteScale(value: unknown): number {
  return isValidNoteScale(value) ? value : 1;
}

/** Beacon diameter in u (fixed size, ROADMAP R4.0). */
export const BEACON_SIZE = 7.2;

/** Title strip height in board units (28 CSS px at PX_PER_UNIT=10). */
export const NOTE_HEADER_HEIGHT_UNITS = 2.8;

/** New note width from the roadmap examples. */
export const DEFAULT_NOTE_WIDTH = 30;

export function newId(): string {
  return crypto.randomUUID();
}
