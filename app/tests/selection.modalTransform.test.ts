import { describe, expect, it } from "vitest";
import { HistoryStack } from "../src/history/historyStack";
import { RESIZE_EDGES } from "../src/selection/resize";
import { commands as commandRegistry } from "../src/commands/registry.svelte";
import {
  cancelMoveGesture,
  cancelScaleModeGesture,
  createMoveGesture,
  createScaleModeGesture,
  geometryHistoryCommand,
  normalizeScaleModeAtCommit,
  scaleModeKeyAction,
  scaleModePointerAction,
  shouldShowResizeHandle,
  updateMoveGesture,
  updateScaleModeGesture,
} from "../src/selection/gestures";
import type { NoteFrame } from "../src/selection/gestures";
import "../src/selection/selection.svelte";
import "../src/board/gridCommands";

describe("selection transform modes", () => {
  it("cancels G back to its start and records one move whose Undo preserves selection", () => {
    const before: NoteFrame[] = [{ id: "a", x: 2, y: 4, width: 20, height: 10 }];
    const gesture = updateMoveGesture(createMoveGesture(before, "a", { x: 0, y: 0 }), { x: 8, y: -3 }, false, 10);
    expect(cancelMoveGesture(gesture)).toEqual(before);

    const frames = [...gesture.after];
    const selectedIds = ["a"];
    const history = new HistoryStack();
    history.record(geometryHistoryCommand("Move", "A", before, frames, (next) => {
      frames.splice(0, frames.length, ...next);
    }));

    expect(history.entries).toHaveLength(1);
    history.undo();
    expect(frames).toEqual(before);
    expect(selectedIds).toEqual(["a"]);
  });

  it("radially scales every selected node around the pivot and clamps each Note.scale to 1–4×", () => {
    const frames: NoteFrame[] = [
      { id: "a", x: 0, y: 0, width: 20, height: 10, scale: 1, baseWidth: 20, baseHeight: 10 },
      { id: "b", x: 40, y: 20, width: 30, height: null, scale: 2, baseWidth: 15, baseHeight: null },
    ];
    const gesture = createScaleModeGesture(frames, { x: 20, y: 10 }, { x: 30, y: 10 });
    const scaled = updateScaleModeGesture(gesture, { x: 40, y: 10 });

    expect(scaled.factor).toBe(2);
    expect(scaled.after).toEqual([
      { ...frames[0], x: -20, y: -10, width: 40, height: 20, scale: 2, scaleGesture: true },
      { ...frames[1], x: 60, y: 30, width: 60, height: null, scale: 4, scaleGesture: true },
    ]);
  });

  it("keeps a zero-distance start finite and restores original sizes when a scale is cancelled", () => {
    const frame: NoteFrame = {
      id: "a", x: 10, y: 5, width: 40, height: 20, scale: 2,
      baseWidth: 20, baseHeight: 10,
    };
    const gesture = createScaleModeGesture([frame], { x: 0, y: 0 }, { x: 0, y: 0 }, 0.5);
    const scaled = updateScaleModeGesture(gesture, { x: 1, y: 0 });

    expect(scaled.factor).toBe(2);
    expect(scaled.after[0]).toMatchObject({ x: 20, y: 10, width: 80, height: 40, scale: 4 });
    expect(cancelScaleModeGesture(scaled)).toEqual([frame]);
  });

  it("quantizes radial scale at commit while retaining the exact unscaled dimensions", () => {
    const frame: NoteFrame = {
      id: "a", x: 0, y: 0, width: 42, height: 20, scale: 2,
      baseWidth: 20, baseHeight: 10, baseStatisticsExtensionWidth: 1,
    };
    const gesture = createScaleModeGesture([frame], { x: 0, y: 0 }, { x: 10, y: 0 });
    const after = normalizeScaleModeAtCommit(updateScaleModeGesture(gesture, { x: 15.005, y: 0 }));

    expect(after[0]).toMatchObject({ x: 0, y: 0, scale: 3.002 });
    expect(after[0].width).toBeCloseTo(63.042);
    expect(after[0].height).toBeCloseTo(30.02);
    expect(after[0].baseWidth).toBe(20);
    expect(after[0].baseStatisticsExtensionWidth).toBe(1);
  });

  it("shows only TASK R handles without Shift and shows scale handles while Shift is held", () => {
    for (const edge of RESIZE_EDGES) {
      expect(shouldShowResizeHandle("tierlist", edge, false, false)).toBe(false);
      expect(shouldShowResizeHandle("markas", edge, false, false)).toBe(false);
      expect(shouldShowResizeHandle("list", edge, false, false)).toBe(false);
      expect(shouldShowResizeHandle("note", edge, false, false)).toBe(true);
      expect(shouldShowResizeHandle("tierlist", edge, false, true)).toBe(true);
    }
    expect(shouldShowResizeHandle("list", "bottom", true, false)).toBe(true);
    expect(shouldShowResizeHandle("list", "top", true, false)).toBe(false);
  });

  it("registers S for scaling without taking Alt+S from the snap-grid command", () => {
    const scale = commandRegistry.get("select.scale");
    expect(scale?.keys).toEqual(["KeyS"]);
    expect([...commandRegistry.values()]
      .filter((command) => command.id !== "select.scale" && command.keys.includes("KeyS")))
      .toEqual([]);
    expect(commandRegistry.get("grid.toggleSnap")?.keys).toEqual(["Alt+KeyS"]);
  });

  it("uses click/Enter to confirm radial scaling, right-click/Escape/Ctrl+Z to cancel, and any other input to exit", () => {
    const plain = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    expect(scaleModePointerAction(0)).toBe("confirm");
    expect(scaleModePointerAction(1)).toBe("confirm");
    expect(scaleModePointerAction(2)).toBe("cancel");
    expect(scaleModeKeyAction("Enter", plain)).toBe("confirm");
    expect(scaleModeKeyAction("Escape", plain)).toBe("cancel");
    expect(scaleModeKeyAction("KeyZ", { ...plain, ctrlKey: true })).toBe("cancel");
    expect(scaleModeKeyAction("KeyA", plain)).toBe("confirm");
    expect(scaleModeKeyAction("ShiftLeft", { ...plain, shiftKey: true })).toBe("ignore");
  });
});
