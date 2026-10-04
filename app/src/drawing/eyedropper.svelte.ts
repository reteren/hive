import { readCompositeRect } from "./history";
import { setBrushSettings } from "./tools.svelte";
import { currentDrawLevel, levelPxPerUnit } from "./types";

/**
 * Right mouse button in draw mode is the eyedropper: while it is held the colour under the cursor is
 * previewed (swatch + HEX next to the cursor); releasing it makes that colour the brush colour.
 * It samples the visible drawing (all levels); empty board gives no colour and changes nothing.
 */
export const eyedropper = $state({
  active: false,
  color: null as string | null,
});

export function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

/** Colour of the drawing at a world point, or null where nothing is drawn. */
export function sampleDrawingColor(world: { x: number; y: number }, zoom: number): string | null {
  const level = currentDrawLevel(zoom);
  const ppu = levelPxPerUnit(level);
  const x = Math.floor(world.x * ppu);
  const y = Math.floor(world.y * ppu);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
  const data = readCompositeRect(x, y, 1, 1, level).data;
  return data[3]! > 0 ? rgbToHex(data[0]!, data[1]!, data[2]!) : null;
}

export function beginEyedropper(world: { x: number; y: number }, zoom: number): void {
  eyedropper.active = true;
  eyedropper.color = sampleDrawingColor(world, zoom);
}

export function moveEyedropper(world: { x: number; y: number }, zoom: number): void {
  if (!eyedropper.active) return;
  eyedropper.color = sampleDrawingColor(world, zoom);
}

/** Release: confirm the previewed colour into the brush. */
export function finishEyedropper(): void {
  if (!eyedropper.active) return;
  if (eyedropper.color) setBrushSettings({ color: eyedropper.color });
  cancelEyedropper();
}

export function cancelEyedropper(): void {
  eyedropper.active = false;
  eyedropper.color = null;
}
