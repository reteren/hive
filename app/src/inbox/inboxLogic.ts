import { DEFAULT_NOTE_WIDTH, type Note } from "../model/note";
import {
  creationObstacleForNote,
  estimatedCreationHeight,
  notePositionAt,
  randomFreeNoteCenter,
} from "../notes/creationPosition";
import { uniqueName } from "../notes/naming";
import type { Point } from "../board/cameraMath";
import { INBOX_PLACEMENT_GROWTH_ROWS, INBOX_ROW_HEIGHT } from "./inboxLayout";

export interface InboxEntryPlacementOptions {
  groupId?: string;
  createdAt: number;
  nextId(): string;
  snap: boolean;
  step: number;
  rng?: () => number;
  measuredHeights?: Readonly<Record<string, number | undefined>>;
  inboxAutoHeights?: Readonly<Record<string, number | undefined>>;
}

/** Use the first input line as a concise note title, keeping the body untouched. */
export function inboxEntryBaseName(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const shortened = Array.from(firstLine.trim()).slice(0, 40).join("");
  return shortened || "Inbox entry";
}

/** Show a local HH:MM time and add a calendar date for entries from another day. */
export function formatInboxEntryTime(createdAt: number | undefined, now = new Date()): string {
  if (createdAt === undefined || !Number.isFinite(createdAt)) return "—";
  const created = new Date(createdAt);
  if (!Number.isFinite(created.getTime())) return "—";

  const time = created.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const isToday = created.getFullYear() === now.getFullYear() &&
    created.getMonth() === now.getMonth() &&
    created.getDate() === now.getDate();
  if (isToday) return time;
  const date = created.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return `${time} · ${date}`;
}

/** Build one note beside each Inbox, resolving collisions with the shared creation helper. */
export function placeInboxEntries(
  text: string,
  inboxes: readonly Note[],
  existingNotes: readonly Note[],
  options: InboxEntryPlacementOptions,
): Note[] {
  if (inboxes.length === 0) return [];

  const occupiedNames = existingNotes.map((note) => note.name);
  const reservedInboxObstacles = new Map(inboxes.map((inbox) => {
    const obstacle = creationObstacleForNote(inbox, options.measuredHeights?.[inbox.id]);
    const autoHeight = options.inboxAutoHeights?.[inbox.id];
    const currentHeight = Number.isFinite(autoHeight) && autoHeight! > 0
      ? Math.max(autoHeight!, obstacle.height)
      : obstacle.height;
    return [inbox.id, {
      ...obstacle,
      // Reserve the current entry's row plus ten more rows for later quick inputs.
      height: currentHeight + INBOX_ROW_HEIGHT * (1 + INBOX_PLACEMENT_GROWTH_ROWS),
    }] as const;
  }));
  const obstacles = existingNotes.map((note) => reservedInboxObstacles.get(note.id) ??
    creationObstacleForNote(note, options.measuredHeights?.[note.id]));
  const noteHeight = estimatedCreationHeight({ type: "note", width: DEFAULT_NOTE_WIDTH, height: null, text });
  const notes: Note[] = [];

  for (const inbox of inboxes) {
    const inboxObstacle = reservedInboxObstacles.get(inbox.id) ??
      creationObstacleForNote(inbox, options.measuredHeights?.[inbox.id]);
    const preferredCenter: Point = {
      x: inbox.x + inbox.width / 2,
      y: inbox.y + inboxObstacle.height / 2,
    };
    const center = randomFreeNoteCenter(
      preferredCenter,
      DEFAULT_NOTE_WIDTH,
      noteHeight,
      obstacles,
      options.snap,
      options.step,
      { anchor: inboxObstacle, ...(options.rng ? { rng: options.rng } : {}) },
    );
    const position = notePositionAt(center, DEFAULT_NOTE_WIDTH, noteHeight, false, options.step);
    const note: Note = {
      id: options.nextId(),
      type: "note",
      name: uniqueName(inboxEntryBaseName(text), occupiedNames),
      text,
      ...position,
      width: DEFAULT_NOTE_WIDTH,
      height: null,
      createdAt: options.createdAt,
      ...(options.groupId ? { inboxGroup: options.groupId } : {}),
    };
    notes.push(note);
    occupiedNames.push(note.name);
    obstacles.push(creationObstacleForNote(note));
  }

  return notes;
}
