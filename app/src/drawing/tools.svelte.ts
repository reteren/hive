import { newId } from "../model/note";
import type { BrushSettings, BrushPreset, DrawTool } from "./types";
import {
  DEFAULT_DRAWING_PREFERENCES,
  normalizeBrushSettings,
  normalizeBrushPresets,
  normalizeDrawingPreferences,
  type DrawingPreferences,
} from "./settings";

export const drawingTools = $state({
  active: "brush" as DrawTool,
  brush: { ...DEFAULT_DRAWING_PREFERENCES.brush },
  presets: [] as BrushPreset[],
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
  drawingTools.presets = preferences.presets;
}

export function drawingPreferencesSnapshot(): DrawingPreferences {
  return {
    brush: { ...drawingTools.brush },
    presets: drawingTools.presets.map((preset) => ({ ...preset })),
  };
}

export function saveBrushPreset(name: string): BrushPreset | null {
  const normalizedName = name.trim().slice(0, 40);
  if (!normalizedName || drawingTools.presets.length >= 32) return null;
  const preset: BrushPreset = { id: newId(), name: normalizedName, ...drawingTools.brush };
  drawingTools.presets = [...drawingTools.presets, preset];
  return preset;
}

export function applyBrushPreset(id: string): boolean {
  const preset = drawingTools.presets.find((candidate) => candidate.id === id);
  if (!preset) return false;
  drawingTools.brush = normalizeBrushSettings(preset);
  return true;
}

export function deleteBrushPreset(id: string): boolean {
  if (!drawingTools.presets.some((preset) => preset.id === id)) return false;
  drawingTools.presets = drawingTools.presets.filter((preset) => preset.id !== id);
  return true;
}

export function replaceBrushPresets(value: unknown): void {
  drawingTools.presets = normalizeBrushPresets(value);
}
