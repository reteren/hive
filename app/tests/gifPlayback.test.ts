import { afterEach, describe, expect, it } from "vitest";
import { parseNotesPayload, serializeNotes } from "../src/clipboard/payload";
import { sanitizeArchiveEntries, copyArchiveEntry } from "../src/archive/serialization";
import { parseProjectIndex, mergeLoadedNotes, serializeProjectIndex } from "../src/project/index";
import { sanitizeTrashEntries } from "../src/trash/serialization";
import { history } from "../src/history/history.svelte";
import { replaceBoard } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import { parseTiers } from "../src/model/nodeData";
import { isGifStopped, setGifStopped, shouldPlayGif, type GifPlaybackMode } from "../src/attachments/gifPlayback.svelte";
import { DEFAULT_VIEW_SETTINGS, parseViewSettings, serializeViewSettings } from "../src/settings/viewSettings";

const image = {
  file: `${"a".repeat(64)}.gif`,
  mime: "image/gif",
  size: 128,
  naturalWidth: 24,
  naturalHeight: 16,
} as const;

function imageNote(): Note {
  return {
    id: "gif-note",
    type: "image",
    name: "Animation",
    text: "",
    x: 2,
    y: 3,
    width: 24,
    height: 16,
    image: { ...image },
    gifStopped: true,
  };
}

afterEach(() => replaceBoard([]));

describe("GIF playback behavior", () => {
  it("implements Always, On hover, and When selected with stop taking precedence", () => {
    const modes: GifPlaybackMode[] = ["always", "hover", "selected"];
    const expected = [
      [true, true, true, false],
      [false, true, false, false],
      [false, false, true, false],
    ];
    for (const [modeIndex, mode] of modes.entries()) {
      const actual = [
        shouldPlayGif({ mode, stopped: false, selected: false, hovered: false }),
        shouldPlayGif({ mode, stopped: false, selected: false, hovered: true }),
        shouldPlayGif({ mode, stopped: false, selected: true, hovered: false }),
        shouldPlayGif({ mode, stopped: true, selected: true, hovered: true }),
      ];
      expect(actual).toEqual(expected[modeIndex]);
    }
  });

  it("lets inline and Tierlist GIFs play on hover in selected mode", () => {
    expect(shouldPlayGif({ mode: "selected", stopped: false, selected: false, hovered: true, hoverWhenSelected: true })).toBe(true);
    expect(shouldPlayGif({ mode: "selected", stopped: false, selected: false, hovered: true })).toBe(false);
  });

  it("persists the playback setting with view settings and defaults older files to Always", () => {
    expect(DEFAULT_VIEW_SETTINGS.gifPlayback).toBe("always");
    expect(parseViewSettings('{"gifPlayback":"hover"}', DEFAULT_VIEW_SETTINGS).gifPlayback).toBe("hover");
    expect(parseViewSettings('{"gifPlayback":"invalid"}', DEFAULT_VIEW_SETTINGS).gifPlayback).toBe("always");
    const saved = serializeViewSettings({ ...DEFAULT_VIEW_SETTINGS, gifPlayback: "selected" });
    expect(parseViewSettings(saved, DEFAULT_VIEW_SETTINGS).gifPlayback).toBe("selected");
  });

  it("keeps stopped state through project, archive, trash, and clipboard serialization", () => {
    const note = imageNote();
    const project = parseProjectIndex(serializeProjectIndex([note]));
    expect(project.notes[0]?.gifStopped).toBe(true);
    const loaded = mergeLoadedNotes(project, [{
      id: note.id,
      name: note.name,
      file: project.notes[0]!.file,
      text: note.text,
      x: note.x,
      y: note.y,
      width: note.width,
      height: note.height,
    }]);
    expect(loaded[0]?.gifStopped).toBe(true);

    const archive = sanitizeArchiveEntries([{ id: "archive-gif", archivedAt: 1, note, links: [] }]);
    expect(archive.entries[0]?.note.gifStopped).toBe(true);
    expect(copyArchiveEntry(archive.entries[0]!).note.gifStopped).toBe(true);

    const trash = sanitizeTrashEntries([{ id: "trash-gif", deletedAt: 2, notes: [note], zones: [], links: [] }]);
    expect(trash.entries[0]?.notes[0]?.gifStopped).toBe(true);

    const clipboard = parseNotesPayload(serializeNotes([note]));
    expect(clipboard?.nodes[0]?.gifStopped).toBe(true);
  });

  it("persists stopped Tierlist cards and changes stop state outside Undo", () => {
    const tiers = parseTiers([{
      id: "row-a",
      name: "A",
      color: "#808080",
      cards: [{ id: "card-a", kind: "image", image, stopped: true }],
    }]);
    expect(tiers?.[0]?.cards[0]).toMatchObject({ id: "card-a", kind: "image", stopped: true });

    const note = imageNote();
    note.gifStopped = undefined;
    replaceBoard([note]);
    const historyCount = history.entries.length;
    const target = { kind: "board", noteId: note.id } as const;
    setGifStopped(target, true);
    expect(isGifStopped(target)).toBe(true);
    expect(history.entries).toHaveLength(historyCount);
    setGifStopped(target, false);
    expect(isGifStopped(target)).toBe(false);
  });
});
