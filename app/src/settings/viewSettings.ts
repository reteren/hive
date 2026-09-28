import { isValidGridStep } from "../board/gridMath";
import type { Camera } from "../board/cameraMath";
import { sanitizeKeyOverrides, type KeyBindingOverrides } from "../commands/keymap";
import { DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT, MIN_HISTORY_LIMIT } from "../history/historyStack";
import { BRUSH_MIN, normalizeBrushSize } from "../zones/brush";
import { systemPrefersReducedMotion } from "./motion";
import type { BackupInterval } from "../backup/backupSettings.svelte";
import { DEFAULT_QUICK_INPUT_SHORTCUT, normalizeQuickInputShortcut } from "../quickInput/shortcutModel";

export const VIEW_SETTINGS_VERSION = 9;

export interface CameraSettings {
  minZoom: number;
  maxZoom: number;
  zoomSensitivity: number;
  panSpeed: number;
}

export interface GridSettings {
  step: number;
  showGrid: boolean;
  snap: boolean;
}

export interface HistorySettings {
  limit: number;
}

export interface AccessibilitySettings {
  reduceAnimations: boolean;
}

export interface ZoneSettings {
  brushSize: number;
}

export interface ViewSettings {
  camera: Camera;
  cameraSettings: CameraSettings;
  grid: GridSettings;
  history: HistorySettings;
  accessibility: AccessibilitySettings;
  zones: ZoneSettings;
  keyOverrides: KeyBindingOverrides;
  transferHintsShown: number;
  fitWidthToText: boolean;
  backupIntervalMinutes: BackupInterval;
  quickInputShortcut: string;
}

/** App-wide Time totals. They belong to view settings, not to an individual project. */
export interface TimeCounterSettings {
  appMs: number;
  activeMs: number;
}

export const DEFAULT_TIME_COUNTERS: TimeCounterSettings = { appMs: 0, activeMs: 0 };

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  camera: { x: 0, y: 0, zoom: 1 },
  cameraSettings: {
    minZoom: 0.05,
    maxZoom: 8,
    zoomSensitivity: 0.0015,
    panSpeed: 600,
  },
  grid: { step: 10, showGrid: true, snap: false },
  history: { limit: DEFAULT_HISTORY_LIMIT },
  accessibility: { reduceAnimations: systemPrefersReducedMotion() },
  zones: { brushSize: BRUSH_MIN * 3 },
  keyOverrides: {},
  transferHintsShown: 0,
  fitWidthToText: true,
  backupIntervalMinutes: 30,
  quickInputShortcut: DEFAULT_QUICK_INPUT_SHORTCUT,
};

const MIN_ALLOWED_ZOOM_LIMIT = 0.001;
const MAX_ALLOWED_ZOOM_LIMIT = 100;
const MIN_ZOOM_SENSITIVITY = 0.000001;
const MAX_ZOOM_SENSITIVITY = 0.1;
const MIN_PAN_SPEED = 1;
const MAX_PAN_SPEED = 10_000;

/** Parse persisted JSON and merge each invalid or missing field from defaults. */
export function parseViewSettings(serialized: string | null | undefined, defaults: ViewSettings): ViewSettings {
  if (serialized == null) return cloneViewSettings(defaults);

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    return cloneViewSettings(defaults);
  }

  if (!isRecord(parsed)) return cloneViewSettings(defaults);

  const cameraSettings = mergeCameraSettings(parsed.cameraSettings, defaults.cameraSettings);
  const limits = cameraSettings;
  const defaultZoom = clamp(defaults.camera.zoom, limits.minZoom, limits.maxZoom);
  const cameraInput = asRecord(parsed.camera);
  const gridInput = asRecord(parsed.grid);
  const historyInput = asRecord(parsed.history);
  const accessibilityInput = asRecord(parsed.accessibility);
  const zonesInput = asRecord(parsed.zones);

  return {
    camera: {
      x: finiteOrDefault(cameraInput.x, defaults.camera.x),
      y: finiteOrDefault(cameraInput.y, defaults.camera.y),
      zoom: isFiniteNumber(cameraInput.zoom) && cameraInput.zoom >= limits.minZoom && cameraInput.zoom <= limits.maxZoom
        ? cameraInput.zoom
        : defaultZoom,
    },
    cameraSettings,
    grid: {
      step: gridStepOrDefault(gridInput.step, defaults.grid.step),
      showGrid: booleanOrDefault(gridInput.showGrid, defaults.grid.showGrid),
      snap: booleanOrDefault(gridInput.snap, defaults.grid.snap),
    },
    history: {
      limit: historyLimitOrDefault(historyInput.limit, defaults.history.limit),
    },
    accessibility: {
      reduceAnimations: booleanOrDefault(accessibilityInput.reduceAnimations, defaults.accessibility.reduceAnimations),
    },
    zones: {
      brushSize: brushSizeOrDefault(zonesInput.brushSize, defaults.zones.brushSize),
    },
    keyOverrides: sanitizeKeyOverrides(parsed.keyOverrides),
    transferHintsShown: hintCountOrDefault(parsed.transferHintsShown, defaults.transferHintsShown),
    fitWidthToText: booleanOrDefault(parsed.fitWidthToText, defaults.fitWidthToText),
    backupIntervalMinutes: backupIntervalOrDefault(parsed.backupIntervalMinutes, defaults.backupIntervalMinutes),
    quickInputShortcut: normalizeQuickInputShortcut(parsed.quickInputShortcut) ?? defaults.quickInputShortcut,
  };
}

/** Serialize a stable, versioned snapshot suitable for the Rust storage command. */
export function serializeViewSettings(settings: ViewSettings): string {
  return JSON.stringify({
    version: VIEW_SETTINGS_VERSION,
    camera: { x: settings.camera.x, y: settings.camera.y, zoom: settings.camera.zoom },
    cameraSettings: {
      minZoom: settings.cameraSettings.minZoom,
      maxZoom: settings.cameraSettings.maxZoom,
      zoomSensitivity: settings.cameraSettings.zoomSensitivity,
      panSpeed: settings.cameraSettings.panSpeed,
    },
    grid: { step: settings.grid.step, showGrid: settings.grid.showGrid, snap: settings.grid.snap },
    history: { limit: settings.history.limit },
    accessibility: { reduceAnimations: settings.accessibility.reduceAnimations },
    zones: { brushSize: settings.zones.brushSize },
    keyOverrides: sanitizeKeyOverrides(settings.keyOverrides),
    transferHintsShown: hintCountOrDefault(settings.transferHintsShown, 0),
    fitWidthToText: settings.fitWidthToText,
    backupIntervalMinutes: backupIntervalOrDefault(settings.backupIntervalMinutes, 30),
    quickInputShortcut: normalizeQuickInputShortcut(settings.quickInputShortcut) ?? DEFAULT_QUICK_INPUT_SHORTCUT,
  });
}

/** Parse the optional R8 counters from the same app-level settings document. */
export function parseTimeCounters(serialized: string | null | undefined): TimeCounterSettings {
  if (serialized == null) return { ...DEFAULT_TIME_COUNTERS };
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed)) return { ...DEFAULT_TIME_COUNTERS };
    const input = asRecord(parsed.timeCounters);
    return {
      appMs: nonNegativeFiniteOrDefault(input.appMs, DEFAULT_TIME_COUNTERS.appMs),
      activeMs: nonNegativeFiniteOrDefault(input.activeMs, DEFAULT_TIME_COUNTERS.activeMs),
    };
  } catch {
    return { ...DEFAULT_TIME_COUNTERS };
  }
}

/** Keep the serialized counters alongside the ordinary settings snapshot. */
export function serializeViewSettingsWithTimeCounters(
  settings: ViewSettings,
  timeCounters: TimeCounterSettings,
): string {
  const serialized = JSON.parse(serializeViewSettings(settings)) as Record<string, unknown>;
  serialized.timeCounters = {
    appMs: nonNegativeFiniteOrDefault(timeCounters.appMs, DEFAULT_TIME_COUNTERS.appMs),
    activeMs: nonNegativeFiniteOrDefault(timeCounters.activeMs, DEFAULT_TIME_COUNTERS.activeMs),
  };
  return JSON.stringify(serialized);
}

function mergeCameraSettings(value: unknown, defaults: CameraSettings): CameraSettings {
  const input = asRecord(value);
  let minZoom = boundedNumber(input.minZoom, defaults.minZoom, MIN_ALLOWED_ZOOM_LIMIT, MAX_ALLOWED_ZOOM_LIMIT);
  let maxZoom = boundedNumber(input.maxZoom, defaults.maxZoom, MIN_ALLOWED_ZOOM_LIMIT, MAX_ALLOWED_ZOOM_LIMIT);

  if (minZoom >= maxZoom) {
    minZoom = defaults.minZoom;
    maxZoom = defaults.maxZoom;
  }

  return {
    minZoom,
    maxZoom,
    zoomSensitivity: boundedNumber(
      input.zoomSensitivity,
      defaults.zoomSensitivity,
      MIN_ZOOM_SENSITIVITY,
      MAX_ZOOM_SENSITIVITY,
    ),
    panSpeed: boundedNumber(input.panSpeed, defaults.panSpeed, MIN_PAN_SPEED, MAX_PAN_SPEED),
  };
}

function cloneViewSettings(settings: ViewSettings): ViewSettings {
  return {
    camera: { ...settings.camera },
    cameraSettings: { ...settings.cameraSettings },
    grid: { ...settings.grid },
    history: { ...settings.history },
    accessibility: { ...settings.accessibility },
    zones: { ...settings.zones },
    keyOverrides: sanitizeKeyOverrides(settings.keyOverrides),
    transferHintsShown: settings.transferHintsShown,
    fitWidthToText: settings.fitWidthToText,
    backupIntervalMinutes: settings.backupIntervalMinutes,
    quickInputShortcut: settings.quickInputShortcut,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteOrDefault(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback;
}

function nonNegativeFiniteOrDefault(value: unknown, fallback: number): number {
  return isFiniteNumber(value) && value >= 0 ? value : fallback;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return isFiniteNumber(value) && value >= min && value <= max ? value : fallback;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function historyLimitOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= MIN_HISTORY_LIMIT && value <= MAX_HISTORY_LIMIT
    ? value
    : fallback;
}

function hintCountOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 5
    ? value
    : fallback;
}

function backupIntervalOrDefault(value: unknown, fallback: BackupInterval): BackupInterval {
  return value === 0 || value === 15 || value === 30 || value === 60 ? value : fallback;
}

function gridStepOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && isValidGridStep(value) ? value : fallback;
}

function brushSizeOrDefault(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? normalizeBrushSize(value) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
