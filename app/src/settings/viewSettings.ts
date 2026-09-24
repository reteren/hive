import { isValidGridStep } from "../board/gridMath";
import type { Camera } from "../board/cameraMath";
import { sanitizeKeyOverrides, type KeyBindingOverrides } from "../commands/keymap";
import { DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT, MIN_HISTORY_LIMIT } from "../history/historyStack";
import { systemPrefersReducedMotion } from "./motion";

export const VIEW_SETTINGS_VERSION = 4;

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

export interface DisplaySettings {
  rightPanelOpen: boolean;
}

export interface HistorySettings {
  limit: number;
}

export interface AccessibilitySettings {
  reduceAnimations: boolean;
}

export interface ViewSettings {
  camera: Camera;
  cameraSettings: CameraSettings;
  grid: GridSettings;
  display: DisplaySettings;
  history: HistorySettings;
  accessibility: AccessibilitySettings;
  keyOverrides: KeyBindingOverrides;
}

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  camera: { x: 0, y: 0, zoom: 1 },
  cameraSettings: {
    minZoom: 0.05,
    maxZoom: 8,
    zoomSensitivity: 0.0015,
    panSpeed: 600,
  },
  grid: { step: 10, showGrid: true, snap: false },
  display: { rightPanelOpen: true },
  history: { limit: DEFAULT_HISTORY_LIMIT },
  accessibility: { reduceAnimations: systemPrefersReducedMotion() },
  keyOverrides: {},
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
  const displayInput = asRecord(parsed.display);
  const historyInput = asRecord(parsed.history);
  const accessibilityInput = asRecord(parsed.accessibility);

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
    display: {
      rightPanelOpen: booleanOrDefault(displayInput.rightPanelOpen, defaults.display.rightPanelOpen),
    },
    history: {
      limit: historyLimitOrDefault(historyInput.limit, defaults.history.limit),
    },
    accessibility: {
      reduceAnimations: booleanOrDefault(accessibilityInput.reduceAnimations, defaults.accessibility.reduceAnimations),
    },
    keyOverrides: sanitizeKeyOverrides(parsed.keyOverrides),
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
    display: { rightPanelOpen: settings.display.rightPanelOpen },
    history: { limit: settings.history.limit },
    accessibility: { reduceAnimations: settings.accessibility.reduceAnimations },
    keyOverrides: sanitizeKeyOverrides(settings.keyOverrides),
  });
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
    display: { ...settings.display },
    history: { ...settings.history },
    accessibility: { ...settings.accessibility },
    keyOverrides: sanitizeKeyOverrides(settings.keyOverrides),
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

function gridStepOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && isValidGridStep(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
