import { beforeEach, describe, expect, it } from "vitest";
import { camera } from "../src/board/camera.svelte";
import {
  decreaseGridStep,
  grid,
  GRID_STEP_PRESETS,
  increaseGridStep,
  setAutoGrid,
  setGridStep,
} from "../src/board/grid.svelte";

describe("grid step controls", () => {
  beforeEach(() => {
    camera.zoom = 1;
    setAutoGrid(false);
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
    expect(grid.baseStep).toBe(50);
    expect(grid.step).toBe(50);
  });

  it("moves a custom persisted step into the nearest direction in the sequence", () => {
    setGridStep(12);
    expect(increaseGridStep()).toBe(20);
    setGridStep(12);
    expect(decreaseGridStep()).toBe(10);
  });

  it("uses an effective zoom-aware step while Auto grid is on", () => {
    setGridStep(10);
    setAutoGrid(true);
    expect(grid.step).toBe(5);

    camera.zoom = 0.1;
    setAutoGrid(true);
    expect(grid.step).toBe(40);

    setAutoGrid(false);
    expect(grid.step).toBe(10);
  });
});
