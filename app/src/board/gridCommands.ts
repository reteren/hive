import { registerCommand } from "../commands/registry.svelte";
import { GRID_STEP_PRESETS } from "./gridMath";
import { grid, setGridStep } from "./grid.svelte";

function stepUp(): void {
  const next = GRID_STEP_PRESETS.find((step) => step > grid.step);
  setGridStep(next ?? GRID_STEP_PRESETS[GRID_STEP_PRESETS.length - 1]);
}

function stepDown(): void {
  const previous = [...GRID_STEP_PRESETS].reverse().find((step) => step < grid.step);
  setGridStep(previous ?? GRID_STEP_PRESETS[0]);
}

registerCommand({
  id: "grid.toggleShow",
  label: "Toggle Grid",
  keys: ["Shift+KeyG"],
  run: () => {
    grid.showGrid = !grid.showGrid;
  },
  isActive: () => grid.showGrid,
});

registerCommand({
  id: "grid.toggleSnap",
  label: "Toggle Snapgrid",
  keys: ["Shift+Tab"],
  run: () => {
    grid.snap = !grid.snap;
  },
  isActive: () => grid.snap,
});

registerCommand({
  id: "grid.stepUp",
  label: "Increase Grid Step",
  keys: ["BracketRight"],
  run: stepUp,
});

registerCommand({
  id: "grid.stepDown",
  label: "Decrease Grid Step",
  keys: ["BracketLeft"],
  run: stepDown,
});
