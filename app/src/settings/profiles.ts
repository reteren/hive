/**
 * R11.4 settings profiles: named sets of the app settings ("Work", "Drawing"…) the user switches
 * between. A profile keeps only how hive looks and behaves; machine-wide things (camera position,
 * time counters, backups, the global quick input shortcut, the MCP bridge, one-time hints) stay
 * shared by all profiles.
 */

/** Serialized view-settings keys that belong to a profile. */
export const PROFILE_KEYS = [
  "cameraSettings",
  "grid",
  "history",
  "accessibility",
  "zones",
  "drawing",
  "keyOverrides",
  "fitWidthToText",
  "gifPlayback",
  "recordInBackground",
  "skipCompletedTimerConfirmation",
  "videoExternalThresholdMb",
  "appearance",
] as const;

export const MAX_PROFILES = 20;
export const MAX_PROFILE_NAME_LENGTH = 40;
export const DEFAULT_PROFILE_NAME = "Default";

export interface SettingsProfile {
  id: string;
  name: string;
  /** Serialized settings for PROFILE_KEYS; the active profile's copy is refreshed on every save. */
  settings: Record<string, unknown>;
}

export interface SettingsProfiles {
  active: string;
  list: SettingsProfile[];
}

/** The profile part of a serialized view-settings object. */
export function pickProfileSettings(serialized: Record<string, unknown>): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  for (const key of PROFILE_KEYS) {
    // JSON copy, not structuredClone: profile settings live in a $state proxy, which cannot be cloned.
    if (key in serialized && serialized[key] !== undefined) settings[key] = JSON.parse(JSON.stringify(serialized[key]));
  }
  return settings;
}

/** Serialized view settings with a profile's values laid over them (shared keys stay). */
export function withProfileSettings(
  serialized: Record<string, unknown>,
  profileSettings: Record<string, unknown>,
): Record<string, unknown> {
  return { ...serialized, ...pickProfileSettings(profileSettings) };
}

/**
 * Read the persisted profile list. A missing or broken list becomes a single "Default" profile
 * holding the current settings, so settings saved before profiles existed are kept as they are.
 */
export function parseSettingsProfiles(value: unknown, currentSettings: Record<string, unknown>): SettingsProfiles {
  const input = isRecord(value) ? value : {};
  const list: SettingsProfile[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const entry of Array.isArray(input.list) ? input.list : []) {
    if (list.length >= MAX_PROFILES || !isRecord(entry)) continue;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const name = normalizeProfileName(entry.name);
    if (!id || ids.has(id) || !name || names.has(name.toLowerCase())) continue;
    ids.add(id);
    names.add(name.toLowerCase());
    list.push({ id, name, settings: isRecord(entry.settings) ? pickProfileSettings(entry.settings) : {} });
  }
  if (list.length === 0) {
    return { active: "default", list: [{ id: "default", name: DEFAULT_PROFILE_NAME, settings: pickProfileSettings(currentSettings) }] };
  }
  const active = typeof input.active === "string" && ids.has(input.active) ? input.active : list[0].id;
  return { active, list };
}

/** Persisted form; the active profile always carries the settings in use right now. */
export function serializeSettingsProfiles(
  profiles: SettingsProfiles,
  currentSettings: Record<string, unknown>,
): { active: string; list: SettingsProfile[] } {
  const current = pickProfileSettings(currentSettings);
  return {
    active: profiles.active,
    list: profiles.list.map((profile) => ({
      id: profile.id,
      name: profile.name,
      settings: profile.id === profiles.active ? current : pickProfileSettings(profile.settings),
    })),
  };
}

/** Trimmed, single-line, length-limited name, or "" when nothing usable is left. */
export function normalizeProfileName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_PROFILE_NAME_LENGTH).trim();
}

/** `base`, or `base 2`, `base 3`… — the first name no other profile uses (case-insensitive). */
export function uniqueProfileName(list: readonly SettingsProfile[], base: string, exceptId?: string): string {
  const taken = new Set(list.filter((profile) => profile.id !== exceptId).map((profile) => profile.name.toLowerCase()));
  const root = normalizeProfileName(base) || "Profile";
  if (!taken.has(root.toLowerCase())) return root;
  for (let index = 2; ; index += 1) {
    const suffix = ` ${index}`;
    const candidate = root.slice(0, MAX_PROFILE_NAME_LENGTH - suffix.length).trimEnd() + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function createProfileId(list: readonly SettingsProfile[]): string {
  const ids = new Set(list.map((profile) => profile.id));
  for (;;) {
    const id = `p${Math.random().toString(36).slice(2, 10)}`;
    if (!ids.has(id)) return id;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
