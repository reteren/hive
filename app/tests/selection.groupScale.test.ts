import { describe, expect, it } from "vitest";
import {
  cancelGroupScaleGesture,
  createGroupScaleGesture,
  groupScaleGestureChange,
  scaleGroupFrames,
  updateGroupScaleGesture,
} from "../src/selection/groupScale";
import type { NoteFrame } from "../src/selection/gestures";
import type { Bounds } from "../src/notes/layout.svelte";
import { cacheMinimumTextWidth, clearMinimumTextWidth } from "../src/notes/layout.svelte";

const groupBounds: Bounds = { x: 0, y: 0, width: 100, height: 100 };

describe("group scale", () => {
  it("scales beacon positions while preserving their fixed size", () => {
    const frames: NoteFrame[] = [
      { id: "beacon", x: 20, y: 30, width: 7.2, height: 7.2 },
      { id: "note", x: 60, y: 70, width: 20, height: 20 },
    ];
    const gesture = createGroupScaleGesture(frames, groupBounds, "bottom-right", { x: 0, y: 0 }, new Set(), new Set(["beacon"]));
    const scaled = updateGroupScaleGesture(gesture, { x: 100, y: 100 }, false, 10);
    expect(scaled.after).toEqual([
      { id: "beacon", x: 40, y: 60, width: 7.2, height: 7.2 },
      { id: "note", x: 120, y: 140, width: 40, height: 40 },
    ]);
  });
  it("scales note positions and sizes proportionally from the group origin", () => {
    const frames: NoteFrame[] = [
      { id: "a", x: 0, y: 0, width: 20, height: 20 },
      { id: "b", x: 50, y: 40, width: 30, height: 30 },
    ];

    expect(scaleGroupFrames(frames, groupBounds, "bottom-right", { x: 50, y: 50 }, false, 10)).toEqual([
      { id: "a", x: 0, y: 0, width: 30, height: 30 },
      { id: "b", x: 75, y: 60, width: 45, height: 45 },
    ]);
  });

  it("clamps each scale axis for the whole group at the strictest node minimum", () => {
    const frames: NoteFrame[] = [
      { id: "a", type: "note", x: 0, y: 0, width: 40, height: 10 },
      { id: "b", type: "note", x: 50, y: 40, width: 50, height: 20 },
    ];
    const bounds = { x: 0, y: 0, width: 100, height: 100 };

    const scaled = scaleGroupFrames(frames, bounds, "bottom-right", { x: -70, y: -80 }, false, 10);
    expect(scaled).toEqual([
      { id: "a", type: "note", x: 0, y: 0, width: 30, height: 8.2 },
      { id: "b", type: "note", x: 37.5, y: 32.8, width: 37.5, height: 16.4 },
    ]);
  });

  it("moves fixed-size R5 and R6 nodes during group scaling without resizing them", () => {
    const frames: NoteFrame[] = [
      { id: "goal", type: "goal", x: 10, y: 10, width: 30, height: null },
      { id: "progress", type: "progress", x: 20, y: 20, width: 30, height: null },
      { id: "stats", type: "stats", x: 30, y: 30, width: 30, height: null },
      { id: "trash", type: "trash", x: 40, y: 40, width: 40, height: 40 },
      { id: "archive", type: "archive", x: 50, y: 50, width: 40, height: 40 },
      { id: "list", type: "list", x: 55, y: 55, width: 30, height: 18 },
      { id: "tierlist", type: "tierlist", x: 58, y: 58, width: 60, height: 28 },
      { id: "markas", type: "markas", x: 59, y: 59, width: 30, height: 14 },
      { id: "note", type: "note", x: 60, y: 60, width: 20, height: 20 },
    ];

    const scaled = scaleGroupFrames(frames, groupBounds, "bottom-right", { x: 100, y: 100 }, false, 10);

    expect(scaled.map(({ width, height }) => [width, height])).toEqual([
      [30, null],
      [30, null],
      [30, null],
      [40, 40],
      [40, 40],
      [30, 18],
      [60, 28],
      [30, 14],
      [40, 40],
    ]);
    expect(scaled.slice(0, 8).map(({ x, y }) => [x, y])).toEqual([
      [20, 20], [40, 40], [60, 60], [80, 80], [100, 100], [110, 110], [116, 116], [118, 118],
    ]);
  });

  it("keeps Map's existing 20 by 15 minimum during group scaling", () => {
    const scaled = scaleGroupFrames(
      [{ id: "map", type: "map", x: 0, y: 0, width: 40, height: 30 }],
      { x: 0, y: 0, width: 40, height: 30 },
      "bottom-right",
      { x: -100, y: -100 },
      false,
      10,
    );
    expect(scaled[0]).toMatchObject({ width: 20, height: 15 });
  });

  it("keeps group-scaled notes at their text-fit minimum width", () => {
    cacheMinimumTextWidth("wide-line", 30);
    try {
      const scaled = scaleGroupFrames(
        [{ id: "wide-line", type: "note", x: 0, y: 0, width: 40, height: 10, maxWidth: 75 }],
        { x: 0, y: 0, width: 40, height: 10 },
        "right",
        { x: -36, y: 0 },
        false,
        10,
      );
      expect(scaled[0].width).toBe(30);
    } finally {
      clearMinimumTextWidth("wide-line");
    }
  });

  it("scales auto-height note width and position while keeping its height automatic", () => {
    const frames: NoteFrame[] = [
      { id: "auto", x: 10, y: 20, width: 20, height: null },
      { id: "manual", x: 40, y: 50, width: 20, height: 10 },
    ];

    const scaled = scaleGroupFrames(frames, groupBounds, "bottom-right", { x: 50, y: 50 }, false, 10);
    expect(scaled).toEqual([
      { id: "auto", x: 15, y: 30, width: 30, height: null },
      { id: "manual", x: 60, y: 75, width: 30, height: 15 },
    ]);
  });

  it("snaps the dragged group edge to the grid", () => {
    const frames: NoteFrame[] = [{ id: "a", x: 3, y: 7, width: 37, height: 23 }];
    const bounds = { x: 3, y: 7, width: 37, height: 23 };

    const scaled = scaleGroupFrames(frames, bounds, "right", { x: 7, y: 0 }, true, 10);
    expect(scaled[0].x).toBe(3);
    expect(scaled[0].width).toBe(47);
  });

  it("uses a uniform scale on a Shift corner drag", () => {
    const frames: NoteFrame[] = [
      { id: "a", x: 0, y: 0, width: 20, height: 20 },
      { id: "b", x: 50, y: 40, width: 30, height: 30 },
    ];

    const scaled = scaleGroupFrames(frames, groupBounds, "bottom-right", { x: 50, y: 20 }, false, 10, true);
    expect(scaled[1].x / 50).toBeCloseTo(scaled[1].y / 40);
    expect(scaled[1].height).toBe(45);
    expect(scaled[0].width / 20).toBeCloseTo(scaled[1].height! / 30);
  });

  it("restores original frames on cancel and produces no history change", () => {
    const frames: NoteFrame[] = [
      { id: "a", x: 10, y: 10, width: 20, height: null },
      { id: "b", x: 40, y: 50, width: 20, height: 10 },
    ];
    const gesture = createGroupScaleGesture(frames, groupBounds, "bottom-right", { x: 100, y: 100 });
    const preview = updateGroupScaleGesture(gesture, { x: 150, y: 150 }, false, 10);

    expect(cancelGroupScaleGesture(preview)).toEqual(frames);
    expect(groupScaleGestureChange(preview, true)).toBeNull();
  });

  it("anchors all eight group handles at the opposite sides", () => {
    const frame: NoteFrame = { id: "a", x: 0, y: 0, width: 100, height: 100 };
    const cases = [
      ["top-left", { x: -50, y: -50 }, { x: -50, y: -50, width: 150, height: 150 }],
      ["top", { x: 0, y: -50 }, { x: 0, y: -50, width: 100, height: 150 }],
      ["top-right", { x: 50, y: -50 }, { x: 0, y: -50, width: 150, height: 150 }],
      ["right", { x: 50, y: 0 }, { x: 0, y: 0, width: 150, height: 100 }],
      ["bottom-right", { x: 50, y: 50 }, { x: 0, y: 0, width: 150, height: 150 }],
      ["bottom", { x: 0, y: 50 }, { x: 0, y: 0, width: 100, height: 150 }],
      ["bottom-left", { x: -50, y: 50 }, { x: -50, y: 0, width: 150, height: 150 }],
      ["left", { x: -50, y: 0 }, { x: -50, y: 0, width: 150, height: 100 }],
    ] as const;

    for (const [edge, delta, expected] of cases) {
      expect(scaleGroupFrames([frame], groupBounds, edge, delta, false, 10)).toEqual([
        { id: "a", ...expected },
      ]);
    }
  });

  it("keeps the opposite group corner fixed when the scale clamps at node minima", () => {
    const frames: NoteFrame[] = [
      { id: "a", x: 0, y: 0, width: 20, height: 10 },
      { id: "b", x: 60, y: 80, width: 40, height: 20 },
    ];

    expect(scaleGroupFrames(frames, groupBounds, "top-left", { x: 80, y: 80 }, false, 10)).toEqual([
      { id: "a", x: -50, y: 18, width: 30, height: 8.2 },
      { id: "b", x: 40, y: 83.6, width: 60, height: 16.4 },
    ]);
  });

  it("keeps Shift corner proportions from each corner anchor", () => {
    const frames: NoteFrame[] = [
      { id: "a", x: 0, y: 0, width: 20, height: 20 },
      { id: "b", x: 50, y: 40, width: 30, height: 30 },
    ];

    const scaled = scaleGroupFrames(frames, groupBounds, "top-left", { x: -50, y: -20 }, false, 10, true);
    expect(scaled).toEqual([
      { id: "a", x: -50, y: -50, width: 30, height: 30 },
      { id: "b", x: 25, y: 10, width: 45, height: 45 },
    ]);
  });

  it("scales mixed group positions while keeping module width and clamping its height", () => {
    const frames: NoteFrame[] = [
      { id: "module", type: "purpose", x: 10, y: 20, width: 14, height: 4 },
      { id: "note", x: 50, y: 40, width: 30, height: 20 },
    ];
    const modules = new Set(["module"]);

    expect(scaleGroupFrames(frames, groupBounds, "bottom-right", { x: 100, y: 200 }, false, 10, false, modules)).toEqual([
      { id: "module", type: "purpose", x: 20, y: 60, width: 14, height: 8 },
      { id: "note", x: 100, y: 120, width: 60, height: 60 },
    ]);
    expect(scaleGroupFrames(frames, groupBounds, "bottom-right", { x: -50, y: -80 }, false, 10, false, modules)).toEqual([
      { id: "module", type: "purpose", x: 10, y: 8.2, width: 14, height: 4.2 },
      { id: "note", x: 50, y: 16.4, width: 30, height: 8.2 },
    ]);
  });

  it("lets a group of modules shrink and snaps positions without scaling their widths", () => {
    const frames: NoteFrame[] = [
      { id: "importance", type: "importance", x: 3, y: 3, width: 14, height: 4 },
      { id: "mood", type: "mood", x: 43, y: 43, width: 14, height: 8 },
    ];
    const bounds = { x: 3, y: 3, width: 54, height: 48 };
    const modules = new Set(["importance", "mood"]);
    const scaled = scaleGroupFrames(frames, bounds, "top-left", { x: 25, y: 25 }, true, 10, false, modules);

    expect(scaled.map((frame) => frame.width)).toEqual([14, 14]);
    expect(scaled.map((frame) => frame.height)).toEqual([4, 4.2]);
    expect(scaled[0].x).toBeGreaterThan(frames[0].x);
    expect(scaled[0].y).toBeGreaterThan(frames[0].y);
  });

  it("clamps over-limit notes per item while scaling the rest", () => {
    const frames: NoteFrame[] = [
      { id: "bounded", type: "pro", x: 40, y: 20, width: 30, height: 10, maxWidth: 45, maxHeight: 14 },
      { id: "free", type: "note", x: 60, y: 30, width: 20, height: 10, maxWidth: 75, maxHeight: 30 },
    ];
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const scaled = scaleGroupFrames(frames, bounds, "bottom-right", { x: 100, y: 100 }, false, 10);
    expect(scaled.map((frame) => frame.width)).toEqual([45, 40]);
    expect(scaled.map((frame) => frame.height)).toEqual([14, 20]);
    expect(scaled.map((frame) => frame.x)).toEqual([80, 120]);
  });
});
