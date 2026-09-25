import { BRUSH_MIN } from "./brush";

/**
 * Zone brush UI state (contract). `size` is always a normalized value (multiple of 20, 20..300);
 * change it only through the panel/commands worker's setter so the value stays normalized and
 * persisted in view settings.
 */
export const brushState = $state({
  size: BRUSH_MIN * 3,
});
