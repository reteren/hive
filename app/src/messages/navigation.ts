import { board } from "../model/board.svelte";
import { teleportToObject } from "../navigation/navigate";
import { dismissMessage, messageQueue } from "./messageQueue.svelte";
import type { ShownMessage } from "../time/types";

export function messageTargetId(message: Pick<ShownMessage, "messageId" | "timeId" | "targetId">): string {
  return message.targetId ?? message.messageId ?? message.timeId;
}

/** Only called by an explicit Go to click/command; enqueueing never navigates or selects. */
export function goToMessage(id: string): boolean {
  const card = messageQueue.items.find((item) => item.id === id);
  if (!card || !board.notes[messageTargetId(card)]) return false;
  if (!teleportToObject(messageTargetId(card), { label: "Go to message" })) return false;
  dismissMessage(id);
  return true;
}
