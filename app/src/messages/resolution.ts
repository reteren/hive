import { IMPORTANCE_LEVELS, type ImportanceLevel, type Note } from "../model/note";
import type { Link } from "../model/link";
import type { ShownMessage } from "../time/types";
import { effectiveImportanceFor } from "../modules/moduleLogic";
import { defaultMessageData } from "./data";

export function importanceSoundCount(importance: ImportanceLevel | null | undefined): number {
  return Math.max(1, IMPORTANCE_LEVELS.indexOf(importance as ImportanceLevel) + 1);
}

/** Select the earliest linked text node by board paint order; any line counts, either direction. */
export function firstLinkedTaskForMessage(
  message: Note,
  notes: Readonly<Record<string, Note>>,
  edges: readonly Pick<Link, "from" | "to" | "kind">[],
  order: readonly string[] = Object.keys(notes),
): Note | null {
  const candidates = new Set<string>();
  for (const edge of edges) {
    const id = edge.from === message.id ? edge.to : edge.to === message.id ? edge.from : null;
    if (id && notes[id]?.type === "note") candidates.add(id);
  }
  let first: Note | null = null;
  let firstIndex = Number.POSITIVE_INFINITY;
  for (const id of candidates) {
    const candidate = notes[id];
    if (!candidate || candidate.type !== "note") continue;
    const index = order.indexOf(id);
    if (index < firstIndex) { first = candidate; firstIndex = index; }
  }
  return first;
}

/** A link changes only the displayed text; the Message's own body remains editable afterward. */
export function messageTextFieldState(
  message: Note,
  notes: Readonly<Record<string, Note>>,
  edges: readonly Pick<Link, "from" | "to" | "kind">[],
  order: readonly string[] = Object.keys(notes),
): { value: string; readOnly: boolean; linkedTaskId: string | null } {
  const task = firstLinkedTaskForMessage(message, notes, edges, order);
  return { value: task?.text ?? message.text, readOnly: task !== null, linkedTaskId: task?.id ?? null };
}

/** Resolve once at delivery: a linked Task/Note (any line, either direction) supplies the text. */
export function resolveMessageContent(
  message: Note,
  notes: Readonly<Record<string, Note>>,
  edges: readonly Link[],
  order: readonly string[] = Object.keys(notes),
  linksForNote: (noteId: string) => readonly Link[] = () => edges,
): Pick<ShownMessage, "text" | "targetId" | "importance" | "headerHidden" | "overhive" | "sound"> {
  const task = firstLinkedTaskForMessage(message, notes, edges, order);
  const source = task ?? message;
  const levels = [
    effectiveImportanceFor(message.id, notes, linksForNote(message.id)),
    task ? effectiveImportanceFor(task.id, notes, linksForNote(task.id)) : null,
  ];
  const importance = levels.reduce<ImportanceLevel | null>((highest, level) =>
    level && IMPORTANCE_LEVELS.indexOf(level) > IMPORTANCE_LEVELS.indexOf(highest as ImportanceLevel) ? level : highest, null);
  const settings = message.message ?? defaultMessageData();
  return { text: source.text, targetId: source.id, importance, headerHidden: message.headerHidden === true,
    overhive: settings.overhive, sound: settings.sound };
}
