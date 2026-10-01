import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import { board, replaceBoard } from "../src/model/board.svelte";
import { clear, history, undo } from "../src/history/history.svelte";
import { selection } from "../src/selection/selection.svelte";
import { createAudioNotes } from "../src/notes/noteCommands";
import { parseNotesPayload, serializeNotes } from "../src/clipboard/payload";
import { sanitizeArchiveEntries } from "../src/archive/serialization";
import { parseProjectIndex, serializeProjectIndex } from "../src/project/index";
import { sanitizeTrashEntries } from "../src/trash/serialization";

const media = {
  file: `${"a".repeat(64)}.webm`,
  mime: "audio/webm",
  size: 2048,
  name: "Voice.webm",
  kind: "audio" as const,
  duration: 4.5,
};

const audio: Note = {
  id: "audio-note",
  type: "audio",
  name: "Voice",
  text: "Meeting notes",
  x: 10,
  y: 20,
  width: 34,
  height: null,
  media,
};

beforeEach(() => {
  clear();
  replaceBoard([]);
  selection.ids = [];
  selection.zoneIds = [];
  selection.primaryId = null;
});

afterEach(() => {
  clear();
  replaceBoard([]);
});

describe("audio note persistence", () => {
  it("round-trips the media ref through the project index", () => {
    const loaded = parseProjectIndex(serializeProjectIndex([audio]));
    expect(loaded.notes[0]?.media).toEqual(media);
  });

  it("round-trips the media ref through archive and trash", () => {
    const archived = sanitizeArchiveEntries([{ id: "archive-entry", archivedAt: 12, note: audio, links: [] }]);
    expect(archived.entries[0]?.note.media).toEqual(media);
    const trashed = sanitizeTrashEntries([{ id: "trash-entry", deletedAt: 12, notes: [audio], zones: [], links: [] }]);
    expect(trashed.entries[0]?.notes[0]?.media).toEqual(media);
  });

  it("round-trips the media ref through the clipboard payload", () => {
    const payload = parseNotesPayload(serializeNotes([audio]));
    expect(payload?.nodes[0]?.media).toEqual(media);
  });

  it("creates a dropped batch with one undo step", () => {
    const ids = createAudioNotes([media, { ...media, name: "Voice 2.webm" }], { x: 40, y: 20 });
    expect(ids).toHaveLength(2);
    expect(history.entries).toHaveLength(1);
    expect(board.order).toEqual(ids);
    undo();
    expect(board.order).toEqual([]);
  });
});
