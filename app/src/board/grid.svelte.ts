/** Grid settings (R0.3). The step only changes the drawn grid and snapping, never the unit size. */
import { autoGridStep, isValidGridStep } from "./gridMath";
import { camera } from "./camera.svelte";

/** Step sizes available from the grid controls and [ ] commands. */
export const GRID_STEP_PRESETS = Object.freeze([5, 10, 20, 50, 100] as const);

export const grid = $state({
  step: 10,
  baseStep: 10,
  autoGrid: true,
  showGrid: true,
  snap: false,
});

$effect.root(() => {
  $effect(() => {
    const { baseStep, autoGrid } = grid;
    const zoom = camera.zoom;
    grid.step = autoGrid ? autoGridStep(baseStep, zoom) : baseStep;
  });
});

/** Change the interval only; world origin and unit size stay fixed. */
export function setGridStep(step: number): boolean {
  if (!isValidGridStep(step)) return false;
  grid.baseStep = step;
  grid.step = grid.autoGrid ? autoGridStep(step, camera.zoom) : step;
  return true;
}

export function setAutoGrid(enabled: boolean): void {
  grid.autoGrid = enabled;
  grid.step = enabled ? autoGridStep(grid.baseStep, camera.zoom) : grid.baseStep;
}

/** Advance to the next grid control step, wrapping from 100 back to 5. */
export function increaseGridStep(): number {
  const next = GRID_STEP_PRESETS.find((step) => step > grid.baseStep) ?? GRID_STEP_PRESETS[0];
  setGridStep(next);
  return next;
}

/** Move to the previous grid control step, wrapping from 5 back to 100. */
export function decreaseGridStep(): number {
  const previous = [...GRID_STEP_PRESETS].reverse().find((step) => step < grid.baseStep) ?? GRID_STEP_PRESETS.at(-1)!;
  setGridStep(previous);
  return previous;
}
