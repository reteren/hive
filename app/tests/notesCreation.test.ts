import { describe, expect, it } from "vitest";
import {
  chooseCreationOrigin,
  createMenuPosition,
  creationObstacleForNote,
  estimatedCreationHeight,
  nearestFreeNoteCenter,
  notePositionAt,
  type CreationObstacle,
} from "../src/notes/creationPosition";

const camera = { x: 4, y: -2, zoom: 2 };
const viewport = { width: 800, height: 600 };

describe("note creation placement", () => {
  it("uses rendered initial heights before a note has its first DOM measurement", () => {
    expect(estimatedCreationHeight({ type: "note", width: 30, height: null, text: "" })).toBe(8.2);
    expect(estimatedCreationHeight({ type: "pro", width: 18, height: null, text: "" })).toBe(7.8);
    expect(estimatedCreationHeight({ type: "purpose", width: 14, height: null, text: "" })).toBe(4.2);
    expect(estimatedCreationHeight({ type: "note", width: 30, height: null, text: "" }, 9.4)).toBe(9.4);
    expect(creationObstacleForNote({ type: "note", x: 1, y: 2, width: 30, height: null, text: "" }, 9.4))
      .toEqual({ x: 1, y: 2, width: 30, height: 9.4 });
  });

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

  it("keeps a free target unchanged and allows bounds to touch without counting as overlap", () => {
    const obstacles: CreationObstacle[] = [{ x: 4, y: -1, width: 2, height: 2 }];
    expect(nearestFreeNoteCenter({ x: 2, y: 0 }, 2, 2, obstacles, false, 10)).toEqual({ x: 2, y: 0 });
    expect(nearestFreeNoteCenter({ x: 3, y: 0 }, 2, 2, obstacles, false, 10)).toEqual({ x: 3, y: 0 });
  });

  it("pushes an overlapping rectangle to the nearest touching edge", () => {
    expect(nearestFreeNoteCenter(
      { x: 0, y: 0 },
      4,
      4,
      [{ x: -2, y: -2, width: 4, height: 4 }],
      false,
      10,
    )).toEqual({ x: 0, y: -4 });
  });

  it("treats floating point edge contact with a 7.2-unit beacon as touching", () => {
    expect(nearestFreeNoteCenter(
      { x: 0, y: 0 },
      30,
      6,
      [{ x: -3.6, y: -3.6, width: 7.2, height: 7.2 }],
      false,
      10,
    )).toEqual({ x: 0, y: -6.6 });
  });

  it("keeps collision-resolved centres on the snap grid", () => {
    const placed = nearestFreeNoteCenter(
      { x: 6, y: 6 },
      2,
      2,
      [{ x: 4, y: 4, width: 2, height: 2 }],
      true,
      5,
    );
    expect(placed.x % 5).toBe(0);
    expect(placed.y % 5).toBe(0);
    expect(placed).toEqual({ x: 5, y: 0 });
  });

  it("places repeated pinned-menu creations around the original anchor", () => {
    const anchor = { x: 0, y: 0 };
    const placed: CreationObstacle[] = [];
    const centers = Array.from({ length: 4 }, () => {
      const center = nearestFreeNoteCenter(anchor, 4, 4, placed, false, 10);
      placed.push({ x: center.x - 2, y: center.y - 2, width: 4, height: 4 });
      return center;
    });
    expect(new Set(centers.map(({ x, y }) => `${x}:${y}`)).size).toBe(4);
    expect(centers).toContainEqual(anchor);
    for (let first = 0; first < placed.length; first += 1) {
      for (let second = first + 1; second < placed.length; second += 1) {
        const a = placed[first];
        const b = placed[second];
        expect(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y).toBe(false);
      }
    }
  });

  it("keeps two auto-height notes apart using their first rendered size", () => {
    const height = estimatedCreationHeight({ type: "note", width: 30, height: null, text: "" });
    const firstCenter = nearestFreeNoteCenter({ x: 0, y: 0 }, 30, height, [], false, 10);
    const first = { x: firstCenter.x - 15, y: firstCenter.y - height / 2, width: 30, height };
    const secondCenter = nearestFreeNoteCenter({ x: 0, y: 0 }, 30, height, [first], false, 10);
    const second = { x: secondCenter.x - 15, y: secondCenter.y - height / 2, width: 30, height };

    const touches = Math.abs(first.y + first.height - second.y) < 1e-9 ||
      Math.abs(second.y + second.height - first.y) < 1e-9 ||
      Math.abs(first.x + first.width - second.x) < 1e-9 ||
      Math.abs(second.x + second.width - first.x) < 1e-9;
    expect(touches).toBe(true);
    expect(first.x < second.x + second.width && first.x + first.width > second.x &&
      first.y < second.y + second.height && first.y + first.height > second.y).toBe(false);
  });

  it("keeps the menu inside the viewport near the lower-right edge", () => {
    expect(createMenuPosition({ x: 790, y: 590 }, viewport, { width: 164, height: 74 })).toEqual({
      x: 616,
      y: 506,
    });
  });
});
