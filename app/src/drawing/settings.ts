import { DEFAULT_BRUSH, type BrushSettings } from "./types";

export interface DrawingPreferences {
  brush: BrushSettings;
}

export const DEFAULT_DRAWING_PREFERENCES: DrawingPreferences = {
  brush: { ...DEFAULT_BRUSH },
};

/** Validate user supplied settings while keeping all supported values usable. */
export function normalizeBrushSettings(value: unknown, fallback: BrushSettings = DEFAULT_BRUSH): BrushSettings {
  const source = isRecord(value) ? value : {};
  return {
    color: isHexColor(source.color) ? source.color.toLowerCase() : fallback.color,
    size: clampNumber(source.size, fallback.size, 1, 400, true),
    opacity: clampNumber(source.opacity, fallback.opacity, 0.05, 1),
    hardness: clampNumber(source.hardness, fallback.hardness, 0, 1),
  };
}

export function normalizeDrawingPreferences(value: unknown, fallback = DEFAULT_DRAWING_PREFERENCES): DrawingPreferences {
  const source = isRecord(value) ? value : {};
  // Brush presets were removed; an old `presets` field in saved settings is ignored.
  return { brush: normalizeBrushSettings(source.brush, fallback.brush) };
}

/** Brush diameters are CSS screen pixels and intentionally do not depend on camera zoom. */
export function drawCursorDiameter(size: number): number {
  return normalizeBrushSettings({ size }).size;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number, integer = false): number {
  if (!isFiniteNumber(value)) return fallback;
  const bounded = Math.min(max, Math.max(min, value));
  return integer ? Math.round(bounded) : Math.round(bounded * 100) / 100;
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
