import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { board } from "../model/board.svelte";
import { preferences } from "../settings/preferences.svelte";
import { messageQueue, dismissMessage } from "./messageQueue.svelte";
import { goToMessage, messageTargetId } from "./navigation";
import { presentedMessage } from "./presentation";
import type { OverhiveSnapshot } from "./overhiveProtocol";

/** The main queue owns cards; the desktop window receives snapshots and sends explicit actions. */
export function initializeOverhiveBridge(): () => void {
  if (!isTauri()) return () => {};
  let disposed = false;
  let unlisten: (() => void) | undefined;
  let writes = Promise.resolve();
  void listen<{ id: string; action: string }>("hive://overhive-action", ({ payload }) => {
    if (payload.action === "dismiss") dismissMessage(payload.id);
    else if (payload.action === "go-to") goToMessage(payload.id);
  }).then((dispose) => { if (disposed) dispose(); else unlisten = dispose; })
    .catch((error: unknown) => console.warn("Could not observe Overhive actions.", error));
  const disposeEffect = $effect.root(() => {
    $effect(() => {
      const snapshot: OverhiveSnapshot = {
        cards: messageQueue.items.map((card) => presentedMessage(card, board.notes)).filter((card) => card.overhive).map((card) => ({ ...card,
          title: board.notes[messageTargetId(card)]?.name ?? "Reminder",
          available: Boolean(board.notes[messageTargetId(card)]),
        })),
        reduceMotion: preferences.reduceAnimations,
      };
      writes = writes.then(async () => { if (!disposed) await invoke("sync_overhive", { snapshot }); })
        .catch((error: unknown) => { console.warn("Could not sync Overhive reminders.", error); });
    });
  });
  return () => { disposed = true; disposeEffect(); unlisten?.(); };
}
