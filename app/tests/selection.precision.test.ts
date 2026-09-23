import { describe, expect, it } from "vitest";
import { scaleGroupFrames } from "../src/selection/groupScale";
import { createMoveGesture, updateMoveGesture } from "../src/selection/gestures";
import {
  createPrecisionDeltaTracker,
  setPrecisionAlt,
  updatePrecisionDelta,
} from "../src/selection/precision";

describe("Alt precision pointer deltas", () => {
  it("rebases when Alt is pressed and released during a gesture", () => {
    let tracker = createPrecisionDeltaTracker({ x: 0, y: 0 });
    let update = updatePrecisionDelta(tracker, { x: 10, y: 0 });
    tracker = setPrecisionAlt(update.tracker, true);

    update = updatePrecisionDelta(tracker, { x: 15, y: 0 }, true);
    expect(update.delta).toEqual({ x: 11, y: 0 });
    tracker = setPrecisionAlt(update.tracker, false);

    update = updatePrecisionDelta(tracker, { x: 20, y: 0 }, false);
    expect(update.delta).toEqual({ x: 16, y: 0 });
  });

  it("uses one fifth travel when Alt is held from the gesture start", () => {
    const tracker = createPrecisionDeltaTracker({ x: 100, y: 50 }, true);
    expect(updatePrecisionDelta(tracker, { x: 150, y: 75 }, true).delta).toEqual({ x: 10, y: 5 });
  });

  it("applies snap after precision scaling for move and group scale", () => {
    const moveTracker = createPrecisionDeltaTracker({ x: 0, y: 0 }, true);
    const moveDelta = updatePrecisionDelta(moveTracker, { x: 10, y: 0 }, true).delta;
    const move = createMoveGesture([{ id: "a", x: 12, y: 0, width: 20, height: 10 }], "a", { x: 0, y: 0 });
    expect(updateMoveGesture(move, moveDelta, true, 10).after[0].x).toBe(10);

    const scaleTracker = createPrecisionDeltaTracker({ x: 0, y: 0 }, true);
    const scaleDelta = updatePrecisionDelta(scaleTracker, { x: 10, y: 0 }, true).delta;
    const scaled = scaleGroupFrames(
      [{ id: "a", x: 13, y: 0, width: 40, height: 20 }],
      { x: 13, y: 0, width: 40, height: 20 },
      "right",
      scaleDelta,
      true,
      10,
    );
    expect(scaled[0].width).toBe(47);
  });
});
