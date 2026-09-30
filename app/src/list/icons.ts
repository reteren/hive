import type { Note, NoteKind } from "../model/note";
import type { ListItem } from "../model/nodeData";
import type { Zone } from "../model/zone";

export type ListRowKind = NoteKind | "task" | "zone" | "text" | "missing";
export interface ListIcon { label: string; color: string; paths: readonly string[] }

/** All row kinds share the same 18-unit stroke grid. */
export const LIST_ICONS: Record<ListRowKind, ListIcon> = {
  note: { label: "Note", color: "var(--text-dim)", paths: ["M4 2.5h7l3 3V15.5H4Z M11 2.5v3h3 M6.5 9h5 M6.5 12h5"] },
  task: { label: "Task", color: "#91c8a4", paths: ["M3 3h12v12H3Z M5.5 9l2.5 2.5 4.5-5"] },
  beacon: { label: "Beacon", color: "#d1b574", paths: ["M9 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 1.5v1 M9 15.5v1 M1.5 9h1 M15.5 9h1"] },
  zone: { label: "Zone", color: "#8ba8cc", paths: ["M3 6V3h3 M12 3h3v3 M15 12v3h-3 M6 15H3v-3 M6 6h6v6H6Z"] },
  pro: { label: "Plus", color: "#92c79b", paths: ["M9 3v12 M3 9h12"] },
  con: { label: "Minus", color: "#df9797", paths: ["M3 9h12"] },
  importance: { label: "Importance", color: "#e6bd6a", paths: ["M9 2.5 15.5 15h-13Z M9 6.5v4 M9 13h.01"] },
  purpose: { label: "Purpose", color: "#b4a1d9", paths: ["M4 15V3 M4 3h10l-2 3 2 3H4"] },
  mood: { label: "Mood", color: "#91bbcf", paths: ["M9 2.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13 M6 7h.01 M12 7h.01 M5.5 10.5q3.5 4 7 0"] },
  markas: { label: "Mark as", color: "#c4a1d9", paths: ["M2.5 3h6l7 7-5.5 5.5-7-7Z M5.5 5.5h.01"] },
  time: { label: "Time", color: "#7fc4d8", paths: ["M10 3.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13Z M10 6.5v3.8l2.6 1.6"] },
  calendar: { label: "Calendar", color: "#8fc4a0", paths: ["M4 5.5h12v11H4Z M4 8.5h12 M7.5 3.5v3 M12.5 3.5v3"] },
  message: { label: "Message", color: "#e8c070", paths: ["M3.5 4.5h13v8.5h-7.5l-3.5 3v-3h-2Z"] },
  goal: { label: "Goal", color: "#d8b976", paths: ["M9 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12 M9 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M9 9l6-6"] },
  progress: { label: "Progress", color: "#91c8a4", paths: ["M3 5h12v8H3Z M6 7v4 M9 7v4"] },
  calculator: { label: "Calculator", color: "#b8adce", paths: ["M4 2.5h10v13H4Z M6 5h6 M6 8h.01 M9 8h.01 M12 8h.01 M6 11h.01 M9 11h.01 M12 11h.01 M6 13h.01 M9 13h.01 M12 13h.01"] },
  tierlist: { label: "Tierlist", color: "#c4a18a", paths: ["M3 3h12v12H3Z M3 7h12 M3 11h12 M7 3v12"] },
  stats: { label: "Statistics", color: "#91bbcf", paths: ["M3 15V3 M3 15h12 M6 12V9 M10 12V6 M14 12V3"] },
  archive: { label: "Archive", color: "#c6af7b", paths: ["M2.5 3h13v3h-13Z M4 6v9h10V6 M7 9h4"] },
  trash: { label: "Trash", color: "#b8a2a2", paths: ["M3 5h12 M6 5V3h6v2 M5 5l1 10h6l1-10 M8 8v4 M10 8v4"] },
  inbox: { label: "Inbox", color: "#92b8c7", paths: ["M3 3h12l1 11H2Z M2.5 10h4l1 2h3l1-2h4 M9 4v5 M7 7l2 2 2-2"] },
  list: { label: "List", color: "#b1c0a0", paths: ["M3 4h.01 M3 9h.01 M3 14h.01 M6 4h9 M6 9h9 M6 14h9"] },
  source: { label: "Source", color: "#91bbcf", paths: ["M10 3h5v5 M15 3l-8 8 M7 4H3v11h11v-4"] },
  glossary: { label: "Dictionary", color: "#b4a1d9", paths: ["M9 4Q5 2 2.5 3.5v11Q5 13 9 15 M9 4q4-2 6.5-.5v11Q13 13 9 15 M9 4v11"] },
  map: { label: "Map", color: "#91c8b2", paths: ["M2.5 4 7 2.5l4 2 4.5-1.5v11L11 15.5l-4-2L2.5 15Z M7 2.5v11 M11 4.5v11"] },
  random: { label: "Random Choice", color: "#d1b574", paths: ["M2 5h3l8 8h3 M13 10l3 3-3 3 M2 13h3l8-8h3 M13 2l3 3-3 3"] },
  text: { label: "Plain text", color: "var(--text-dim)", paths: ["M3 4h12 M9 4v11 M6 15h6"] },
  missing: { label: "Missing target", color: "#a98d8d", paths: ["M6 12l6-6 M4.5 10.5l-1 1a2.5 2.5 0 0 0 3.5 3.5l1-1 M10.5 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1 M3 3l12 12"] },
};

export function listItemKind(item: ListItem, notes: Readonly<Record<string, Note>>, zones: Readonly<Record<string, Zone>> = {}): ListRowKind {
  if (item.targetId === null) return "text";
  const target = notes[item.targetId];
  if (target) return target.task ? "task" : target.type;
  return zones[item.targetId] ? "zone" : "missing";
}
