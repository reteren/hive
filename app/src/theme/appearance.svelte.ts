import { deriveThemeTokens, normalizeHex, normalizeThemeColors, type ThemeColors } from "./colors";
import {
  BUILTIN_THEME_PRESETS,
  createUserThemePreset,
  deleteUserThemePreset,
  duplicateUserThemePreset,
  normalizeThemeSettings,
  renameUserThemePreset,
  selectThemePreset,
  type ThemeSettings,
} from "./presets";

const BOOTSTRAP_STORAGE_KEY = "hive.appearance.v1";

function loadBootstrapSettings(): ThemeSettings {
  try {
    const serialized = localStorage.getItem(BOOTSTRAP_STORAGE_KEY);
    return normalizeThemeSettings(serialized ? JSON.parse(serialized) as unknown : null);
  } catch {
    return normalizeThemeSettings(null);
  }
}

const state = $state.raw({ settings: loadBootstrapSettings() });
export const appearance = state;

export function getThemeSettingsSnapshot(): ThemeSettings {
  return normalizeThemeSettings(state.settings);
}

export function setThemeSettings(value: unknown): void {
  state.settings = normalizeThemeSettings(value);
  applyTheme();
}

export function setThemeColor(key: keyof ThemeColors, value: string): void {
  const color = normalizeHex(value);
  if (!color || color === state.settings.colors[key]) return;
  state.settings = {
    ...getThemeSettingsSnapshot(),
    colors: { ...state.settings.colors, [key]: color },
    activePresetId: null,
  };
  applyTheme();
}

export function applyThemePreset(presetId: string): void {
  state.settings = selectThemePreset(state.settings, presetId);
  applyTheme();
}

export function createThemePreset(name: string): string | null {
  const id = createPresetId();
  const next = createUserThemePreset(state.settings, name, id);
  if (next.userPresets.length === state.settings.userPresets.length) return null;
  state.settings = next;
  applyTheme();
  return id;
}

export function renameThemePreset(id: string, name: string): boolean {
  if (!state.settings.userPresets.some((preset) => preset.id === id)) return false;
  const next = renameUserThemePreset(state.settings, id, name);
  if (next.userPresets.find((preset) => preset.id === id)?.name === state.settings.userPresets.find((preset) => preset.id === id)?.name) return false;
  state.settings = next;
  return true;
}

export function duplicateThemePreset(id: string, name: string): string | null {
  const newId = createPresetId();
  const next = duplicateUserThemePreset(state.settings, id, name, newId);
  if (next.userPresets.length === state.settings.userPresets.length) return null;
  state.settings = next;
  applyTheme();
  return newId;
}

export function deleteThemePreset(id: string): boolean {
  if (!state.settings.userPresets.some((preset) => preset.id === id)) return false;
  state.settings = deleteUserThemePreset(state.settings, id);
  return true;
}

export function resetThemeToHive(): void {
  applyThemePreset("hive");
}

/** Apply cached values synchronously before the asynchronous settings load and first app mount. */
export function applyTheme(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const tokens = deriveThemeTokens(normalizeThemeColors(state.settings.colors));
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
  root.style.colorScheme = tokens["--text"] === "#202124" ? "light" : "dark";
  if (typeof window !== "undefined") window.dispatchEvent(new Event("hive:themechange"));
}

/** Mirror only the successfully persisted setting for synchronous startup hydration. */
export function cacheThemeBootstrap(value: unknown): void {
  try {
    localStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(normalizeThemeSettings(value)));
  } catch {
    // Tauri settings remain authoritative if browser storage is unavailable.
  }
}

export function cacheCurrentThemeBootstrap(): void {
  cacheThemeBootstrap(state.settings);
}

export function allThemePresets() {
  return [...BUILTIN_THEME_PRESETS, ...state.settings.userPresets];
}

function createPresetId(): string {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `user-${uuid.toLowerCase()}`;
}
