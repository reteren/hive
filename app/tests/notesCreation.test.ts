import { describe, expect, it } from "vitest";
import {
  chooseCreationOrigin,
  CREATION_GAP,
  createMenuPosition,
  creationObstacleForNote,
  estimatedCreationHeight,
  nearestFreeNoteCenter,
  RANDOM_CREATION_GAP_MAX,
  RANDOM_CREATION_GAP_MIN,
  notePositionAt,
  randomFreeNoteCenter,
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

  it("keeps a free target unchanged when it already has the required clearance", () => {
    const obstacles: CreationObstacle[] = [{ x: 104, y: 99, width: 2, height: 2 }];
    expect(nearestFreeNoteCenter({ x: 100, y: 100 }, 2, 2, obstacles, false, 10)).toEqual({ x: 100, y: 100 });
    expect(nearestFreeNoteCenter({ x: 101, y: 100 }, 2, 2, obstacles, false, 10)).toEqual({ x: 101, y: 100 });
  });

  it("places an overlapping rectangle to the right first with the minimum gap", () => {
    expect(nearestFreeNoteCenter(
      { x: 100, y: 100 },
      4,
      4,
      [{ x: 98, y: 98, width: 4, height: 4 }],
      false,
      10,
    )).toEqual({ x: 106, y: 100 });
    expect(CREATION_GAP).toBe(2);
  });

  it("keeps at least two units between a new note and a beacon", () => {
    const placed = nearestFreeNoteCenter(
      { x: 100, y: 100 },
      30,
      6,
      [{ x: 96.4, y: 96.4, width: 7.2, height: 7.2 }],
      false,
      10,
    );
    expect(placed.x).toBeCloseTo(120.6);
    expect(placed.y).toBeCloseTo(99.4);
  });

  it("continues a blocked placement to the right of its blocker", () => {
    expect(nearestFreeNoteCenter(
      { x: 100, y: 100 },
      4,
      4,
      [
        { x: 98, y: 98, width: 4, height: 4 },
        { x: 104, y: 98, width: 4, height: 4 },
      ],
      false,
      10,
    )).toEqual({ x: 112, y: 100 });
  });

  it("keeps collision-resolved centres on-grid and clears the gap when snapping is enabled", () => {
    const placed = nearestFreeNoteCenter(
      { x: 100, y: 100 },
      4,
      4,
      [{ x: 98, y: 98, width: 4, height: 4 }],
      true,
      5,
    );
    expect(placed.x % 5).toBe(0);
    expect(placed.y % 5).toBe(0);
    expect(placed).toEqual({ x: 110, y: 100 });
  });

  it("places repeated pinned-menu creations in a row to the right", () => {
    const anchor = { x: 100, y: 100 };
    const placed: CreationObstacle[] = [];
    const centers = Array.from({ length: 4 }, () => {
      const center = nearestFreeNoteCenter(anchor, 4, 4, placed, false, 10);
      placed.push({ x: center.x - 2, y: center.y - 2, width: 4, height: 4 });
      return center;
    });
    expect(centers).toEqual([
      anchor,
      { x: 106, y: 100 },
      { x: 112, y: 100 },
      { x: 118, y: 100 },
    ]);
    for (let first = 0; first < placed.length; first += 1) {
      for (let second = first + 1; second < placed.length; second += 1) {
        const a = placed[first];
        const b = placed[second];
        expect(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y).toBe(false);
      }
    }
  });

  it("keeps two auto-height notes at least two units apart using their first rendered size", () => {
    const height = estimatedCreationHeight({ type: "note", width: 30, height: null, text: "" });
    const firstCenter = nearestFreeNoteCenter({ x: 100, y: 100 }, 30, height, [], false, 10);
    const first = { x: firstCenter.x - 15, y: firstCenter.y - height / 2, width: 30, height };
    const secondCenter = nearestFreeNoteCenter({ x: 100, y: 100 }, 30, height, [first], false, 10);
    const second = { x: secondCenter.x - 15, y: secondCenter.y - height / 2, width: 30, height };

    const gapX = Math.max(first.x - (second.x + second.width), second.x - (first.x + first.width), 0);
    const gapY = Math.max(first.y - (second.y + second.height), second.y - (first.y + first.height), 0);
    expect(Math.hypot(gapX, gapY)).toBeGreaterThanOrEqual(CREATION_GAP);
  });

  it("treats the permanent ME beacon as an obstacle", () => {
    expect(nearestFreeNoteCenter({ x: 0, y: 0 }, 4, 4, [], false, 10)).toEqual({ x: 7.6, y: -1.6 });
  });

  it("keeps an unblocked random-placement origin and uses an injectable RNG for collisions", () => {
    const origin = { x: 100, y: 100 };
    expect(randomFreeNoteCenter(origin, 4, 4, [], false, 10, { rng: () => 0 })).toEqual(origin);
    const placed = randomFreeNoteCenter(
      origin,
      4,
      4,
      [{ x: 98, y: 98, width: 4, height: 4 }],
      false,
      10,
      { rng: () => 0.75 },
    );
    expect(placed).toEqual({ x: 132.75, y: 132.75 });
    expect(RANDOM_CREATION_GAP_MIN).toBe(10);
    expect(RANDOM_CREATION_GAP_MAX).toBe(35);
  });

  it("steps past each blocker with fresh random edge gaps and never overlaps", () => {
    const values = [0.75, 0.75, 0, 0, 0, 0];
    let index = 0;
    const placed = randomFreeNoteCenter(
      { x: 10, y: 10 },
      4,
      4,
      [
        { x: 8, y: 8, width: 4, height: 4 },
        { x: 20, y: 20, width: 20, height: 20 },
      ],
      false,
      10,
      { rng: () => values[index++] ?? 0 },
    );
    expect(placed).toEqual({ x: 52, y: 52 });
    for (const obstacle of [
      { x: 8, y: 8, width: 4, height: 4 },
      { x: 20, y: 20, width: 20, height: 20 },
    ]) {
      expect(placed.x - 2 < obstacle.x + obstacle.width && placed.x + 2 > obstacle.x &&
        placed.y - 2 < obstacle.y + obstacle.height && placed.y + 2 > obstacle.y).toBe(false);
    }
  });

  it("places Inbox entries at random 10–35 unit gaps from their anchor", () => {
    const anchor = { x: 0, y: 0, width: 20, height: 20 };
    const placed = randomFreeNoteCenter(
      { x: 10, y: 10 },
      4,
      4,
      [anchor],
      false,
      10,
      { anchor, rng: () => 0.75 },
    );
    expect(placed).toEqual({ x: 50.75, y: 50.75 });
    expect(placed.x - 2 - (anchor.x + anchor.width)).toBeGreaterThanOrEqual(RANDOM_CREATION_GAP_MIN);
    expect(placed.x - 2 - (anchor.x + anchor.width)).toBeLessThanOrEqual(RANDOM_CREATION_GAP_MAX);
    expect(placed.y - 2 - (anchor.y + anchor.height)).toBeGreaterThanOrEqual(RANDOM_CREATION_GAP_MIN);
    expect(placed.y - 2 - (anchor.y + anchor.height)).toBeLessThanOrEqual(RANDOM_CREATION_GAP_MAX);
  });

  it("keeps the menu inside the viewport near the lower-right edge", () => {
    expect(createMenuPosition({ x: 790, y: 590 }, viewport, { width: 164, height: 74 })).toEqual({
      x: 616,
      y: 506,
    });
  });
});
