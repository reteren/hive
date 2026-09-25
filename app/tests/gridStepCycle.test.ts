import { beforeEach, describe, expect, it } from "vitest";
import {
  decreaseGridStep,
  grid,
  GRID_STEP_PRESETS,
  increaseGridStep,
  setGridStep,
} from "../src/board/grid.svelte";

describe("grid step controls", () => {
  beforeEach(() => {
    setGridStep(10);
  });

  it("uses the same five-step sequence for both commands and the control", () => {
    expect(GRID_STEP_PRESETS).toEqual([5, 10, 20, 50, 100]);

    expect(increaseGridStep()).toBe(20);
    expect(increaseGridStep()).toBe(50);
    expect(increaseGridStep()).toBe(100);
    expect(increaseGridStep()).toBe(5);
    expect(decreaseGridStep()).toBe(100);
    expect(decreaseGridStep()).toBe(50);
    expect(grid.step).toBe(50);
  });

  it("moves a custom persisted step into the nearest direction in the sequence", () => {
    setGridStep(12);
    expect(increaseGridStep()).toBe(20);
    setGridStep(12);
    expect(decreaseGridStep()).toBe(10);
  });
});
