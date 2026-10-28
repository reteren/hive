import { t } from "../i18n/i18n.svelte";
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
  "calculator", "tierlist", "graph", "stats", "random", "glossary", "source",
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
  note: { id: "note", get label() { return t("Note"); }, keywords: "text" },
  task: { id: "task", get label() { return t("Task"); }, keywords: "todo check" },
  list: { id: "list", get label() { return t("List"); }, keywords: "checklist items" },
  inbox: { id: "inbox", get label() { return t("Inbox"); } },
  goal: { id: "goal", get label() { return t("Goal"); }, keywords: "target" },
  progress: { id: "progress", get label() { return t("Progress"); }, keywords: "bar percent" },
  pro: { id: "pro", get label() { return t("Plus"); }, keywords: "pro +" },
  con: { id: "con", get label() { return t("Minus"); }, keywords: "con -" },
  importance: { id: "importance", get label() { return t("Importance"); }, keywords: "priority" },
  purpose: { id: "purpose", get label() { return t("Purpose"); } },
  mood: { id: "mood", get label() { return t("Mood"); }, keywords: "emotion" },
  markas: { id: "markas", get label() { return t("Mark as"); }, keywords: "tag label" },
  time: { id: "time", get label() { return t("Time"); }, keywords: "timer clock stopwatch reminder" },
  calendar: { id: "calendar", get label() { return t("Calendar"); }, keywords: "date day" },
  message: { id: "message", get label() { return t("Message"); }, keywords: "reminder notify" },
  image: { id: "image", get label() { return t("Image…"); }, keywords: "picture photo gif" },
  pdf: { id: "pdf", get label() { return t("PDF…"); }, keywords: "document" },
  format: { id: "format", get label() { return t("File…"); }, keywords: "text code markdown document" },
  audio: { id: "audio", get label() { return t("Audio file…"); }, keywords: "sound music mp3" },
  "record-audio": { id: "record-audio", get label() { return t("Record audio"); }, keywords: "dictaphone voice microphone" },
  video: { id: "video", get label() { return t("Video file…"); }, keywords: "mp4 movie" },
  youtube: { id: "youtube", get label() { return t("YouTube link…"); }, keywords: "video url" },
  calculator: { id: "calculator", get label() { return t("Calculator"); }, keywords: "math sum" },
  tierlist: { id: "tierlist", get label() { return t("Tierlist"); }, keywords: "rank tier" },
  graph: { id: "graph", get label() { return t("Graph"); }, keywords: "chart plot axis points scatter" },
  stats: { id: "stats", get label() { return t("Statistics"); }, keywords: "stats chart" },
  random: { id: "random", get label() { return t("Random Choice"); }, keywords: "dice pick" },
  glossary: { id: "glossary", get label() { return t("Dictionary"); }, keywords: "glossary words terms" },
  source: { id: "source", get label() { return t("Source"); }, keywords: "link reference" },
  beacon: { id: "beacon", get label() { return t("Beacon"); }, keywords: "marker" },
  map: { id: "map", get label() { return t("Map"); }, keywords: "minimap overview" },
  archive: { id: "archive", get label() { return t("Archive"); } },
  trash: { id: "trash", get label() { return t("Trash"); }, keywords: "bin deleted" },
};

export type CreateCategoryId = "tasks" | "marks" | "time" | "media" | "tools" | "board";

export interface CreateCategory {
  id: CreateCategoryId;
  label: string;
  items: readonly CreateItemId[];
}

export const CREATE_CATEGORIES: readonly CreateCategory[] = [
  { id: "tasks", get label() { return t("Tasks"); }, items: ["task", "list", "inbox", "goal", "progress"] },
  { id: "marks", get label() { return t("Marks"); }, items: ["pro", "con", "importance", "purpose", "mood", "markas"] },
  { id: "time", get label() { return t("Time"); }, items: ["time", "calendar", "message"] },
  { id: "media", get label() { return t("Media"); }, items: ["image", "pdf", "format", "audio", "record-audio", "video", "youtube"] },
  { id: "tools", get label() { return t("Tools"); }, items: ["calculator", "tierlist", "graph", "stats", "random", "glossary", "source"] },
  { id: "board", get label() { return t("Board"); }, items: ["beacon", "map", "archive", "trash"] },
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
    // English keywords keep working in every language; the translated ones are searched too.
    else if (item.keywords && `${item.keywords} ${t(item.keywords)}`.toLowerCase().split(/\s+/).some((word) => word.startsWith(needle))) score = 3;
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
