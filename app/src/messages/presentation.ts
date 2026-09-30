import type { ShownMessage } from "../time/types";
import type { Note } from "../model/note";
import type { Link } from "../model/link";
import { customMarkFrameColorsFor } from "../markas/markasLogic";
import { linkedNoteIds } from "../editor/markdown";

export const VISIBLE_MESSAGE_LIMIT = 4;

export interface MessageCardPresentation extends ShownMessage {
  title: string;
  available: boolean;
  linkedNotes: Record<string, string>;
  customMarkFrameColors: string[];
}

/** Header and desktop visibility follow the Message controls even for already delivered cards. */
export function presentedMessage(card: ShownMessage, notes: Readonly<Record<string, Note>>): ShownMessage {
  const source = card.messageId ? notes[card.messageId] : undefined;
  return source && (source.type === "message" || source.message !== undefined)
    ? { ...card, headerHidden: source.headerHidden === true, overhive: source.message?.overhive === true }
    : card;
}

/** Resolve the same display metadata for the Hive stack and its optional Overhive copy. */
export function messageCardPresentation(
  card: ShownMessage,
  notes: Readonly<Record<string, Note>>,
  edges: readonly Pick<Link, "from" | "to" | "kind">[],
): MessageCardPresentation {
  const current = presentedMessage(card, notes);
  const targetId = current.targetId ?? current.messageId ?? current.timeId;
  const target = notes[targetId];
  const linkedNotes: Record<string, string> = {};
  for (const id of linkedNoteIds(current.text)) {
    const note = notes[id];
    if (note) linkedNotes[id] = note.name;
  }
  const frameSourceId = current.messageId ?? current.timeId;
  return {
    ...current,
    title: target?.name ?? "Reminder",
    available: Boolean(target),
    linkedNotes,
    customMarkFrameColors: customMarkFrameColorsFor(frameSourceId, notes, edges),
  };
}

/** The Overhive is a view of the shared queue; local Hive cards remain in the queue too. */
export function overhiveMessageCards(
  items: readonly ShownMessage[],
  notes: Readonly<Record<string, Note>>,
  edges: readonly Pick<Link, "from" | "to" | "kind">[],
): MessageCardPresentation[] {
  return items.map((card) => messageCardPresentation(card, notes, edges)).filter((card) => card.overhive === true);
}

/** Overhive cards stay in the shared queue, but appear only in the desktop window. */
export function hiveMessageCards(
  items: readonly ShownMessage[],
  notes: Readonly<Record<string, Note>>,
  edges: readonly Pick<Link, "from" | "to" | "kind">[],
): MessageCardPresentation[] {
  return items.map((card) => messageCardPresentation(card, notes, edges)).filter((card) => card.overhive !== true);
}

export function visibleMessages<T extends ShownMessage>(items: readonly T[], expanded = false): readonly T[] {
  return expanded ? items : items.slice(0, VISIBLE_MESSAGE_LIMIT);
}

export function messageDueLabel(dueAt: number): string {
  const date = new Date(dueAt);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function messageDueIso(dueAt: number): string | undefined {
  const date = new Date(dueAt);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
