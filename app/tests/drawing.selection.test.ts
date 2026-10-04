import { beforeEach, describe, expect, it, vi } from "vitest";
import { drawToolHandler } from "../src/drawing/toolRegistry";
import {
  buildSelectionArea,
  beginSelectionBorderMove,
  clearDrawingSelection,
  copySelectionPixels,
  deleteSelectionPixels,
  drawingSelection,
  isDrawingSelectionBorder,
  moveSelectionPixels,
  resizeSelectionArea,
  selectionMoveHandler,
  type RasterPixels,
} from "../src/drawing/selection.svelte";
import { drawingTools } from "../src/drawing/tools.svelte";
import type { DrawPointerEvent } from "../src/drawing/types";

const harness = vi.hoisted(() => ({
  pixels: new Uint8ClampedArray(8 * 8 * 4),
  commands: [] as Array<{ label: string; undo(): void; do(): void }>,
}));

vi.mock("../src/drawing/tileStore.svelte", () => ({
  drawingStore: {
    keysInRect: () => ["0:0"],
    async snapshot(keys: readonly string[]) {
      const bytes = harness.pixels.slice();
      return new Map(keys.map((key) => [key, new Blob([bytes.buffer as ArrayBuffer])]));
    },
    async restore(snapshot: Map<string, Blob | null>) {
      const blob = snapshot.values().next().value;
      if (blob) harness.pixels.set(new Uint8Array(await blob.arrayBuffer()));
    },
    commit() {},
    tile() { return null; },
  },
}));

vi.mock("../src/drawing/history", () => {
  async function restore(snapshot: Map<string, Blob | null>) {
    const blob = snapshot.values().next().value;
    if (blob) harness.pixels.set(new Uint8Array(await blob.arrayBuffer()));
  }
  return {
    readCompositeRect(x: number, y: number, width: number, height: number) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
          const source = ((y + row) * 8 + x + column) * 4;
          const target = (row * width + column) * 4;
          data.set(harness.pixels.subarray(source, source + 4), target);
        }
      }
      return { x, y, width, height, data };
    },
    affectedTileKeys: () => ["0:0"],
    rasterRectToWorld: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
    /** Single 8×8 level: paint copies opaque pixels, erase is destination-out by the source alpha. */
    applyAcrossLevels(source: { width: number; height: number; pixels: Uint8ClampedArray }, x: number, y: number, _level: number, kind: string) {
      for (let row = 0; row < source.height; row += 1) {
        for (let column = 0; column < source.width; column += 1) {
          const sourceOffset = (row * source.width + column) * 4;
          const targetOffset = ((y + row) * 8 + x + column) * 4;
          const alpha = source.pixels[sourceOffset + 3] ?? 0;
          if (alpha === 0) continue;
          if (kind === "erase") {
            const remaining = Math.round((harness.pixels[targetOffset + 3] ?? 0) * (1 - alpha / 255));
            if (remaining === 0) harness.pixels.fill(0, targetOffset, targetOffset + 4);
            else harness.pixels[targetOffset + 3] = remaining;
            continue;
          }
          harness.pixels.set(source.pixels.subarray(sourceOffset, sourceOffset + 4), targetOffset);
        }
      }
      return ["0:0"];
    },
    pushDrawingHistory(label: string, before: Map<string, Blob | null>, after: Map<string, Blob | null>) {
      harness.commands.push({ label, do() { void restore(after); }, undo() { void restore(before); } });
    },
  };
});

vi.mock("../src/history/history.svelte", () => ({
  record(command: { label: string; undo(): void; do(): void }) {
    harness.commands.push(command);
  },
}));

class TestImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

function pixel(data: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 4;
  return Array.from(data.subarray(offset, offset + 4));
}

function putPixel(data: Uint8ClampedArray, width: number, x: number, y: number, rgba: readonly number[]): void {
  data.set(rgba, (y * width + x) * 4);
}

function pointer(rasterX: number, rasterY: number, clientX: number, clientY: number, ctrl = false, alt = false, zoom = 1): DrawPointerEvent {
  return {
    world: { x: rasterX / 20, y: rasterY / 20 },
    client: { x: clientX, y: clientY },
    zoom,
    pressure: 0.5,
    shift: false,
    ctrl,
    alt,
    detail: 1,
  };
}

function selectRectangle(): NonNullable<ReturnType<typeof drawToolHandler>> {
  const handler = drawToolHandler("select-rect")!;
  handler.down(pointer(0.5, 0.5, 10, 10));
  handler.move(pointer(3.5, 1.5, 30, 20));
  handler.up(pointer(3.5, 1.5, 30, 20));
  return handler;
}

function key(code: string, value: string, ctrlKey = false): KeyboardEvent {
  return {
    code,
    key: value,
    ctrlKey,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    defaultPrevented: false,
    isComposing: false,
  } as KeyboardEvent;
}

function testCanvasDocument(): Document {
  return {
    createElement() {
      const canvas = {
        width: 0,
        height: 0,
        pixels: new Uint8ClampedArray(),
        getContext() {
          return {
            createImageData(width: number, height: number) {
              return new TestImageData(new Uint8ClampedArray(width * height * 4), width, height);
            },
            putImageData(image: TestImageData) { canvas.pixels = new Uint8ClampedArray(image.data); },
          };
        },
      };
      return canvas;
    },
  } as unknown as Document;
}

describe("drawing selection", () => {
  beforeEach(() => {
    harness.pixels = new Uint8ClampedArray(8 * 8 * 4);
    harness.commands.length = 0;
    drawingSelection.area = null;
    drawingSelection.preview = null;
    drawingSelection.floating = null;
    drawingSelection.floatingAt = null;
    drawingTools.active = "brush";
    vi.stubGlobal("document", testCanvasDocument());
    vi.stubGlobal("ImageData", TestImageData);
  });

  it("builds rectangular, lasso and polygon masks", () => {
    const rectangle = buildSelectionArea("select-rect", [{ x: 1, y: 1 }, { x: 4, y: 3 }]);
    const lasso = buildSelectionArea("select-lasso", [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 },
    ]);
    const polygon = buildSelectionArea("select-polygon", [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 4 },
    ]);

    expect(rectangle).not.toBeNull();
    expect(rectangle?.mask).toEqual(new Uint8Array(3 * 2).fill(255));
    expect(lasso?.mask).toEqual(new Uint8Array(4 * 4).fill(255));
    expect(polygon?.mask.filter((value) => value > 0).length).toBeGreaterThan(0);
    expect(polygon?.mask.filter((value) => value > 0).length).toBeLessThan(16);
  });

  it("resizes the area without scaling any raster pixels", () => {
    const area = buildSelectionArea("select-rect", [{ x: 1, y: 1 }, { x: 3, y: 3 }])!;
    const pixels: RasterPixels = { x: 0, y: 0, width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) };
    putPixel(pixels.data, 4, 1, 1, [220, 20, 10, 255]);

    const resized = resizeSelectionArea(area, "se", { x: 5, y: 5 });

    expect(resized).toMatchObject({ x: 1, y: 1, width: 4, height: 4 });
    expect(pixel(pixels.data, 4, 1, 1)).toEqual([220, 20, 10, 255]);
  });

  it("starts a replacement selection when a selection tool drag begins away from the border", () => {
    const handler = drawToolHandler("select-rect")!;
    handler.down(pointer(0.5, 0.5, 10, 10));
    handler.move(pointer(3.5, 3.5, 30, 30));
    handler.up(pointer(3.5, 3.5, 30, 30));
    expect(drawingSelection.area).not.toBeNull();

    const previousArea = drawingSelection.area!;
    const replacementStart = pointer(100, 100, 100, 100);
    expect(isDrawingSelectionBorder(replacementStart)).toBe(false);
    handler.down(replacementStart);
    handler.move(pointer(102, 102, 120, 120));
    handler.up(pointer(102, 102, 120, 120));
    expect(drawingSelection.area).not.toBe(previousArea);
    expect(drawingSelection.area?.x).toBeGreaterThan(previousArea.x + previousArea.width);
  });

  it("replaces a selection when a new gesture starts in its interior", () => {
    const handler = drawToolHandler("select-rect")!;
    handler.down(pointer(0.5, 0.5, 10, 10));
    handler.move(pointer(60.5, 60.5, 610, 610));
    handler.up(pointer(60.5, 60.5, 610, 610));
    const previousArea = drawingSelection.area!;
    const replacementStart = pointer(30.5, 30.5, 310, 310);
    expect(isDrawingSelectionBorder(replacementStart)).toBe(false);

    handler.down(replacementStart);
    handler.move(pointer(32.5, 32.5, 330, 330));
    handler.up(pointer(32.5, 32.5, 330, 330));

    expect(drawingSelection.area).not.toBe(previousArea);
    expect(drawingSelection.area?.x).toBeGreaterThan(previousArea.x);
    expect(drawingSelection.area?.y).toBeGreaterThan(previousArea.y);
  });

  it("moves only selected pixels, supports copy, and leaves other pixels intact", () => {
    const source: RasterPixels = { x: 0, y: 0, width: 6, height: 1, data: new Uint8ClampedArray(6 * 4) };
    putPixel(source.data, 6, 1, 0, [255, 0, 0, 255]);
    putPixel(source.data, 6, 5, 0, [0, 0, 255, 255]);
    const mask = new Uint8Array([255, 255, 255, 0, 0, 0]);

    const moved = moveSelectionPixels(source, mask, 2, 0);
    const copied = moveSelectionPixels(source, mask, 2, 0, true);
    const deleted = deleteSelectionPixels(source, mask);
    const copiedPiece = copySelectionPixels(source, mask);

    expect(pixel(moved.data, moved.width, 3, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(moved.data, moved.width, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(moved.data, moved.width, 5, 0)).toEqual([0, 0, 255, 255]);
    expect(pixel(copied.data, copied.width, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(copied.data, copied.width, 3, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(deleted.data, deleted.width, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(deleted.data, deleted.width, 5, 0)).toEqual([0, 0, 255, 255]);
    expect(pixel(copiedPiece.data, copiedPiece.width, 1, 0)).toEqual([255, 0, 0, 255]);
  });

  it("records a move as one undoable drawing action", async () => {
    putPixel(harness.pixels, 8, 1, 0, [255, 0, 0, 255]);
    putPixel(harness.pixels, 8, 5, 0, [0, 0, 255, 255]);
    const handler = selectRectangle()!;
    expect(drawingSelection.area).toMatchObject({ x: 0, y: 0, width: 4, height: 2 });

    handler.down(pointer(1.5, 0.5, 100, 10));
    handler.move(pointer(3.5, 0.5, 104, 10));
    handler.up(pointer(3.5, 0.5, 104, 10));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pixel(harness.pixels, 8, 3, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(harness.pixels, 8, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(harness.pixels, 8, 5, 0)).toEqual([0, 0, 255, 255]);
    expect(harness.commands).toHaveLength(1);
    expect(harness.commands[0]?.label).toBe("Move selection");

    harness.commands[0]?.undo();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pixel(harness.pixels, 8, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(harness.pixels, 8, 3, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(harness.pixels, 8, 5, 0)).toEqual([0, 0, 255, 255]);
  });

  it("starts a border move through the shared handler with one undo", async () => {
    putPixel(harness.pixels, 8, 1, 0, [255, 0, 0, 255]);
    selectRectangle();
    const start = pointer(1.5, 0.5, 100, 10);
    expect(isDrawingSelectionBorder(start)).toBe(true);
    expect(beginSelectionBorderMove(start)).toBe(true);

    selectionMoveHandler.move(pointer(3.5, 0.5, 104, 10));
    selectionMoveHandler.up(pointer(3.5, 0.5, 104, 10));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pixel(harness.pixels, 8, 3, 0)).toEqual([255, 0, 0, 255]);
    expect(harness.commands).toHaveLength(1);
    expect(harness.commands[0]?.label).toBe("Move selection");
  });

  it("moves from anywhere inside a selection with Ctrl and records one undo action", async () => {
    putPixel(harness.pixels, 8, 1, 0, [255, 0, 0, 255]);
    drawingTools.active = "select-rect";
    drawingSelection.area = buildSelectionArea("select-rect", [{ x: 0, y: 0 }, { x: 8, y: 8 }]);

    const interior = pointer(4, 4, 100, 10, true, false, 10);
    expect(isDrawingSelectionBorder(pointer(4, 4, 100, 10, false, false, 10))).toBe(false);
    expect(isDrawingSelectionBorder(interior)).toBe(true);
    expect(beginSelectionBorderMove(interior)).toBe(true);
    selectionMoveHandler.move(pointer(6, 4, 104, 10, true, false, 10));
    selectionMoveHandler.up(pointer(6, 4, 104, 10, true, false, 10));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pixel(harness.pixels, 8, 3, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(harness.pixels, 8, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(harness.commands).toHaveLength(1);
    expect(harness.commands[0]?.label).toBe("Move selection");
  });

  it("copies with Ctrl+Alt-drag and records one undo action", async () => {
    putPixel(harness.pixels, 8, 1, 0, [255, 0, 0, 255]);
    drawingTools.active = "select-rect";
    const handler = selectRectangle()!;

    handler.down(pointer(1.5, 0.5, 100, 10, true, true));
    handler.move(pointer(3.5, 0.5, 104, 10, true, true));
    handler.up(pointer(3.5, 0.5, 104, 10, true, true));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pixel(harness.pixels, 8, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(harness.pixels, 8, 3, 0)).toEqual([255, 0, 0, 255]);
    expect(harness.commands).toHaveLength(1);
    expect(harness.commands[0]?.label).toBe("Copy selection");

    harness.commands[0]?.undo();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pixel(harness.pixels, 8, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(harness.pixels, 8, 3, 0)).toEqual([0, 0, 0, 0]);
  });

  it("deletes and pastes through one history entry apiece", async () => {
    putPixel(harness.pixels, 8, 1, 0, [255, 0, 0, 255]);
    const handler = selectRectangle()!;

    handler.key?.(key("KeyC", "c", true));
    handler.move(pointer(4.5, 2.5, 140, 40));
    handler.key?.(key("KeyV", "v", true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pixel(harness.pixels, 8, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(harness.pixels, 8, 5, 2)).toEqual([255, 0, 0, 255]);
    expect(harness.commands.map(({ label }) => label)).toEqual(["Paste selection"]);

    drawingSelection.area = buildSelectionArea("select-rect", [{ x: 0, y: 0 }, { x: 4, y: 2 }]);
    handler.key?.(key("Delete", "Delete"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pixel(harness.pixels, 8, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(drawingSelection.area).not.toBeNull();
    expect(harness.commands.map(({ label }) => label)).toEqual(["Paste selection", "Delete selection"]);
  });

  it("clears the selection UI without changing pixels", () => {
    putPixel(harness.pixels, 8, 1, 0, [255, 0, 0, 255]);
    selectRectangle();
    const before = new Uint8ClampedArray(harness.pixels);

    clearDrawingSelection();

    expect(drawingSelection.area).toBeNull();
    expect(harness.pixels).toEqual(before);
    expect(harness.commands).toHaveLength(0);
  });
});
