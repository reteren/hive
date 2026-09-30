import { describe, expect, it } from "vitest";
import { MovingVisuals, type MovingVisualTarget } from "../src/selection/movingVisuals";

function visual(opacity: string, movePreview?: string): MovingVisualTarget {
  return { style: { opacity }, dataset: { ...(movePreview === undefined ? {} : { movePreview }) } };
}

describe("moving visual opacity", () => {
  it("sets moved cards to 0.7, leaves links alone, and restores exact prior state on drop or cancel", () => {
    const note = visual("");
    const beacon = visual("0.4", "existing");
    const line = visual("1");
    const moving = new MovingVisuals<MovingVisualTarget>();

    moving.setTargets([note, beacon]);
    expect(note.style.opacity).toBe("0.7");
    expect(note.dataset.movePreview).toBe("true");
    expect(beacon.style.opacity).toBe("0.7");
    expect(line.style.opacity).toBe("1");

    moving.setTargets([beacon]);
    expect(note.style.opacity).toBe("");
    expect(note.dataset.movePreview).toBeUndefined();
    moving.clear();
    expect(beacon.style.opacity).toBe("0.4");
    expect(beacon.dataset.movePreview).toBe("existing");
  });
});
