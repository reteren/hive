import { IMPORTANCE_LEVELS, type ImportanceLevel, type Note } from "../model/note";
import type { Link } from "../model/link";
import type { ShownMessage } from "../time/types";
import { effectiveImportanceFor } from "../modules/moduleLogic";
import { defaultMessageData } from "./data";

export function importanceSoundCount(importance: ImportanceLevel | null | undefined): number {
  return Math.max(1, IMPORTANCE_LEVELS.indexOf(importance as ImportanceLevel) + 1);
}

/** Resolve once at delivery: Task links work in either direction, weak links have no effect. */
export function resolveMessageContent(
  message: Note,
  notes: Readonly<Record<string, Note>>,
  edges: readonly Link[],
  order: readonly string[] = Object.keys(notes),
): Pick<ShownMessage, "text" | "targetId" | "importance" | "headerHidden" | "overhive" | "sound"> {
  const neighbours = new Set(edges.flatMap((edge) => edge.kind !== "strong" ? [] :
    edge.from === message.id ? [edge.to] : edge.to === message.id ? [edge.from] : []));
  const task = order.map((id) => notes[id]).find((note) => note?.task && neighbours.has(note.id));
  const source = task ?? message;
  const levels = [effectiveImportanceFor(message.id, notes, edges), task ? effectiveImportanceFor(task.id, notes, edges) : null];
  const importance = levels.reduce<ImportanceLevel | null>((highest, level) =>
    level && IMPORTANCE_LEVELS.indexOf(level) > IMPORTANCE_LEVELS.indexOf(highest as ImportanceLevel) ? level : highest, null);
  const settings = message.message ?? defaultMessageData();
  return { text: source.text, targetId: source.id, importance, headerHidden: message.headerHidden === true,
    overhive: settings.overhive, sound: settings.sound };
}
