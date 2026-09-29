import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { board } from "../model/board.svelte";
import { links } from "../model/links.svelte";
import { teleportToObject, teleportToPoint } from "../navigation/navigate";
import { showLinkStatus } from "../links-in-text/contextMenu.svelte";
import { preferences } from "../settings/preferences.svelte";
import { messageQueue, dismissMessage } from "./messageQueue.svelte";
import { goToMessage } from "./navigation";
import { overhiveMessageCards } from "./presentation";
import type { OverhiveNavigationTarget, OverhiveSnapshot } from "./overhiveProtocol";

/** The main queue owns cards; the desktop window receives snapshots and sends explicit actions. */
export function initializeOverhiveBridge(): () => void {
  if (!isTauri()) return () => {};
  let disposed = false;
  let unlisten: (() => void) | undefined;
  let unlistenNavigate: (() => void) | undefined;
  let writes = Promise.resolve();
  void listen<{ id: string; action: string }>("hive://overhive-action", ({ payload }) => {
    if (payload.action === "dismiss") dismissMessage(payload.id);
    else if (payload.action === "go-to") goToMessage(payload.id);
  }).then((dispose) => { if (disposed) dispose(); else unlisten = dispose; })
    .catch((error: unknown) => console.warn("Could not observe Overhive actions.", error));
  void listen<OverhiveNavigationTarget>("hive://overhive-navigate", ({ payload }) => {
    if (payload.kind === "note") {
      if (!board.notes[payload.noteId] || !teleportToObject(payload.noteId, { label: "Text link" })) {
        showLinkStatus("This note is missing.");
      }
    } else teleportToPoint({ x: payload.x, y: payload.y }, { label: "Text link" });
  }).then((dispose) => { if (disposed) dispose(); else unlistenNavigate = dispose; })
    .catch((error: unknown) => console.warn("Could not observe Overhive link navigation.", error));
  const disposeEffect = $effect.root(() => {
    $effect(() => {
      const snapshot: OverhiveSnapshot = {
        cards: overhiveMessageCards(messageQueue.items, board.notes, Object.values(links.byId)),
        reduceMotion: preferences.reduceAnimations,
      };
      writes = writes.then(async () => { if (!disposed) await invoke("sync_overhive", { snapshot }); })
        .catch((error: unknown) => { console.warn("Could not sync Overhive reminders.", error); });
    });
  });
  return () => { disposed = true; disposeEffect(); unlisten?.(); unlistenNavigate?.(); };
}
