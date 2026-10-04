import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/drawing/photoErase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/drawing/photoErase")>();
  return { ...actual, erasePhotoCopyOnWrite: vi.fn() };
});

import type { ImageRef } from "../src/attachments/types";
import { erasePhotoCopyOnWrite } from "../src/drawing/photoErase";
import { hasVisibleAlpha } from "../src/attachments/imageTransparency";
import { drawingTools } from "../src/drawing/tools.svelte";
import { finishImageErase, enterImageErase, imageErase } from "../src/attachments/imageErase.svelte";
import { clear, history, redo, undo } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import { noteMenuItemsForContext } from "../src/notes/noteMenu";
import { tool } from "../src/tools/tool.svelte";

const original: ImageRef = {
  file: `${"a".repeat(64)}.png`,
  mime: "image/png",
  size: 12,
  naturalWidth: 20,
  naturalHeight: 10,
  name: "photo.png",
};
const erased: ImageRef = { ...original, file: `${"b".repeat(64)}.png`, name: "photo.png" };

function imageNote(id: string, image: ImageRef = original): Note {
  return {
    id,
    type: "image",
    name: id,
    text: "",
    x: 0,
    y: 0,
    width: 20,
    height: 10,
    image,
  };
}

beforeEach(() => {
  finishImageErase();
  replaceBoard([]);
  clear();
  tool.active = "select";
  drawingTools.active = "brush";
  vi.mocked(erasePhotoCopyOnWrite).mockReset();
});

describe("image erase mode", () => {
  it("only enters erase mode for still image notes and hides Erase for GIFs", () => {
    replaceBoard([
      imageNote("still"),
      imageNote("gif", { ...original, file: `${"c".repeat(64)}.gif`, mime: "image/gif" }),
    ]);

    expect(enterImageErase("gif")).toBe(false);
    expect(imageErase.noteId).toBeNull();
    expect(noteMenuItemsForContext("gif").some((item) => item.id === "image.erase")).toBe(false);
    expect(enterImageErase("still")).toBe(true);
    expect(imageErase.noteId).toBe("still");
    expect(tool.active).toBe("draw");
    expect(drawingTools.active).toBe("eraser");

    finishImageErase();
    expect(imageErase.noteId).toBeNull();
    expect(tool.active).toBe("select");
    expect(drawingTools.active).toBe("brush");
  });

  it("can identify a fully transparent attachment without treating transparent RGB as visible", () => {
    expect(hasVisibleAlpha(new Uint8ClampedArray([255, 20, 90, 0, 0, 0, 0, 0]))).toBe(false);
    expect(hasVisibleAlpha(new Uint8ClampedArray([0, 0, 0, 1]))).toBe(true);
  });
});
