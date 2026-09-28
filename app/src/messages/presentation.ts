import type { ShownMessage } from "../time/types";

export const VISIBLE_MESSAGE_LIMIT = 4;

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
