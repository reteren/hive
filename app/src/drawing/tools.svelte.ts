import type { BrushSettings, DrawTool } from "./types";
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
}

export function drawingPreferencesSnapshot(): DrawingPreferences {
  return { brush: { ...drawingTools.brush } };
}
