import type { BrushSettings, DrawTool } from "./types";
import { effectSettingsSnapshot, loadEffectSettings } from "./effects/effectSettings.svelte";
import {
  DEFAULT_DRAWING_PREFERENCES,
  normalizeBrushSettings,
  normalizeDrawingPreferences,
  type DrawingPreferences,
} from "./settings";

export const drawingTools = $state({
  active: "brush" as DrawTool,
  brush: { ...DEFAULT_DRAWING_PREFERENCES.brush },
});

export function setActiveDrawTool(active: DrawTool): void {
  drawingTools.active = active;
}

export function setBrushSettings(patch: Partial<BrushSettings>): void {
  drawingTools.brush = normalizeBrushSettings({ ...drawingTools.brush, ...patch });
}

export function adjustBrushSize(delta: number): void {
  if (!Number.isFinite(delta)) return;
  setBrushSettings({ size: drawingTools.brush.size + Math.trunc(delta) });
}

export function loadDrawingPreferences(value: unknown): void {
  const preferences = normalizeDrawingPreferences(value);
  drawingTools.brush = preferences.brush;
  loadEffectSettings(preferences.effects);
}

export function drawingPreferencesSnapshot(): DrawingPreferences {
  return { brush: { ...drawingTools.brush }, effects: effectSettingsSnapshot() };
}

export type BrushWheelSetting = "size" | "opacity" | "hardness";

/** Ctrl / Alt / Shift + mouse wheel in draw mode: size ~10% per notch, opacity and hardness 5% per notch. */
export function stepBrushSetting(setting: BrushWheelSetting, notches: number): void {
  if (!Number.isFinite(notches) || notches === 0) return;
  // The eraser always erases at full strength; only its size and hardness are adjustable.
  if (setting === "opacity" && drawingTools.active === "eraser") return;
  const brush = drawingTools.brush;
  if (setting === "size") {
    const scaled = Math.round(brush.size * 1.1 ** notches);
    const size = scaled === brush.size ? brush.size + Math.sign(notches) : scaled;
    setBrushSettings({ size });
  } else if (setting === "opacity") {
    setBrushSettings({ opacity: Math.round((brush.opacity + notches * 0.05) * 100) / 100 });
  } else {
    setBrushSettings({ hardness: Math.round((brush.hardness + notches * 0.05) * 100) / 100 });
  }
}

/** Short label next to the draw cursor after a wheel adjustment ("Size 24 px"). */
export const brushHint = $state({ text: "", revision: 0 });

export function showBrushHint(setting: BrushWheelSetting): void {
  const brush = drawingTools.brush;
  if (setting === "opacity" && drawingTools.active === "eraser") {
    brushHint.text = "Eraser opacity is always 100%";
    brushHint.revision += 1;
    return;
  }
  brushHint.text = setting === "size" ? `Size ${brush.size} px`
    : setting === "opacity" ? `Opacity ${Math.round(brush.opacity * 100)}%`
      : `Hardness ${Math.round(brush.hardness * 100)}%`;
  brushHint.revision += 1;
}
