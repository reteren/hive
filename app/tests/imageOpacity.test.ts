import { beforeEach, describe, expect, it } from "vitest";
import { parseNotesPayload, serializeNotes } from "../src/clipboard/payload";
import { sanitizeArchiveEntries } from "../src/archive/serialization";
import { clear, history, undo } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import type { ArchiveEntry, TrashEntry } from "../src/model/retention.svelte";
import { serializeProjectIndex, parseProjectIndex } from "../src/project/index";
import { sanitizeTrashEntries } from "../src/trash/serialization";
import { noteMenuItemsForContext } from "../src/notes/noteMenu";
import {
  clampImageOpacity,
  imageOpacityFromSliderValue,
  imageOpacitySliderValue,
  normalizeImageOpacity,
} from "../src/images/imageLogic";
import {
  closeImageOpacityPopover,
  commitImageOpacity,
  openImageOpacityPopover,
  previewImageOpacity,
} from "../src/images/imageOpacity.svelte";

const image: Note = {
  id: "photo",
  type: "image",
  name: "Photo",
  text: "",
  x: 0,
  y: 0,
  width: 12,
  height: 9,
  image: {
    file: `${"a".repeat(64)}.png`,
    mime: "image/png",
    size: 1,
    naturalWidth: 640,
    naturalHeight: 480,
  },
  opacity: 0.55,
};

function imageNote(id: string, opacity = 0.55): Note {
  return { ...image, id, name: id, opacity };
}

beforeEach(() => {
  replaceBoard([]);
  clear();
  closeImageOpacityPopover();
});

describe("image opacity", () => {
  it("clamps persisted and slider values to the supported 5% steps", () => {
    expect(clampImageOpacity(0)).toBe(0.1);
    expect(clampImageOpacity(1.2)).toBe(1);
    expect(clampImageOpacity(0.67)).toBe(0.65);
    expect(normalizeImageOpacity("0.5")).toBeUndefined();
    expect(normalizeImageOpacity(0.67)).toBe(0.65);
    expect(imageOpacityFromSliderValue(0)).toBe(0.1);
    expect(imageOpacityFromSliderValue(5)).toBe(0.15);
    expect(imageOpacityFromSliderValue(90)).toBe(1);
    expect(imageOpacitySliderValue(0.55)).toBe(45);
  });

  it("persists opacity through project, archive, trash, and clipboard data", () => {
    const note = imageNote("persisted");
    const archived: ArchiveEntry = { id: "archived-photo", archivedAt: 100, note, links: [] };
    const deleted: TrashEntry = { id: "deleted-photo", deletedAt: 200, notes: [note], zones: [], links: [] };

    const project = parseProjectIndex(serializeProjectIndex([note]));
    expect(project.notes[0]?.opacity).toBe(0.55);

    const archivedProject = parseProjectIndex(serializeProjectIndex([], undefined, undefined, undefined, undefined, undefined, undefined, [archived]));
    expect(archivedProject.archive[0]?.note.opacity).toBe(0.55);
    expect(sanitizeArchiveEntries([archived]).entries[0]?.note.opacity).toBe(0.55);

    const trashProject = parseProjectIndex(serializeProjectIndex([], undefined, undefined, undefined, undefined, undefined, undefined, undefined, [deleted]));
    expect(trashProject.trash[0]?.notes[0]?.opacity).toBe(0.55);
    expect(sanitizeTrashEntries([deleted]).entries[0]?.notes[0]?.opacity).toBe(0.55);

    const copied = parseNotesPayload(serializeNotes([note]));
    expect(copied?.nodes[0]?.opacity).toBe(0.55);
  });

  it("previews without history and commits one undoable change", () => {
    replaceBoard([imageNote("undo-photo", 1)]);
    openImageOpacityPopover("undo-photo", { x: 2, y: 3 }, 1);

    previewImageOpacity(0.55);
    expect(board.notes["undo-photo"]?.opacity).toBe(0.55);
    expect(history.entries).toHaveLength(0);

    commitImageOpacity(0.55);
    expect(history.entries).toHaveLength(1);
    expect(board.notes["undo-photo"]?.opacity).toBe(0.55);

    undo();
    expect(board.notes["undo-photo"]?.opacity).toBeUndefined();
  });

  it("cancels an uncommitted preview when the popover is dismissed", () => {
    replaceBoard([imageNote("cancel-photo", 1)]);
    openImageOpacityPopover("cancel-photo", { x: 2, y: 3 }, 1);
    previewImageOpacity(0.4);
    closeImageOpacityPopover();

    expect(board.notes["cancel-photo"]?.opacity).toBeUndefined();
    expect(history.entries).toHaveLength(0);
  });

  it("shows the opacity action for still images and GIF nodes", () => {
    replaceBoard([
      imageNote("still"),
      { ...imageNote("gif"), image: { ...image.image!, file: `${"b".repeat(64)}.gif`, mime: "image/gif" } },
    ]);

    expect(noteMenuItemsForContext("still").find((item) => item.id === "image.opacity")?.label("still")).toBe("Opacity…");
    expect(noteMenuItemsForContext("gif", { kind: "board", noteId: "gif" }).find((item) => item.id === "image.opacity")?.label("gif"))
      .toBe("Opacity…");
  });
});
