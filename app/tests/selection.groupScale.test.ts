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

const groupBounds: Bounds = { x: 0, y: 0, width: 100, height: 100 };

describe("group scale", () => {
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
      { id: "a", x: 0, y: 0, width: 20, height: 10 },
      { id: "b", x: 50, y: 40, width: 40, height: 20 },
    ];
    const bounds = { x: 0, y: 0, width: 100, height: 100 };

    const scaled = scaleGroupFrames(frames, bounds, "bottom-right", { x: -70, y: -80 }, false, 10);
    expect(scaled).toEqual([
      { id: "a", x: 0, y: 0, width: 12, height: 6 },
      { id: "b", x: 30, y: 24, width: 24, height: 12 },
    ]);
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
      { id: "a", x: 40, y: 40, width: 12, height: 6 },
      { id: "b", x: 76, y: 88, width: 24, height: 12 },
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
      { id: "module", x: 10, y: 20, width: 14, height: 4 },
      { id: "note", x: 50, y: 40, width: 30, height: 20 },
    ];
    const modules = new Set(["module"]);

    expect(scaleGroupFrames(frames, groupBounds, "bottom-right", { x: 100, y: 200 }, false, 10, false, modules)).toEqual([
      { id: "module", x: 20, y: 60, width: 14, height: 8 },
      { id: "note", x: 100, y: 120, width: 60, height: 60 },
    ]);
    expect(scaleGroupFrames(frames, groupBounds, "bottom-right", { x: -50, y: -80 }, false, 10, false, modules)).toEqual([
      { id: "module", x: 5, y: 6, width: 14, height: 4 },
      { id: "note", x: 25, y: 12, width: 15, height: 6 },
    ]);
  });

  it("lets a group of modules shrink and snaps positions without scaling their widths", () => {
    const frames: NoteFrame[] = [
      { id: "importance", x: 3, y: 3, width: 14, height: 4 },
      { id: "mood", x: 43, y: 43, width: 14, height: 8 },
    ];
    const bounds = { x: 3, y: 3, width: 54, height: 48 };
    const modules = new Set(["importance", "mood"]);
    const scaled = scaleGroupFrames(frames, bounds, "top-left", { x: 25, y: 25 }, true, 10, false, modules);

    expect(scaled.map((frame) => frame.width)).toEqual([14, 14]);
    expect(scaled.map((frame) => frame.height)).toEqual([4, 4]);
    expect(scaled[0].x).toBeGreaterThan(frames[0].x);
    expect(scaled[0].y).toBeGreaterThan(frames[0].y);
  });
});
