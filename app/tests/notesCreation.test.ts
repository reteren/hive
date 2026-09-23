import { describe, expect, it } from "vitest";
import { chooseCreationOrigin, createMenuPosition, notePositionAt } from "../src/notes/creationPosition";

const camera = { x: 4, y: -2, zoom: 2 };
const viewport = { width: 800, height: 600 };

describe("note creation placement", () => {
  it("opens from the cursor for the keyboard trigger", () => {
    expect(chooseCreationOrigin("keyboard", { x: 10, y: 3 }, camera, viewport)).toEqual({
      world: { x: 10, y: 3 },
      screen: { x: 520, y: 400 },
    });
  });

  it("uses the viewport centre when the keyboard cursor is off the board", () => {
    expect(chooseCreationOrigin("keyboard", null, camera, viewport)).toEqual({
      world: { x: 4, y: -2 },
      screen: { x: 400, y: 300 },
    });
  });

  it("uses the viewport centre for the toolbar even with a board cursor", () => {
    expect(chooseCreationOrigin("toolbar", { x: 10, y: 3 }, camera, viewport)).toEqual({
      world: { x: 4, y: -2 },
      screen: { x: 400, y: 300 },
    });
  });

  it("centres a note on the origin and snaps that centre when snapping is enabled", () => {
    expect(notePositionAt({ x: 13, y: -13 }, 30, 20, false, 10)).toEqual({ x: -2, y: -23 });
    const snappedTopLeft = notePositionAt({ x: 13, y: -13 }, 30, 20, true, 10);
    expect(snappedTopLeft).toEqual({ x: -5, y: -20 });
    expect({ x: snappedTopLeft.x + 15, y: snappedTopLeft.y + 10 }).toEqual({ x: 10, y: -10 });
  });

  it("keeps the menu inside the viewport near the lower-right edge", () => {
    expect(createMenuPosition({ x: 790, y: 590 }, viewport, { width: 164, height: 74 })).toEqual({
      x: 616,
      y: 506,
    });
  });
});
