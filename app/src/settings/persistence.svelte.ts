import { invoke, isTauri } from "@tauri-apps/api/core";
import { registerCloseFlush } from "../lifecycle/closeFlush";
import { camera, cameraSettings } from "../board/camera.svelte";
import { grid } from "../board/grid.svelte";
import { history as undoHistory, setHistoryLimit } from "../history/history.svelte";
import { brushState, setBrushSize } from "../zones/brushState.svelte";
import { getCommandKeyOverrides, setCommandKeyOverrides } from "../commands/registry.svelte";
import { applyReduceMotionPreference } from "./motion";
import { preferences, setFitWidthToText, setReduceAnimations, setTransferHintsShown } from "./preferences.svelte";
import { parseViewSettings, serializeViewSettings, type ViewSettings } from "./viewSettings";

const SAVE_DEBOUNCE_MS = 400;

let initialization: Promise<void> | null = null;
let initialized = false;
let saveTimer: number | null = null;
let lastPersistedSnapshot = "";
let writeQueue: Promise<void> = Promise.resolve();

/** Load and apply settings before the app shell mounts, then start persistence. */
export function initializeViewSettingsPersistence(): Promise<void> {
  initialization ??= initialize();
  return initialization;
}

async function initialize(): Promise<void> {
  applyReduceMotionPreference(preferences.reduceAnimations);
  if (!isTauri()) return;

  const defaults = currentSettings();
  let settings = defaults;
  try {
    const serialized = await invoke<string | null>("load_view_settings");
    settings = parseViewSettings(serialized, defaults);
  } catch (error) {
    console.warn("Could not load view settings; using defaults.", error);
  }

  applySettings(settings);
  lastPersistedSnapshot = serializeViewSettings(currentSettings());
  initialized = true;

  $effect.root(() => {
    $effect(() => {
      const snapshot = serializeViewSettings(currentSettings());
      if (!initialized || snapshot === lastPersistedSnapshot) return;
      scheduleSave(snapshot);
    });
  });

  registerCloseFlush("view-settings", flushViewSettings);
}

function scheduleSave(snapshot: string): void {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void persistSnapshot(snapshot);
  }, SAVE_DEBOUNCE_MS);
}

async function flushViewSettings(): Promise<void> {
  if (!initialized) return;
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  await persistSnapshot(serializeViewSettings(currentSettings()));
}

function persistSnapshot(snapshot: string): Promise<void> {
  if (snapshot === lastPersistedSnapshot) return writeQueue;

  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    if (snapshot === lastPersistedSnapshot) return;
    try {
      await invoke("save_view_settings", { contents: snapshot });
      lastPersistedSnapshot = snapshot;
    } catch (error) {
      console.error("Could not save view settings.", error);
    }
  });
  return writeQueue;
}

function currentSettings(): ViewSettings {
  return {
    camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
    cameraSettings: {
      minZoom: cameraSettings.minZoom,
      maxZoom: cameraSettings.maxZoom,
      zoomSensitivity: cameraSettings.zoomSensitivity,
      panSpeed: cameraSettings.panSpeed,
    },
    grid: { step: grid.step, showGrid: grid.showGrid, snap: grid.snap },
    history: { limit: undoHistory.limit },
    accessibility: { reduceAnimations: preferences.reduceAnimations },
    zones: { brushSize: brushState.size },
    keyOverrides: getCommandKeyOverrides(),
    transferHintsShown: preferences.transferHintsShown,
    fitWidthToText: preferences.fitWidthToText,
  };
}

function applySettings(settings: ViewSettings): void {
  cameraSettings.minZoom = settings.cameraSettings.minZoom;
  cameraSettings.maxZoom = settings.cameraSettings.maxZoom;
  cameraSettings.zoomSensitivity = settings.cameraSettings.zoomSensitivity;
  cameraSettings.panSpeed = settings.cameraSettings.panSpeed;
  camera.x = settings.camera.x;
  camera.y = settings.camera.y;
  camera.zoom = settings.camera.zoom;
  grid.step = settings.grid.step;
  grid.showGrid = settings.grid.showGrid;
  grid.snap = settings.grid.snap;
  setHistoryLimit(settings.history.limit);
  setBrushSize(settings.zones.brushSize);
  setReduceAnimations(settings.accessibility.reduceAnimations);
  setCommandKeyOverrides(settings.keyOverrides);
  setTransferHintsShown(settings.transferHintsShown);
  setFitWidthToText(settings.fitWidthToText);
}
