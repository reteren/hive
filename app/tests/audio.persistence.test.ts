import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import { board, replaceBoard, updateNote } from "../src/model/board.svelte";
import { clear, history, undo } from "../src/history/history.svelte";
import { selection } from "../src/selection/selection.svelte";
import { createAudioNotes } from "../src/notes/noteCommands";
import { createDictaphoneNote, deleteAudioRecording, renameAudioRecording } from "../src/audio/recording.svelte";
import { parseNotesPayload, serializeNotes } from "../src/clipboard/payload";
import { sanitizeArchiveEntries } from "../src/archive/serialization";
import { mergeLoadedNotes, parseProjectIndex, serializeProjectIndex } from "../src/project/index";
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

const dictaphone: Note = {
  ...audio,
  id: "dictaphone-note",
  name: "Recorder",
  media: undefined,
  recordings: [
    { id: "recording-1", name: "Recording 1", media },
    { id: "recording-2", name: "Interview", media: { ...media, file: `${"b".repeat(64)}.webm`, name: "Interview.webm" } },
  ],
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

  it("round-trips dictaphone recording lists through all four serializers", () => {
    const project = parseProjectIndex(serializeProjectIndex([dictaphone]));
    expect(project.notes[0]?.recordings).toEqual(dictaphone.recordings);
    const indexed = project.notes[0]!;
    const loaded = mergeLoadedNotes(project, [{
      id: indexed.id,
      name: indexed.name,
      file: indexed.file,
      text: dictaphone.text,
      x: indexed.x,
      y: indexed.y,
      width: indexed.width,
      height: indexed.height,
    }]);
    expect(loaded[0]?.recordings).toEqual(dictaphone.recordings);

    const archived = sanitizeArchiveEntries([{ id: "archive-dictaphone", archivedAt: 12, note: dictaphone, links: [] }]);
    expect(archived.entries[0]?.note.recordings).toEqual(dictaphone.recordings);

    const trashed = sanitizeTrashEntries([{ id: "trash-dictaphone", deletedAt: 12, notes: [dictaphone], zones: [], links: [] }]);
    expect(trashed.entries[0]?.notes[0]?.recordings).toEqual(dictaphone.recordings);

    const clipboard = parseNotesPayload(serializeNotes([dictaphone]));
    expect(clipboard?.nodes[0]?.recordings).toEqual(dictaphone.recordings);
  });

  it("creates an idle dictaphone and makes each rename and delete one Undo step", () => {
    const id = createDictaphoneNote({ x: 40, y: 20 });
    expect(board.notes[id]?.recordings).toEqual([]);
    expect(history.entries).toHaveLength(1);

    updateNote(id, { recordings: [{ id: "rec", name: "Recording 1", media }] });
    expect(renameAudioRecording(id, "rec", "Interview")).toBe(true);
    expect(board.notes[id]?.recordings?.[0]?.name).toBe("Interview");
    expect(history.entries).toHaveLength(2);
    expect(deleteAudioRecording(id, "rec")).toBe(true);
    expect(board.notes[id]?.recordings).toEqual([]);
    expect(history.entries).toHaveLength(3);

    undo();
    expect(board.notes[id]?.recordings?.[0]?.name).toBe("Interview");
    undo();
    expect(board.notes[id]?.recordings?.[0]?.name).toBe("Recording 1");
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
