import { afterEach, describe, expect, it } from "vitest";
import { creationNameAllocator, moveCreationGroupToFreeSpot, placeCreationGrid, type CreationObstacle } from "../src/notes/creationPosition";
import { addNotes, board, onBoardMutation, removeNotes, replaceBoard } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import { createFormatNotesAsync } from "../src/formats/formatCreation";

function note(id: string, x = 0): Note {
  return { id, type: "note", name: id, text: "", x, y: 0, width: 10, height: 8, createdAt: 1 };
}

afterEach(() => replaceBoard([]));

describe("batched creation", () => {
  it("adds and removes node batches with one mutation notification each", () => {
    const notifications: Array<readonly string[] | null> = [];
    const stop = onBoardMutation((ids) => notifications.push(ids));
    try {
      addNotes([note("a"), note("b"), note("c")]);
      expect(board.order).toEqual(["a", "b", "c"]);
      expect(notifications).toEqual([["a", "b", "c"]]);

      expect(removeNotes(["a", "b", "missing", "c"])).toHaveLength(3);
      expect(board.order).toEqual([]);
      expect(notifications).toEqual([["a", "b", "c"], ["a", "b", "c"]]);
    } finally {
      stop();
    }
  });

  it("lays a large import batch in a grid with bounded spatial band queries", () => {
    let queries = 0;
    const items = Array.from({ length: 400 }, (_, index) => ({ id: index, width: 8, height: 6 }));
    const placed = placeCreationGrid(items, { x: 1000, y: 800 }, (bounds) => {
      queries += 1;
      expect(bounds.width).toBeGreaterThan(0);
      return [];
    }, false, 10);

    expect(queries).toBeLessThanOrEqual(4);
    expect(placed).toHaveLength(items.length);
    const columns = Math.ceil(Math.sqrt(items.length));
    expect(placed[1]!.x - placed[0]!.x).toBe(10);
    expect(placed[columns]!.y - placed[0]!.y).toBe(8);
  });

  it("moves a pasted group together around nearby board obstacles", () => {
    const obstacle: CreationObstacle = { x: 0, y: 0, width: 20, height: 20 };
    let queried = false;
    const moved = moveCreationGroupToFreeSpot([
      { type: "note", text: "a", x: 0, y: 0, width: 10, height: 8 },
      { type: "note", text: "b", x: 20, y: 0, width: 10, height: 8 },
    ], (bounds) => {
      queried = true;
      return bounds.x < obstacle.x + obstacle.width && bounds.x + bounds.width > obstacle.x &&
        bounds.y < obstacle.y + obstacle.height && bounds.y + bounds.height > obstacle.y ? [obstacle] : [];
    }, false, 10);

    expect(queried).toBe(true);
    expect(moved[1]!.x - moved[0]!.x).toBe(20);
    expect(moved[0]!.x).toBeGreaterThanOrEqual(22);
  });

  it("allocates repeated import names without rescanning the existing name list", () => {
    const createName = creationNameAllocator(["Photo", "photo 2"]);
    expect(Array.from({ length: 4 }, () => createName("PHOTO"))).toEqual([
      "PHOTO 3", "PHOTO 4", "PHOTO 5", "PHOTO 6",
    ]);

    const longName = "x".repeat(120);
    const allocateLong = creationNameAllocator([longName]);
    const suffixed = allocateLong(longName);
    expect(suffixed.endsWith(" 2")).toBe(true);
    expect(suffixed.length).toBeLessThanOrEqual(120);
  });

  it("prepares a large format import in slices and commits one board mutation", async () => {
    const notifications: Array<readonly string[] | null> = [];
    const stop = onBoardMutation((ids) => notifications.push(ids));
    const files = Array.from({ length: 501 }, (_, index) => ({
      kind: "text" as const,
      file: `batch-${index}.txt`,
      mime: "text/plain",
      size: 0,
      name: `Batch ${index}.txt`,
    }));
    try {
      const ids = await createFormatNotesAsync(files, { x: 100, y: 80 });
      expect(ids).toHaveLength(files.length);
      expect(board.order).toEqual(ids);
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toEqual(ids);
    } finally {
      stop();
    }
  });
});
