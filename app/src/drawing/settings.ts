import { DEFAULT_BRUSH, type BrushPreset, type BrushSettings } from "./types";

export interface DrawingPreferences {
  brush: BrushSettings;
  presets: BrushPreset[];
}

export const DEFAULT_DRAWING_PREFERENCES: DrawingPreferences = {
  brush: { ...DEFAULT_BRUSH },
  presets: [],
};

const MAX_PRESETS = 32;
const MAX_PRESET_NAME = 40;

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

/** Keep only valid, uniquely named presets, in their saved order. */
export function normalizeBrushPresets(value: unknown): BrushPreset[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const presets: BrushPreset[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || candidate.id.length === 0 ||
      candidate.id.length > 200 || ids.has(candidate.id) || typeof candidate.name !== "string") continue;
    const name = candidate.name.trim().slice(0, MAX_PRESET_NAME);
    if (!name) continue;
    const settings = normalizeBrushSettings(candidate);
    if (!isHexColor(candidate.color) || !isFiniteNumber(candidate.size) ||
      !isFiniteNumber(candidate.opacity) || !isFiniteNumber(candidate.hardness)) continue;
    presets.push({ id: candidate.id, name, ...settings });
    ids.add(candidate.id);
    if (presets.length >= MAX_PRESETS) break;
  }
  return presets;
}

export function normalizeDrawingPreferences(value: unknown, fallback = DEFAULT_DRAWING_PREFERENCES): DrawingPreferences {
  const source = isRecord(value) ? value : {};
  return {
    brush: normalizeBrushSettings(source.brush, fallback.brush),
    presets: source.presets === undefined ? fallback.presets.map((preset) => ({ ...preset })) : normalizeBrushPresets(source.presets),
  };
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
