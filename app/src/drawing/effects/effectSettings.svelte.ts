export type DrawingEffectMode = "blur" | "smudge" | "swirl";
export type SwirlDirection = "cw" | "ccw";
export const DEFAULT_SWIRL_SPEED = 2.4;

export interface DrawingEffectSettings {
  mode: DrawingEffectMode;
  blurStrength: number;
  smudgeStrength: number;
  swirlStrength: number;
  swirlDirection: SwirlDirection;
  /** Radians per second at strength 1. */
  swirlSpeed: number;
}

export const DEFAULT_EFFECT_SETTINGS: DrawingEffectSettings = {
  mode: "blur",
  blurStrength: 0.55,
  smudgeStrength: 0.58,
  swirlStrength: 0.55,
  swirlDirection: "cw",
  swirlSpeed: DEFAULT_SWIRL_SPEED,
};

export const drawingEffects = $state<DrawingEffectSettings>({ ...DEFAULT_EFFECT_SETTINGS });

export function setEffectMode(value: unknown): void {
  drawingEffects.mode = normalizeEffectMode(value);
}

export function setEffectStrength(mode: DrawingEffectMode, value: number): void {
  if (!Number.isFinite(value)) return;
  const strength = Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
  if (mode === "blur") drawingEffects.blurStrength = strength;
  else if (mode === "smudge") drawingEffects.smudgeStrength = strength;
  else drawingEffects.swirlStrength = strength;
}

export function setSwirlDirection(value: unknown): void {
  drawingEffects.swirlDirection = value === "ccw" ? "ccw" : "cw";
}

export function setSwirlSpeed(value: number): void {
  if (!Number.isFinite(value)) return;
  drawingEffects.swirlSpeed = Math.round(Math.max(0.1, Math.min(8, value)) * 10) / 10;
}

export function loadEffectSettings(value: unknown, fallback: DrawingEffectSettings = DEFAULT_EFFECT_SETTINGS): void {
  Object.assign(drawingEffects, normalizeEffectSettings(value, fallback));
}

export function effectSettingsSnapshot(): DrawingEffectSettings {
  return { ...drawingEffects };
}

export function normalizeEffectSettings(value: unknown, fallback: DrawingEffectSettings = DEFAULT_EFFECT_SETTINGS): DrawingEffectSettings {
  const source = isRecord(value) ? value : {};
  return {
    mode: normalizeEffectMode(source.mode),
    blurStrength: normalizeEffectStrength(source.blurStrength, fallback.blurStrength),
    smudgeStrength: normalizeEffectStrength(source.smudgeStrength, fallback.smudgeStrength),
    swirlStrength: normalizeEffectStrength(source.swirlStrength, fallback.swirlStrength),
    swirlDirection: source.swirlDirection === "ccw" || source.swirlDirection === "cw"
      ? source.swirlDirection
      : fallback.swirlDirection,
    swirlSpeed: normalizeSwirlSpeed(source.swirlSpeed, fallback.swirlSpeed),
  };
}

export function normalizeEffectMode(value: unknown): DrawingEffectMode {
  return value === "smudge" || value === "swirl" ? value : "blur";
}

export function normalizeEffectStrength(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function normalizeSwirlSpeed(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(Math.max(0.1, Math.min(8, value)) * 10) / 10;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
