import { normalizeHex } from "./hex";

const STORAGE_KEY = "hive.recentColors.v2";
/** 1.5.9 stored the row oldest-first under this key; it is read once, reversed. */
const LEGACY_KEY = "hive.recentColors";
export const RECENT_COLOR_LIMIT = 10;

function parseList(raw: string | null): string[] | null {
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => (typeof item === "string" ? normalizeHex(item) : null))
    .filter((item): item is string => item !== null);
}

function load(): string[] {
  try {
    const current = parseList(localStorage.getItem(STORAGE_KEY));
    if (current) return current.slice(0, RECENT_COLOR_LIMIT);
    const legacy = parseList(localStorage.getItem(LEGACY_KEY));
    return legacy ? legacy.reverse().slice(0, RECENT_COLOR_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Last picked colours shared by every HEX palette, newest first: a new colour enters on the left, the row shifts right and the oldest drops off the right. */
export const recentColors = $state({ list: load() });

export function pushRecentColor(color: string): void {
  const hex = normalizeHex(color);
  if (!hex) return;
  recentColors.list = [hex, ...recentColors.list.filter((item) => item !== hex)].slice(0, RECENT_COLOR_LIMIT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recentColors.list));
  } catch {
    // Storage can be unavailable (private mode, tests); the list still works for this session.
  }
}
