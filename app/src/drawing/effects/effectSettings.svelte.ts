export type DrawingEffectMode = "blur" | "smudge" | "swirl";
export type SwirlDirection = "cw" | "ccw";

export interface DrawingEffectSettings {
  mode: DrawingEffectMode;
  blurStrength: number;
  smudgeStrength: number;
  swirlStrength: number;
  swirlDirection: SwirlDirection;
}

export const DEFAULT_EFFECT_SETTINGS: DrawingEffectSettings = {
  mode: "blur",
  blurStrength: 0.55,
  smudgeStrength: 0.58,
  swirlStrength: 0.55,
  swirlDirection: "cw",
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

export function normalizeEffectMode(value: unknown): DrawingEffectMode {
  return value === "smudge" || value === "swirl" ? value : "blur";
}

export function normalizeEffectStrength(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}
