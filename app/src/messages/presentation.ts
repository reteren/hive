import type { ShownMessage } from "../time/types";
import type { Note } from "../model/note";

export const VISIBLE_MESSAGE_LIMIT = 4;

/** Header and desktop visibility follow the Message controls even for already delivered cards. */
export function presentedMessage(card: ShownMessage, notes: Readonly<Record<string, Note>>): ShownMessage {
  const source = card.messageId ? notes[card.messageId] : undefined;
  return source?.type === "message" ? { ...card, headerHidden: source.headerHidden === true,
    overhive: source.message?.overhive === true } : card;
}

export function visibleMessages(items: readonly ShownMessage[], expanded = false): readonly ShownMessage[] {
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
