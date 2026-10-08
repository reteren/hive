import { invoke, isTauri } from "@tauri-apps/api/core";
import { registerCloseFlush } from "../lifecycle/closeFlush";
import { camera, cameraSettings, isTransientCameraChange } from "../board/camera.svelte";
import { grid, setAutoGrid, setGridStep } from "../board/grid.svelte";
import { history as undoHistory, setHistoryLimit } from "../history/history.svelte";
import { brushState, setBrushSize } from "../zones/brushState.svelte";
import { getCommandKeyOverrides, setCommandKeyOverrides } from "../commands/registry.svelte";
import { applyReduceMotionPreference } from "./motion";
import {
  preferences,
  setFitWidthToText,
  setAllowAiToolsMcp,
  setRecordInBackground,
  setReduceAnimations,
  setTransferHintsShown,
  setVideoExternalThresholdMb,
} from "./preferences.svelte";
import { backupSettings, setBackupInterval } from "../backup/backupSettings.svelte";
import { quickInputShortcut, setQuickInputShortcutValue } from "./quickInputShortcut.svelte";
import { setTimeCounters, timeCounters } from "../time/runtime.svelte";
import { timeEnablePreference } from "../time/enablePreference.svelte";
import { gifPlayback, setGifPlaybackMode } from "../attachments/gifPlayback.svelte";
import { drawingPreferencesSnapshot, loadDrawingPreferences } from "../drawing/tools.svelte";
import {
  cacheThemeBootstrap,
  getThemeSettingsSnapshot,
  setThemeSettings,
} from "../theme/appearance.svelte";
import {
  parseTimeCounters,
  parseViewSettings,
  serializeViewSettings,
  serializeViewSettingsWithTimeCounters,
  type ViewSettings,
} from "./viewSettings";
import {
  createProfileId,
  MAX_PROFILES,
  normalizeProfileName,
  parseSettingsProfiles,
  pickProfileSettings,
  serializeSettingsProfiles,
  uniqueProfileName,
  withProfileSettings,
} from "./profiles";
import { setSettingsProfiles, settingsProfiles } from "./profileState.svelte";

const SAVE_DEBOUNCE_MS = 400;
const TIME_COUNTER_SAVE_INTERVAL_MS = 15_000;

let initialization: Promise<void> | null = null;
let initialized = false;
let saveTimer: number | null = null;
let saveTimerKind: "settings" | "time-counters" | null = null;
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
  let serialized: string | null = null;
  try {
    serialized = await invoke<string | null>("load_view_settings");
    settings = parseViewSettings(serialized, defaults);
  } catch (error) {
    console.warn("Could not load view settings; using defaults.", error);
  }

  applySettings(settings);
  setSettingsProfiles(parseSettingsProfiles(storedProfiles(serialized), serializedSettings()));
  cacheThemeBootstrap(settings.appearance);
  setTimeCounters(parseTimeCounters(serialized));
  lastPersistedSnapshot = currentSettingsSnapshot();
  initialized = true;

  $effect.root(() => {
    $effect(() => {
      const snapshot = currentSettingsSnapshot();
      if (!initialized || isTransientCameraChange() || snapshot === lastPersistedSnapshot) return;
      scheduleSave(snapshot);
    });
  });

  registerCloseFlush("view-settings", flushViewSettings);
}

function scheduleSave(snapshot: string): void {
  const countersOnly = differsOnlyByTimeCounters(snapshot, lastPersistedSnapshot);
  if (saveTimer !== null && (saveTimerKind === "settings" || countersOnly)) return;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimerKind = countersOnly ? "time-counters" : "settings";
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    saveTimerKind = null;
    if (isTransientCameraChange()) {
      scheduleSave(currentSettingsSnapshot());
      return;
    }
    void persistSnapshot(currentSettingsSnapshot());
  }, countersOnly ? TIME_COUNTER_SAVE_INTERVAL_MS : SAVE_DEBOUNCE_MS);
}

async function flushViewSettings(): Promise<void> {
  if (!initialized) return;
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
    saveTimerKind = null;
  }
  await persistSnapshot(currentSettingsSnapshot());
}

function currentSettingsSnapshot(): string {
  const snapshot = JSON.parse(serializeViewSettingsWithTimeCounters(currentSettings(), timeCounters)) as Record<string, unknown>;
  snapshot.profiles = serializeSettingsProfiles(settingsProfiles, snapshot);
  return JSON.stringify(snapshot);
}

function serializedSettings(): Record<string, unknown> {
  return JSON.parse(serializeViewSettings(currentSettings())) as Record<string, unknown>;
}

function storedProfiles(serialized: string | null): unknown {
  if (serialized == null) return undefined;
  try {
    return (JSON.parse(serialized) as { profiles?: unknown }).profiles;
  } catch {
    return undefined;
  }
}

/** R11.4: keep the current settings in the active profile, then load `id`'s settings. */
export function switchSettingsProfile(id: string): void {
  if (id === settingsProfiles.active) return;
  const target = settingsProfiles.list.find((profile) => profile.id === id);
  if (!target) return;
  const current = serializedSettings();
  const active = settingsProfiles.list.find((profile) => profile.id === settingsProfiles.active);
  if (active) active.settings = pickProfileSettings(current);
  const next = parseViewSettings(JSON.stringify(withProfileSettings(current, target.settings)), currentSettings());
  // The view stays where it is; only its zoom is pulled into the new profile's limits.
  next.camera = {
    x: camera.x,
    y: camera.y,
    zoom: Math.min(next.cameraSettings.maxZoom, Math.max(next.cameraSettings.minZoom, camera.zoom)),
  };
  settingsProfiles.active = id;
  applySettings(next);
}

/** R11.4: a new profile starting as a copy of the current settings; it becomes the active one. */
export function createSettingsProfile(name?: string): string | null {
  if (settingsProfiles.list.length >= MAX_PROFILES) return null;
  const current = serializedSettings();
  const active = settingsProfiles.list.find((profile) => profile.id === settingsProfiles.active);
  if (active) active.settings = pickProfileSettings(current);
  const id = createProfileId(settingsProfiles.list);
  const profileName = uniqueProfileName(settingsProfiles.list, name ?? active?.name ?? "Profile");
  settingsProfiles.list = [...settingsProfiles.list, { id, name: profileName, settings: pickProfileSettings(current) }];
  settingsProfiles.active = id;
  return id;
}

/** Rename a profile; returns the name actually used ("" when the name was empty). */
export function renameSettingsProfile(id: string, name: string): string {
  const profile = settingsProfiles.list.find((entry) => entry.id === id);
  const normalized = normalizeProfileName(name);
  if (!profile || !normalized) return "";
  profile.name = uniqueProfileName(settingsProfiles.list, normalized, id);
  return profile.name;
}

/** Delete a profile (never the last one); deleting the active one switches to a neighbour first. */
export function deleteSettingsProfile(id: string): boolean {
  const index = settingsProfiles.list.findIndex((profile) => profile.id === id);
  if (index < 0 || settingsProfiles.list.length <= 1) return false;
  if (id === settingsProfiles.active) {
    const neighbour = settingsProfiles.list[index + 1] ?? settingsProfiles.list[index - 1];
    switchSettingsProfile(neighbour.id);
  }
  settingsProfiles.list = settingsProfiles.list.filter((profile) => profile.id !== id);
  return true;
}

function differsOnlyByTimeCounters(current: string, persisted: string): boolean {
  if (!persisted) return false;
  try {
    const currentSettings = JSON.parse(current) as Record<string, unknown>;
    const persistedSettings = JSON.parse(persisted) as Record<string, unknown>;
    delete currentSettings.timeCounters;
    delete persistedSettings.timeCounters;
    return JSON.stringify(currentSettings) === JSON.stringify(persistedSettings);
  } catch {
    return false;
  }
}

function persistSnapshot(snapshot: string): Promise<void> {
  if (snapshot === lastPersistedSnapshot) return writeQueue;

  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    if (snapshot === lastPersistedSnapshot) return;
    try {
      await invoke("save_view_settings", { contents: snapshot });
      lastPersistedSnapshot = snapshot;
      cacheThemeBootstrap((JSON.parse(snapshot) as { appearance?: unknown }).appearance);
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
    grid: { step: grid.baseStep, autoGrid: grid.autoGrid, showGrid: grid.showGrid, snap: grid.snap },
    history: { limit: undoHistory.limit },
    accessibility: { reduceAnimations: preferences.reduceAnimations },
    zones: { brushSize: brushState.size },
    drawing: drawingPreferencesSnapshot(),
    keyOverrides: getCommandKeyOverrides(),
    transferHintsShown: preferences.transferHintsShown,
    fitWidthToText: preferences.fitWidthToText,
    gifPlayback: gifPlayback.mode,
    recordInBackground: preferences.recordInBackground,
    allowAiToolsMcp: preferences.allowAiToolsMcp,
    backupIntervalMinutes: backupSettings.interval,
    quickInputShortcut: quickInputShortcut.value,
    skipCompletedTimerConfirmation: timeEnablePreference.skipCompletedTimerConfirmation,
    videoExternalThresholdMb: preferences.videoExternalThresholdMb,
    appearance: getThemeSettingsSnapshot(),
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
  setGridStep(settings.grid.step);
  setAutoGrid(settings.grid.autoGrid);
  grid.showGrid = settings.grid.showGrid;
  grid.snap = settings.grid.snap;
  setHistoryLimit(settings.history.limit);
  setBrushSize(settings.zones.brushSize);
  loadDrawingPreferences(settings.drawing);
  setReduceAnimations(settings.accessibility.reduceAnimations);
  setCommandKeyOverrides(settings.keyOverrides);
  setTransferHintsShown(settings.transferHintsShown);
  setFitWidthToText(settings.fitWidthToText);
  setGifPlaybackMode(settings.gifPlayback);
  setRecordInBackground(settings.recordInBackground);
  setAllowAiToolsMcp(settings.allowAiToolsMcp);
  setBackupInterval(settings.backupIntervalMinutes);
  setQuickInputShortcutValue(settings.quickInputShortcut);
  timeEnablePreference.skipCompletedTimerConfirmation = settings.skipCompletedTimerConfirmation ?? false;
  setVideoExternalThresholdMb(settings.videoExternalThresholdMb);
  setThemeSettings(settings.appearance);
}
