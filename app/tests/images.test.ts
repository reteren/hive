import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageRef } from "../src/attachments/types";
import { sanitizeArchiveEntries, copyArchiveEntry } from "../src/archive/serialization";
import { serializeNotes, parseNotesPayload } from "../src/clipboard/payload";
import { replaceBoard, board } from "../src/model/board.svelte";
import { noteMenuItems } from "../src/notes/noteMenu";
import type { Note } from "../src/model/note";
import { parseProjectIndex, mergeLoadedNotes, serializeProjectIndex } from "../src/project/index";
import { createImageNotes } from "../src/notes/noteCommands";
import { history, clear as clearHistory, undo, redo } from "../src/history/history.svelte";
import { initialImageSize, imageFirstOrder, imageNodeName, parseImageRef } from "../src/images/imageLogic";
import { imagePasteOrigin, runImageImportBatch } from "../src/images/imageActions";
import { resizeNote, resizeRuleForKind, minimumHeightForKind, minimumWidthForKind } from "../src/selection/resize";
import { createScaleModeGesture, normalizeScaleModeAtCommit, updateScaleModeGesture } from "../src/selection/gestures";
import { scaleGroupFrames } from "../src/selection/groupScale";
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
    flipX: true,
    flipY: true,
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

  it("does not offer a header toggle for image nodes", () => {
    const image = imageNote();
    replaceBoard([image]);
    expect(noteMenuItems(image.id).some((item) => item.id === "notes.toggleHeader")).toBe(false);
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
    expect(project.notes[0]?.flipX).toBe(true);
    expect(project.notes[0]?.flipY).toBe(true);
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
    expect(loaded[0]?.flipX).toBe(true);
    expect(loaded[0]?.flipY).toBe(true);
    expect(loaded[0]?.height).toBe(20);

    const archive = sanitizeArchiveEntries([{ id: "archive-1", archivedAt: 1, note, links: [] }]);
    expect(archive.warnings).toEqual([]);
    expect(archive.entries[0]?.note.image).toEqual(imageRef);
    expect(archive.entries[0]?.note.flipX).toBe(true);
    expect(archive.entries[0]?.note.flipY).toBe(true);
    expect(archive.entries[0]?.note.headerHidden).toBe(true);
    const copiedArchive = copyArchiveEntry(archive.entries[0]!);
    expect(copiedArchive.note.image).toEqual(imageRef);
    expect(copiedArchive.note.image).not.toBe(archive.entries[0]!.note.image);

    const trash = sanitizeTrashEntries([{ id: "trash-1", deletedAt: 2, notes: [note], zones: [], links: [] }]);
    expect(trash.warnings).toEqual([]);
    expect(trash.entries[0]?.notes[0]?.image).toEqual(imageRef);
    expect(trash.entries[0]?.notes[0]?.flipX).toBe(true);
    expect(trash.entries[0]?.notes[0]?.flipY).toBe(true);
    expect(trash.entries[0]?.notes[0]?.headerHidden).toBe(true);

    const clipboard = parseNotesPayload(serializeNotes([note]));
    expect(clipboard?.nodes[0]?.image).toEqual(imageRef);
    expect(clipboard?.nodes[0]?.flipX).toBe(true);
    expect(clipboard?.nodes[0]?.flipY).toBe(true);
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
      { x: -18, y: -9 },
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

  it("mirrors image resize handles across the opposite edge, including Ctrl aspect resize", () => {
    const initial = { id: "image", type: "image" as const, x: 10, y: 20, width: 20, height: 10 };
    const right = resizeNote(initial, 10, "right", { x: -30, y: 0 }, false, 10);
    expect(right).toMatchObject({ x: 0, y: 20, width: 10, height: 10, flipX: true });

    const bottom = resizeNote(initial, 10, "bottom", { x: 0, y: -15 }, false, 10);
    expect(bottom).toMatchObject({ x: 10, y: 15, width: 20, height: 5, flipY: true });

    const ctrl = resizeNote(initial, 10, "bottom-right", { x: -30, y: -15 }, false, 10, false, {}, true);
    expect(ctrl).toMatchObject({ width: 10, height: 5, flipX: true, flipY: true });
    expect(ctrl.width / ctrl.height!).toBe(2);
  });

  it("lets image S and group scale pass through zero and grow without a maximum", () => {
    const imageFrame = { id: "image", type: "image" as const, x: 0, y: 0, width: 20, height: 10, maxWidth: 40, maxHeight: 15 };
    const gesture = createScaleModeGesture([imageFrame], { x: 10, y: 5 }, { x: 20, y: 5 });
    const large = updateScaleModeGesture(gesture, { x: 110, y: 5 });
    expect(large.after[0]).toMatchObject({ width: 200, height: 100 });
    expect(normalizeScaleModeAtCommit(large)[0]).toMatchObject({ width: 200, height: 100, scale: undefined });

    const flipped = updateScaleModeGesture(gesture, { x: 0, y: 5 });
    expect(flipped.after[0]).toMatchObject({ flipX: true, flipY: true, width: 20, height: 10 });
    const atFloor = updateScaleModeGesture(gesture, { x: 10, y: 5 });
    expect(atFloor.after[0]).toMatchObject({ width: 8, height: 4 });

    const bounds = { x: 0, y: 0, width: 20, height: 10 };
    const hugeGroup = scaleGroupFrames([imageFrame], bounds, "right", { x: 200, y: 0 }, false, 10);
    expect(hugeGroup[0]?.width).toBe(220);
    const flippedGroup = scaleGroupFrames([imageFrame], bounds, "right", { x: -25, y: 0 }, false, 10);
    expect(flippedGroup[0]).toMatchObject({ x: -5, width: 5, flipX: true });
    const floorGroup = scaleGroupFrames([imageFrame], bounds, "right", { x: -19.5, y: 0 }, false, 10);
    expect(floorGroup[0]?.width).toBe(4);

    const regular = scaleGroupFrames([
      { id: "note", type: "note", x: 0, y: 0, width: 20, height: 20, maxWidth: 40 },
    ], bounds, "right", { x: 200, y: 0 }, false, 10);
    expect(regular[0]?.width).toBe(40);
  });

  it("places pasted images at the pointer or at the viewport centre when the pointer is absent", () => {
    const pointer = { x: 14, y: -8 };
    const fallback = { x: 100, y: 200 };
    expect(imagePasteOrigin(pointer, fallback)).toEqual(pointer);
    expect(imagePasteOrigin(null, fallback)).toEqual(fallback);
    expect(imagePasteOrigin(null, fallback)).not.toBe(fallback);
  });
});
