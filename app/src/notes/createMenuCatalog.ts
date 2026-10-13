/**
 * What the Q (Create) menu offers and how it is organised: Note always on top, then the user's
 * starred items, then category tabs whose items fly out on hover. Pure data and helpers so the
 * grouping, search and saved preferences can be tested without the component.
 */

export const CREATE_ITEM_IDS = [
  "note",
  "task", "list", "inbox", "goal", "progress",
  "pro", "con", "importance", "purpose", "mood", "markas",
  "time", "calendar", "message",
  "image", "pdf", "format", "audio", "record-audio", "video", "youtube",
  "calculator", "tierlist", "stats", "random", "glossary", "source",
  "beacon", "map", "archive", "trash",
] as const;

export type CreateItemId = (typeof CREATE_ITEM_IDS)[number];

export interface CreateItem {
  id: CreateItemId;
  label: string;
  /** Extra words the search also matches (lower case). */
  keywords?: string;
}

export const CREATE_ITEMS: Record<CreateItemId, CreateItem> = {
  note: { id: "note", label: "Note", keywords: "text" },
  task: { id: "task", label: "Task", keywords: "todo check" },
  list: { id: "list", label: "List", keywords: "checklist items" },
  inbox: { id: "inbox", label: "Inbox" },
  goal: { id: "goal", label: "Goal", keywords: "target" },
  progress: { id: "progress", label: "Progress", keywords: "bar percent" },
  pro: { id: "pro", label: "Plus", keywords: "pro +" },
  con: { id: "con", label: "Minus", keywords: "con -" },
  importance: { id: "importance", label: "Importance", keywords: "priority" },
  purpose: { id: "purpose", label: "Purpose" },
  mood: { id: "mood", label: "Mood", keywords: "emotion" },
  markas: { id: "markas", label: "Mark as", keywords: "tag label" },
  time: { id: "time", label: "Time", keywords: "timer clock stopwatch reminder" },
  calendar: { id: "calendar", label: "Calendar", keywords: "date day" },
  message: { id: "message", label: "Message", keywords: "reminder notify" },
  image: { id: "image", label: "Image…", keywords: "picture photo gif" },
  pdf: { id: "pdf", label: "PDF…", keywords: "document" },
  format: { id: "format", label: "File…", keywords: "text code markdown document" },
  audio: { id: "audio", label: "Audio file…", keywords: "sound music mp3" },
  "record-audio": { id: "record-audio", label: "Record audio", keywords: "dictaphone voice microphone" },
  video: { id: "video", label: "Video file…", keywords: "mp4 movie" },
  youtube: { id: "youtube", label: "YouTube link…", keywords: "video url" },
  calculator: { id: "calculator", label: "Calculator", keywords: "math sum" },
  tierlist: { id: "tierlist", label: "Tierlist", keywords: "rank tier" },
  stats: { id: "stats", label: "Statistics", keywords: "stats chart" },
  random: { id: "random", label: "Random Choice", keywords: "dice pick" },
  glossary: { id: "glossary", label: "Dictionary", keywords: "glossary words terms" },
  source: { id: "source", label: "Source", keywords: "link reference" },
  beacon: { id: "beacon", label: "Beacon", keywords: "marker" },
  map: { id: "map", label: "Map", keywords: "minimap overview" },
  archive: { id: "archive", label: "Archive" },
  trash: { id: "trash", label: "Trash", keywords: "bin deleted" },
};

export type CreateCategoryId = "tasks" | "marks" | "time" | "media" | "tools" | "board";

export interface CreateCategory {
  id: CreateCategoryId;
  label: string;
  items: readonly CreateItemId[];
}

export const CREATE_CATEGORIES: readonly CreateCategory[] = [
  { id: "tasks", label: "Tasks", items: ["task", "list", "inbox", "goal", "progress"] },
  { id: "marks", label: "Marks", items: ["pro", "con", "importance", "purpose", "mood", "markas"] },
  { id: "time", label: "Time", items: ["time", "calendar", "message"] },
  { id: "media", label: "Media", items: ["image", "pdf", "format", "audio", "record-audio", "video", "youtube"] },
  { id: "tools", label: "Tools", items: ["calculator", "tierlist", "stats", "random", "glossary", "source"] },
  { id: "board", label: "Board", items: ["beacon", "map", "archive", "trash"] },
];

/** Note is always first and is not starred; everything else may be. */
export function isStarrable(id: CreateItemId): boolean {
  return id !== "note";
}

export function isCreateItemId(value: unknown): value is CreateItemId {
  return typeof value === "string" && (CREATE_ITEM_IDS as readonly string[]).includes(value);
}

/** Items whose label, id or keywords match the typed text; label-prefix matches come first. */
export function searchCreateItems(query: string): CreateItemId[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const scored: { id: CreateItemId; score: number; order: number }[] = [];
  CREATE_ITEM_IDS.forEach((id, order) => {
    const item = CREATE_ITEMS[id];
    const label = item.label.toLowerCase().replace(/…$/, "");
    const words = label.split(/\s+/);
    let score = -1;
    if (label.startsWith(needle)) score = 0;
    else if (words.some((word) => word.startsWith(needle))) score = 1;
    else if (label.includes(needle) || id.includes(needle)) score = 2;
    else if (item.keywords?.split(/\s+/).some((word) => word.startsWith(needle))) score = 3;
    if (score >= 0) scored.push({ id, score, order });
  });
  return scored.sort((a, b) => a.score - b.score || a.order - b.order).map((entry) => entry.id);
}

export const MAX_RECENT_CREATE_ITEMS = 3;

export interface CreateMenuPreferences {
  starred: CreateItemId[];
  recent: CreateItemId[];
}

export const DEFAULT_CREATE_MENU_PREFERENCES: CreateMenuPreferences = { starred: [], recent: [] };

/** Drop unknown, duplicate and non-starrable ids from saved preferences. */
export function normalizeCreateMenuPreferences(value: unknown): CreateMenuPreferences {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const ids = (list: unknown, limit: number): CreateItemId[] => {
    if (!Array.isArray(list)) return [];
    const seen = new Set<CreateItemId>();
    for (const entry of list) {
      if (isCreateItemId(entry) && isStarrable(entry)) seen.add(entry);
      if (seen.size >= limit) break;
    }
    return [...seen];
  };
  return { starred: ids(record.starred, CREATE_ITEM_IDS.length), recent: ids(record.recent, MAX_RECENT_CREATE_ITEMS) };
}

/** Most recent first; Note and starred items are already on top, so they are not repeated. */
export function withRecentCreateItem(recent: readonly CreateItemId[], id: CreateItemId): CreateItemId[] {
  if (!isStarrable(id)) return [...recent];
  return [id, ...recent.filter((entry) => entry !== id)].slice(0, MAX_RECENT_CREATE_ITEMS);
}

export function visibleRecentCreateItems(preferences: CreateMenuPreferences): CreateItemId[] {
  return preferences.recent.filter((id) => !preferences.starred.includes(id));
}
