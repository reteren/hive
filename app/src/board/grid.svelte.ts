/** Grid settings (R0.3). The step only changes the drawn grid and snapping, never the unit size. */
import { isValidGridStep } from "./gridMath";

/** Step sizes available from the grid controls and [ ] commands. */
export const GRID_STEP_PRESETS = Object.freeze([5, 10, 20, 50, 100] as const);

export const grid = $state({
  step: 10,
  showGrid: true,
  snap: false,
});

/** Change the interval only; world origin and unit size stay fixed. */
export function setGridStep(step: number): boolean {
  if (!isValidGridStep(step)) return false;
  grid.step = step;
  return true;
}

/** Advance to the next grid control step, wrapping from 100 back to 5. */
export function increaseGridStep(): number {
  const next = GRID_STEP_PRESETS.find((step) => step > grid.step) ?? GRID_STEP_PRESETS[0];
  setGridStep(next);
  return next;
}

/** Move to the previous grid control step, wrapping from 5 back to 100. */
export function decreaseGridStep(): number {
  const previous = [...GRID_STEP_PRESETS].reverse().find((step) => step < grid.step) ?? GRID_STEP_PRESETS.at(-1)!;
  setGridStep(previous);
  return previous;
}
