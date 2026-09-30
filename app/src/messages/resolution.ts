import { IMPORTANCE_LEVELS, type ImportanceLevel, type Note } from "../model/note";
import type { Link } from "../model/link";
import type { ShownMessage } from "../time/types";
import { effectiveImportanceFor } from "../modules/moduleLogic";
import { defaultMessageData } from "./data";

export function importanceSoundCount(importance: ImportanceLevel | null | undefined): number {
  return Math.max(1, IMPORTANCE_LEVELS.indexOf(importance as ImportanceLevel) + 1);
}

/**
 * The card and editor must select exactly the same linked text node, in board order. Per the user,
 * Task and Note make no difference here, and any line counts (strong or weak, either direction).
 */
export function firstLinkedTaskForMessage(
  message: Note,
  notes: Readonly<Record<string, Note>>,
  edges: readonly Pick<Link, "from" | "to" | "kind">[],
  order: readonly string[] = Object.keys(notes),
): Note | null {
  const neighbours = new Set(edges.flatMap((edge) =>
    edge.from === message.id ? [edge.to] : edge.to === message.id ? [edge.from] : []));
  return order.map((id) => notes[id]).find((note) => note?.type === "note" && neighbours.has(note.id)) ?? null;
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
): Pick<ShownMessage, "text" | "targetId" | "importance" | "headerHidden" | "overhive" | "sound"> {
  const task = firstLinkedTaskForMessage(message, notes, edges, order);
  const source = task ?? message;
  const levels = [effectiveImportanceFor(message.id, notes, edges), task ? effectiveImportanceFor(task.id, notes, edges) : null];
  const importance = levels.reduce<ImportanceLevel | null>((highest, level) =>
    level && IMPORTANCE_LEVELS.indexOf(level) > IMPORTANCE_LEVELS.indexOf(highest as ImportanceLevel) ? level : highest, null);
  const settings = message.message ?? defaultMessageData();
  return { text: source.text, targetId: source.id, importance, headerHidden: message.headerHidden === true,
    overhive: settings.overhive, sound: settings.sound };
}
