import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageRef } from "../src/attachments/types";
import { sanitizeArchiveEntries, copyArchiveEntry } from "../src/archive/serialization";
import { serializeNotes, parseNotesPayload } from "../src/clipboard/payload";
import { replaceBoard, board } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import { parseProjectIndex, mergeLoadedNotes, serializeProjectIndex } from "../src/project/index";
import { createImageNotes } from "../src/notes/noteCommands";
import { history, clear as clearHistory, undo, redo } from "../src/history/history.svelte";
import { initialImageSize, imageFirstOrder, imageNodeName, parseImageRef } from "../src/images/imageLogic";
import { runImageImportBatch } from "../src/images/imageActions";
import { resizeNote, resizeRuleForKind, minimumHeightForKind, minimumWidthForKind } from "../src/selection/resize";
import { sanitizeTrashEntries } from "../src/trash/serialization";

const imageRef: ImageRef = {
  file: `${"a".repeat(64)}.png`,
  mime: "image/png",
  size: 1200,
  name: "D:\\Photos\\Board image.png",
  naturalWidth: 2000,
  naturalHeight: 1000,
};

function imageNote(id = "image-1"): Note {
  return {
    id,
    type: "image",
    name: "Board image",
    text: "",
    x: 10,
    y: 20,
    width: 40,
    height: 20,
    headerHidden: true,
    image: { ...imageRef },
  };
}

beforeEach(() => {
  replaceBoard([]);
  clearHistory();
});

describe("board images", () => {
  it("fits large and small imports to board units without changing their aspect ratio", () => {
    expect(initialImageSize({ naturalWidth: 4000, naturalHeight: 2000 })).toEqual({ width: 40, height: 20 });
    expect(initialImageSize({ naturalWidth: 100, naturalHeight: 50 })).toEqual({ width: 10, height: 5 });
    expect(initialImageSize({ naturalWidth: 20, naturalHeight: 40 })).toEqual({ width: 3, height: 6 });
  });

  it("uses the file name without its extension and falls back to Image", () => {
    expect(imageNodeName(imageRef.name)).toBe("Board image");
    expect(imageNodeName(".png")).toBe("Image");
    expect(imageNodeName()).toBe("Image");
  });

  it("renders image ids first while preserving image and non-image order", () => {
    const notes = {
      noteA: { type: "note" },
      imageA: { type: "image" },
      beacon: { type: "beacon" },
      imageB: { type: "image" },
    } as const;
    expect(imageFirstOrder(["noteA", "imageA", "beacon", "imageB"], notes)).toEqual([
      "imageA", "imageB", "noteA", "beacon",
    ]);
  });

  it("creates imported images as fixed-height nodes in one undo step", () => {
    const ids = createImageNotes([imageRef, { ...imageRef, name: "Board image.png" }], { x: 100, y: 80 });
    expect(ids).toHaveLength(2);
    expect(board.order).toEqual(ids);
    expect(history.cursor).toBe(1);
    expect(history.entries).toHaveLength(1);
    expect(board.notes[ids[0]!]).toMatchObject({
      type: "image", name: "Board image", x: 80, y: 70, width: 40, height: 20,
      headerHidden: true, text: "", image: imageRef,
    });
    expect(typeof board.notes[ids[0]!]?.createdAt).toBe("number");
    expect(board.notes[ids[1]!]!.name).toBe("Board image 2");

    undo();
    expect(board.order).toEqual([]);
    redo();
    expect(board.order).toEqual(ids);
  });

  it("does not create nodes or history entries when any file import fails", async () => {
    const report = vi.fn();
    const create = vi.fn();
    try {
      const imported = await runImageImportBatch(
        ["valid.png", "unsupported.txt"],
        async (path) => path.endsWith(".png")
          ? { ok: true as const, image: imageRef }
          : { ok: false as const, error: "Unsupported file type: .txt" },
        { x: 0, y: 0 },
        create,
        report,
      );
      expect(imported).toBe(false);
      expect(report).toHaveBeenCalledWith("Unsupported file type: .txt");
      expect(create).not.toHaveBeenCalled();
      expect(board.order).toEqual([]);
      expect(history.entries).toEqual([]);
      expect(history.cursor).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("round trips through project, archive, trash, and Hive clipboard data", () => {
    const note = imageNote();
    const project = parseProjectIndex(serializeProjectIndex([note]));
    expect(project.notes[0]?.image).toEqual(imageRef);
    const loaded = mergeLoadedNotes(project, [{
      id: note.id,
      name: note.name,
      file: project.notes[0]!.file,
      text: "",
      x: note.x,
      y: note.y,
      width: note.width,
      height: note.height,
    }]);
    expect(loaded[0]?.image).toEqual(imageRef);
    expect(loaded[0]?.height).toBe(20);

    const archive = sanitizeArchiveEntries([{ id: "archive-1", archivedAt: 1, note, links: [] }]);
    expect(archive.warnings).toEqual([]);
    expect(archive.entries[0]?.note.image).toEqual(imageRef);
    expect(archive.entries[0]?.note.headerHidden).toBe(true);
    const copiedArchive = copyArchiveEntry(archive.entries[0]!);
    expect(copiedArchive.note.image).toEqual(imageRef);
    expect(copiedArchive.note.image).not.toBe(archive.entries[0]!.note.image);

    const trash = sanitizeTrashEntries([{ id: "trash-1", deletedAt: 2, notes: [note], zones: [], links: [] }]);
    expect(trash.warnings).toEqual([]);
    expect(trash.entries[0]?.notes[0]?.image).toEqual(imageRef);
    expect(trash.entries[0]?.notes[0]?.headerHidden).toBe(true);

    const clipboard = parseNotesPayload(serializeNotes([note]));
    expect(clipboard?.nodes[0]?.image).toEqual(imageRef);
    expect(clipboard?.nodes[0]?.headerHidden).toBe(true);
  });

  it("repairs a missing project image height and rejects heightless retained copies", () => {
    const projectData = JSON.parse(serializeProjectIndex([imageNote()])) as { notes: { height: number | null }[] };
    const projectNote = projectData.notes[0] as unknown as { height: number | null };
    projectNote.height = null;
    expect(parseProjectIndex(JSON.stringify(projectData)).notes[0]?.height).toBe(20);

    const note = imageNote();
    expect(sanitizeArchiveEntries([{
      id: "archive-heightless",
      archivedAt: 1,
      note: { ...note, height: null },
      links: [],
    }]).entries).toHaveLength(0);
    expect(sanitizeTrashEntries([{
      id: "trash-heightless",
      deletedAt: 2,
      notes: [{ ...note, height: null }],
      zones: [],
      links: [],
    }]).entries).toHaveLength(0);

    const payload = JSON.parse(serializeNotes([note])) as { nodes: { height: number | null }[] };
    payload.nodes[0]!.height = null;
    expect(parseNotesPayload(JSON.stringify(payload))).toBeNull();
  });

  it("validates image refs and limits resized images to 4 by 4 units", () => {
    expect(parseImageRef(imageRef)).toEqual(imageRef);
    expect(parseImageRef({ ...imageRef, file: `${"a".repeat(64)}.gif` })).toBeNull();
    expect(resizeRuleForKind("image")).toMatchObject({ width: "free", height: "free", handles: "all" });
    expect(minimumWidthForKind("image")).toBe(4);
    expect(minimumHeightForKind("image")).toBe(4);

    const resized = resizeNote(
      { id: "image", type: "image", x: 0, y: 0, width: 20, height: 10, maxWidth: 80 },
      10,
      "bottom-right",
      { x: -100, y: -100 },
      false,
      10,
      false,
      {},
      true,
    );
    expect(resized.width).toBe(8);
    expect(resized.height).toBe(4);
    expect(resized.width / resized.height!).toBe(2);
  });
});
