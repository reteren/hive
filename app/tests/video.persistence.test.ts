import { describe, expect, it } from "vitest";
import { sanitizeArchiveEntries } from "../src/archive/serialization";
import { parseNotesPayload, serializeNotes } from "../src/clipboard/payload";
import type { Note } from "../src/model/note";
import { mergeLoadedNotes, parseProjectIndex, serializeProjectIndex } from "../src/project/index";
import { sanitizeTrashEntries } from "../src/trash/serialization";

const videoNote: Note = {
  id: "local-video",
  type: "video",
  name: "Clip.mp4",
  text: "Caption",
  x: 12,
  y: 18,
  width: 48,
  height: null,
  frameHidden: true,
  media: {
    file: "Clip.mp4",
    mime: "video/mp4",
    size: 30 * 1024 * 1024,
    name: "Clip.mp4",
    kind: "video",
    externalPath: "C:\\videos\\Clip.mp4",
    duration: 8.5,
    naturalWidth: 1920,
    naturalHeight: 1080,
  },
};

const youtubeNote: Note = {
  id: "youtube-video",
  type: "youtube",
  name: "Example",
  text: "",
  x: 30,
  y: 40,
  width: 48,
  height: null,
  youtube: {
    videoId: "abcdefghijk",
    url: "https://youtu.be/abcdefghijk?t=1m30s",
    title: "Example title",
    author: "Example channel",
    start: 90,
  },
};

describe("video node persistence", () => {
  it("round-trips local and YouTube video data through project, archive, trash and clipboard", () => {
    const notes = [videoNote, youtubeNote];
    const project = parseProjectIndex(serializeProjectIndex(notes));
    expect(project.notes.map(({ media, youtube, frameHidden }) => ({ media, youtube, frameHidden }))).toEqual([
      { media: videoNote.media, youtube: undefined, frameHidden: true },
      { media: undefined, youtube: youtubeNote.youtube, frameHidden: undefined },
    ]);

    const loaded = mergeLoadedNotes(project, notes.map((note) => ({
      id: note.id,
      name: note.name,
      file: project.notes.find((entry) => entry.id === note.id)!.file,
      text: note.text,
      x: note.x,
      y: note.y,
      width: note.width,
      height: note.height,
    })));
    expect(loaded.map(({ media, youtube, frameHidden }) => ({ media, youtube, frameHidden }))).toEqual([
      { media: videoNote.media, youtube: undefined, frameHidden: true },
      { media: undefined, youtube: youtubeNote.youtube, frameHidden: undefined },
    ]);

    const archive = sanitizeArchiveEntries(notes.map((note, index) => ({
      id: `archive-${index}`,
      archivedAt: index + 1,
      note,
      links: [],
    })));
    expect(archive.warnings).toEqual([]);
    expect(archive.entries.map(({ note }) => ({ media: note.media, youtube: note.youtube, frameHidden: note.frameHidden }))).toEqual([
      { media: videoNote.media, youtube: undefined, frameHidden: true },
      { media: undefined, youtube: youtubeNote.youtube, frameHidden: undefined },
    ]);

    const trash = sanitizeTrashEntries(notes.map((note, index) => ({
      id: `trash-${index}`,
      deletedAt: index + 1,
      notes: [note],
      zones: [],
      links: [],
    })));
    expect(trash.warnings).toEqual([]);
    expect(trash.entries.map(({ notes: saved }) => ({ media: saved[0]?.media, youtube: saved[0]?.youtube, frameHidden: saved[0]?.frameHidden }))).toEqual([
      { media: videoNote.media, youtube: undefined, frameHidden: true },
      { media: undefined, youtube: youtubeNote.youtube, frameHidden: undefined },
    ]);

    const clipboard = parseNotesPayload(serializeNotes(notes));
    expect(clipboard?.nodes.map(({ media, youtube, frameHidden }) => ({ media, youtube, frameHidden }))).toEqual([
      { media: videoNote.media, youtube: undefined, frameHidden: true },
      { media: undefined, youtube: youtubeNote.youtube, frameHidden: undefined },
    ]);
  });
});
