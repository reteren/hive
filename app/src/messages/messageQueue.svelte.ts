import { newId } from "../model/note";
import type { ShownMessage } from "../time/types";
import { playMessageSound } from "./sound";
import { importanceSoundCount } from "./resolution";

export const messageQueue = $state({ items: [] as ShownMessage[] });

export function pushMessage(m: Omit<ShownMessage, "id" | "shownAt">): string {
  const id = newId();
  const card: ShownMessage = {
    timeId: m.timeId, messageId: m.messageId, text: m.text, dueAt: m.dueAt,
    overlate: m.overlate, sound: m.sound, targetId: m.targetId,
    importance: m.importance, headerHidden: m.headerHidden, overhive: m.overhive,
    id, shownAt: Date.now(),
  };
  messageQueue.items.unshift(card);
  if (card.sound) void playMessageSound(importanceSoundCount(card.importance));
  return id;
}

export function dismissMessage(id: string): void {
  messageQueue.items = messageQueue.items.filter((card) => card.id !== id);
}
