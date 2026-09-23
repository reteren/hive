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

    expect(scaleGroupFrames(frames, groupBounds, "corner", { x: 50, y: 50 }, false, 10)).toEqual([
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

    const scaled = scaleGroupFrames(frames, bounds, "corner", { x: -70, y: -80 }, false, 10);
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

    const scaled = scaleGroupFrames(frames, groupBounds, "corner", { x: 50, y: 50 }, false, 10);
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

    const scaled = scaleGroupFrames(frames, groupBounds, "corner", { x: 50, y: 20 }, false, 10, true);
    expect(scaled[1].x / 50).toBeCloseTo(scaled[1].y / 40);
    expect(scaled[1].height).toBe(45);
    expect(scaled[0].width / 20).toBeCloseTo(scaled[1].height! / 30);
  });

  it("restores original frames on cancel and produces no history change", () => {
    const frames: NoteFrame[] = [
      { id: "a", x: 10, y: 10, width: 20, height: null },
      { id: "b", x: 40, y: 50, width: 20, height: 10 },
    ];
    const gesture = createGroupScaleGesture(frames, groupBounds, "corner", { x: 100, y: 100 });
    const preview = updateGroupScaleGesture(gesture, { x: 150, y: 150 }, false, 10);

    expect(cancelGroupScaleGesture(preview)).toEqual(frames);
    expect(groupScaleGestureChange(preview, true)).toBeNull();
  });
});
