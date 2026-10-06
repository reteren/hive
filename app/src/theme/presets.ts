import {
  blendColor,
  DEFAULT_THEME_COLORS,
  normalizeHex,
  normalizeThemeColors,
  relativeLuminance,
  type ThemeColors,
} from "./colors";

export interface ThemePreset {
  id: string;
  name: string;
  colors: ThemeColors;
}

export interface UserThemePreset {
  id: string;
  name: string;
  colors: ThemeColors;
}

export interface ThemeSettings {
  colors: ThemeColors;
  activePresetId: string | null;
  userPresets: UserThemePreset[];
}

export interface RebufferThemeSource {
  id: string;
  name: string;
  board: string;
  surface: string;
  surfaceAlpha: number;
  border: string;
  borderAlpha: number;
  text: string;
  brightText: string;
  accent: string;
}

export const REBUFFER_THEME_SOURCES: readonly RebufferThemeSource[] = [
  { id: "black", name: "Black", board: "#000000", surface: "#14151c", surfaceAlpha: 0.93, border: "#ffffff", borderAlpha: 0.16, text: "#eef0f6", brightText: "#ffffff", accent: "#c2c2c2" },
  { id: "darkblue", name: "Dark Blue", board: "#0c0e13", surface: "#1e222c", surfaceAlpha: 0.82, border: "#ffffff", borderAlpha: 0.13, text: "#e9ecf4", brightText: "#ffffff", accent: "#7aa2ff" },
  { id: "dark-green", name: "Dark Green", board: "#0b130e", surface: "#1d2f24", surfaceAlpha: 0.82, border: "#d6ffe0", borderAlpha: 0.15, text: "#e8f5ea", brightText: "#ffffff", accent: "#40ac3e" },
  { id: "dark-purple", name: "Dark Purple", board: "#14101f", surface: "#2d2244", surfaceAlpha: 0.82, border: "#e2d6ff", borderAlpha: 0.15, text: "#efeaf8", brightText: "#ffffff", accent: "#9630c5" },
  { id: "ember", name: "Ember", board: "#110d0b", surface: "#231c17", surfaceAlpha: 0.82, border: "#f5ece2", borderAlpha: 0.15, text: "#f5ece2", brightText: "#ffffff", accent: "#ff9e5e" },
  { id: "grey", name: "Grey", board: "#1b1b1b", surface: "#262626", surfaceAlpha: 0.84, border: "#ffffff", borderAlpha: 0.14, text: "#ececec", brightText: "#ffffff", accent: "#a6a6a6" },
  { id: "light", name: "Light", board: "#f3f4f8", surface: "#e9ebf0", surfaceAlpha: 1, border: "#0f172a", borderAlpha: 0.16, text: "#171a21", brightText: "#ffffff", accent: "#b5b5b5" },
  { id: "ocean", name: "Ocean", board: "#0c171a", surface: "#152930", surfaceAlpha: 0.82, border: "#e2f2f7", borderAlpha: 0.15, text: "#e2f2f7", brightText: "#ffffff", accent: "#3ad6d6" },
  { id: "paper", name: "Paper", board: "#f7f5f0", surface: "#f0eae1", surfaceAlpha: 0.82, border: "#2a2119", borderAlpha: 0.17, text: "#2a2119", brightText: "#ffffff", accent: "#954a18" },
  { id: "skyblue", name: "Sky Blue", board: "#e3eaf8", surface: "#ffffff", surfaceAlpha: 0.92, border: "#4869a8", borderAlpha: 0.3, text: "#182a4c", brightText: "#ffffff", accent: "#c2e4ff" },
  { id: "wine", name: "Wine", board: "#160d10", surface: "#2a191d", surfaceAlpha: 0.82, border: "#f7e8ec", borderAlpha: 0.15, text: "#f7e8ec", brightText: "#ffffff", accent: "#ff86a8" },
];

export function mapRebufferTheme(source: RebufferThemeSource): ThemePreset {
  return {
    id: source.id,
    name: source.name,
    colors: {
      base: blendColor(source.surface, source.board, source.surfaceAlpha),
      accent: source.accent,
      icon: relativeLuminance(source.board) > 0.5 ? source.text : source.brightText,
      board: source.board,
      // Rebuffer borders are near the board colour, which made the grid almost invisible:
      // white lines on dark boards (like Hive), black lines on light boards.
      grid: relativeLuminance(source.board) > 0.5 ? "#000000" : "#ffffff",
    },
  };
}

export const BUILTIN_THEME_PRESETS: readonly ThemePreset[] = [
  { id: "hive", name: "Hive", colors: { ...DEFAULT_THEME_COLORS } },
  ...REBUFFER_THEME_SOURCES.map(mapRebufferTheme),
];

export const DEFAULT_THEME_SETTINGS: Readonly<ThemeSettings> = {
  colors: { ...DEFAULT_THEME_COLORS },
  activePresetId: "hive",
  userPresets: [],
};

const BUILTIN_IDS = new Set(BUILTIN_THEME_PRESETS.map(({ id }) => id));
const MAX_USER_PRESETS = 100;
const MAX_PRESET_NAME_LENGTH = 36;

export function normalizeThemeSettings(value: unknown, fallback: Readonly<ThemeSettings> = DEFAULT_THEME_SETTINGS): ThemeSettings {
  const input = asRecord(value);
  if (!input) return cloneThemeSettings(fallback);

  const userPresets = normalizeUserThemePresets(input.userPresets, fallback.userPresets);
  const colors = normalizeThemeColors(input.colors, fallback.colors);
  const rawActiveId = typeof input.activePresetId === "string" ? input.activePresetId : null;
  const builtin = rawActiveId ? BUILTIN_THEME_PRESETS.find((preset) => preset.id === rawActiveId) : undefined;
  const userPreset = rawActiveId ? userPresets.find((preset) => preset.id === rawActiveId) : undefined;
  const activePreset = builtin ?? userPreset;

  return {
    colors: activePreset ? { ...activePreset.colors } : colors,
    activePresetId: activePreset?.id ?? null,
    userPresets,
  };
}

export function normalizeUserThemePresets(value: unknown, fallback: readonly UserThemePreset[] = []): UserThemePreset[] {
  if (!Array.isArray(value)) return fallback.map(cloneUserPreset).slice(0, MAX_USER_PRESETS);
  const result: UserThemePreset[] = [];
  const ids = new Set<string>();

  for (const candidate of value) {
    const input = asRecord(candidate);
    if (!input || typeof input.id !== "string" || typeof input.name !== "string") continue;
    const id = input.id.trim().toLowerCase();
    const name = normalizePresetName(input.name);
    if (!isValidUserPresetId(id) || BUILTIN_IDS.has(id) || ids.has(id) || !name) continue;
    ids.add(id);
    result.push({ id, name, colors: normalizeThemeColors(input.colors) });
    if (result.length >= MAX_USER_PRESETS) break;
  }
  return result;
}

export function selectThemePreset(settings: Readonly<ThemeSettings>, presetId: string): ThemeSettings {
  const preset = BUILTIN_THEME_PRESETS.find((item) => item.id === presetId)
    ?? settings.userPresets.find((item) => item.id === presetId);
  return preset
    ? { ...cloneThemeSettings(settings), colors: { ...preset.colors }, activePresetId: preset.id }
    : cloneThemeSettings(settings);
}

export function createUserThemePreset(settings: Readonly<ThemeSettings>, name: string, id: string): ThemeSettings {
  const normalizedName = normalizePresetName(name);
  const normalizedId = id.trim().toLowerCase();
  if (!normalizedName || !isValidUserPresetId(normalizedId) || BUILTIN_IDS.has(normalizedId) ||
    settings.userPresets.length >= MAX_USER_PRESETS || settings.userPresets.some((preset) => preset.id === normalizedId)) {
    return cloneThemeSettings(settings);
  }
  const preset = { id: normalizedId, name: normalizedName, colors: { ...settings.colors } };
  return { ...cloneThemeSettings(settings), userPresets: [...settings.userPresets, preset], activePresetId: normalizedId };
}

export function renameUserThemePreset(settings: Readonly<ThemeSettings>, id: string, name: string): ThemeSettings {
  const normalizedName = normalizePresetName(name);
  if (!normalizedName) return cloneThemeSettings(settings);
  let found = false;
  const userPresets = settings.userPresets.map((preset) => {
    if (preset.id !== id) return cloneUserPreset(preset);
    found = true;
    return { ...cloneUserPreset(preset), name: normalizedName };
  });
  return found ? { ...cloneThemeSettings(settings), userPresets } : cloneThemeSettings(settings);
}

export function duplicateUserThemePreset(
  settings: Readonly<ThemeSettings>,
  id: string,
  name: string,
  newId: string,
): ThemeSettings {
  const source = settings.userPresets.find((preset) => preset.id === id);
  const normalizedName = normalizePresetName(name);
  const normalizedId = newId.trim().toLowerCase();
  if (!source || !normalizedName || !isValidUserPresetId(normalizedId) || BUILTIN_IDS.has(normalizedId) ||
    settings.userPresets.length >= MAX_USER_PRESETS || settings.userPresets.some((preset) => preset.id === normalizedId)) {
    return cloneThemeSettings(settings);
  }
  const duplicate = { id: normalizedId, name: normalizedName, colors: { ...source.colors } };
  return { ...cloneThemeSettings(settings), userPresets: [...settings.userPresets, duplicate], activePresetId: normalizedId };
}

export function deleteUserThemePreset(settings: Readonly<ThemeSettings>, id: string): ThemeSettings {
  if (!settings.userPresets.some((preset) => preset.id === id)) return cloneThemeSettings(settings);
  return {
    colors: { ...settings.colors },
    activePresetId: settings.activePresetId === id ? null : settings.activePresetId,
    userPresets: settings.userPresets.filter((preset) => preset.id !== id).map(cloneUserPreset),
  };
}

export function isBuiltinThemePreset(id: string): boolean {
  return BUILTIN_IDS.has(id);
}

function normalizePresetName(name: string): string | null {
  const normalized = name.trim().slice(0, MAX_PRESET_NAME_LENGTH);
  return normalized.length > 0 ? normalized : null;
}

function isValidUserPresetId(id: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(id);
}

function cloneThemeSettings(settings: Readonly<ThemeSettings>): ThemeSettings {
  return {
    colors: { ...settings.colors },
    activePresetId: settings.activePresetId,
    userPresets: settings.userPresets.map(cloneUserPreset),
  };
}

function cloneUserPreset(preset: Readonly<UserThemePreset>): UserThemePreset {
  return { id: preset.id, name: preset.name, colors: normalizeThemeColors(preset.colors) };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
