/** Grid settings (R0.3). The step only changes the drawn grid and snapping, never the unit size. */
import { GRID_STEP_PRESETS, isValidGridStep } from "./gridMath";

export const grid = $state({
  step: 10,
  showGrid: true,
  snap: false,
});

export { GRID_STEP_PRESETS };

/** Change the interval only; world origin and unit size stay fixed. */
export function setGridStep(step: number): boolean {
  if (!isValidGridStep(step)) return false;
  grid.step = step;
  return true;
}
