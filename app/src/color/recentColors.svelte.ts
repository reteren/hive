import { normalizeHex } from "./hex";

const STORAGE_KEY = "hive.recentColors";
export const RECENT_COLOR_LIMIT = 10;

function load(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => (typeof item === "string" ? normalizeHex(item) : null))
      .filter((item): item is string => item !== null)
      .slice(-RECENT_COLOR_LIMIT);
  } catch {
    return [];
  }
}

/** Last picked colours shared by every HEX palette, oldest first: a new colour enters on the right and the oldest drops off the left. */
export const recentColors = $state({ list: load() });

export function pushRecentColor(color: string): void {
  const hex = normalizeHex(color);
  if (!hex) return;
  recentColors.list = [...recentColors.list.filter((item) => item !== hex), hex].slice(-RECENT_COLOR_LIMIT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recentColors.list));
  } catch {
    // Storage can be unavailable (private mode, tests); the list still works for this session.
  }
}
