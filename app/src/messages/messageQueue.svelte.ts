import { newId } from "../model/note";
import type { ShownMessage } from "../time/types";
import { playMessageSound } from "./sound";

export const messageQueue = $state({ items: [] as ShownMessage[] });
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const MAX_TIMER_MS = 2_147_483_647;

export function pushMessage(m: Omit<ShownMessage, "id" | "shownAt">): string {
  const id = newId();
  const seconds = m.autoHideSeconds;
  const card: ShownMessage = { ...m, id, shownAt: Date.now(),
    autoHideSeconds: typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? seconds : null };
  messageQueue.items.unshift(card);
  if (card.sound) void playMessageSound();
  if (card.autoHideSeconds !== null) scheduleHide(id, card.shownAt + card.autoHideSeconds * 1000);
  return id;
}

function scheduleHide(id: string, deadline: number): void {
  const remaining = deadline - Date.now();
  if (remaining <= 0) { dismissMessage(id); return; }
  timers.set(id, setTimeout(() => {
    timers.delete(id);
    if (remaining > MAX_TIMER_MS) scheduleHide(id, deadline);
    else dismissMessage(id);
  }, Math.min(remaining, MAX_TIMER_MS)));
}

export function dismissMessage(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
  messageQueue.items = messageQueue.items.filter((card) => card.id !== id);
}
