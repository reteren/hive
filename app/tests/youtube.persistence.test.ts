import { describe, expect, it } from "vitest";
import { sanitizeArchiveEntries } from "../src/archive/serialization";
import { parseNotesPayload, serializeNotes } from "../src/clipboard/payload";
import type { Note } from "../src/model/note";
import { mergeLoadedNotes, parseProjectIndex, parseProjectIndexWithWarnings, serializeProjectIndex } from "../src/project/index";
import { sanitizeTrashEntries } from "../src/trash/serialization";

const youtubeNote: Note = {
  id: "youtube-hidden",
  type: "youtube",
  name: "Looping video",
  text: "",
  x: 4,
  y: 8,
  width: 48,
  height: null,
  youtube: {
    videoId: "abcdefghijk",
    url: "https://youtu.be/abcdefghijk?t=42",
    start: 42,
    loop: true,
  },
  frameHidden: true,
};

describe("YouTube loop and hidden-frame persistence", () => {
  it("round-trips both flags through project, archive, trash, and clipboard", () => {
    const expected = { youtube: youtubeNote.youtube, frameHidden: true };
    const project = parseProjectIndex(serializeProjectIndex([youtubeNote]));
    expect(project.notes[0]).toMatchObject(expected);
    expect(mergeLoadedNotes(project, [{
      id: youtubeNote.id,
      name: youtubeNote.name,
      file: project.notes[0].file,
      text: youtubeNote.text,
      x: youtubeNote.x,
      y: youtubeNote.y,
      width: youtubeNote.width,
      height: youtubeNote.height,
    }])[0]).toMatchObject(expected);

    const archive = sanitizeArchiveEntries([{
      id: "archive-youtube",
      archivedAt: 1,
      note: youtubeNote,
      links: [],
    }]);
    expect(archive.warnings).toEqual([]);
    expect(archive.entries[0]?.note).toMatchObject(expected);

    const trash = sanitizeTrashEntries([{
      id: "trash-youtube",
      deletedAt: 1,
      notes: [youtubeNote],
      zones: [],
      links: [],
    }]);
    expect(trash.warnings).toEqual([]);
    expect(trash.entries[0]?.notes[0]).toMatchObject(expected);

    const clipboard = parseNotesPayload(serializeNotes([youtubeNote]));
    expect(clipboard?.nodes[0]).toMatchObject(expected);
  });

  it("keeps the hidden-frame flag specific to YouTube nodes", () => {
    const serialized = JSON.parse(serializeProjectIndex([youtubeNote])) as { notes: Record<string, unknown>[] };
    const rawNote = serialized.notes[0];
    if (!rawNote) throw new Error("Expected a serialized note.");
    rawNote.frameHidden = false;
    const parsed = parseProjectIndexWithWarnings(JSON.stringify(serialized));
    expect(parsed.index.notes[0]?.frameHidden).toBeUndefined();
    expect(parsed.warnings).toContain("Invalid hidden frame state for note youtube-hidden; it was cleared.");
  });
});
