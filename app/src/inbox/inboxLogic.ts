import { DEFAULT_NOTE_WIDTH, type Note } from "../model/note";
import {
  CREATION_GAP,
  creationObstacleForNote,
  estimatedCreationHeight,
  nearestFreeNoteCenter,
  notePositionAt,
} from "../notes/creationPosition";
import { uniqueName } from "../notes/naming";
import type { Point } from "../board/cameraMath";

export interface InboxEntryPlacementOptions {
  groupId?: string;
  createdAt: number;
  nextId(): string;
  snap: boolean;
  step: number;
  measuredHeights?: Readonly<Record<string, number | undefined>>;
}

/** Use the first input line as a concise note title, keeping the body untouched. */
export function inboxEntryBaseName(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const shortened = Array.from(firstLine.trim()).slice(0, 40).join("");
  return shortened || "Inbox entry";
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
  const obstacles = existingNotes.map((note) =>
    creationObstacleForNote(note, options.measuredHeights?.[note.id]),
  );
  const noteHeight = estimatedCreationHeight({ type: "note", width: DEFAULT_NOTE_WIDTH, height: null, text });
  const notes: Note[] = [];

  for (const inbox of inboxes) {
    const preferredCenter: Point = {
      x: inbox.x + inbox.width + CREATION_GAP + DEFAULT_NOTE_WIDTH / 2,
      y: inbox.y + noteHeight / 2,
    };
    const center = nearestFreeNoteCenter(
      preferredCenter,
      DEFAULT_NOTE_WIDTH,
      noteHeight,
      obstacles,
      options.snap,
      options.step,
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
