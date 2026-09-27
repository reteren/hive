import { getCurrentWebview } from "@tauri-apps/api/webview";
import { board } from "../model/board.svelte";
import { registerNodeBody } from "../notes/nodeBodies";
import SourceNodeBody from "./SourceNodeBody.svelte";
import { setSourceResourceValue } from "./actions.svelte";
import { invalidateSourceFileAvailability } from "./fileAvailability.svelte";
import { parseSourceValue, sourceDropTargetId, sourceDropValue } from "./logic";

registerNodeBody("source", SourceNodeBody);

let dropListenerStarted = false;

export function initializeSourceDropHandling(): void {
  if (dropListenerStarted) return;
  dropListenerStarted = true;

  try {
    void getCurrentWebview().onDragDropEvent((event) => {
      const drop = event.payload;
      if (drop.type !== "drop") return;

      const position = drop.position.toLogical(window.devicePixelRatio);
      const noteId = sourceDropTargetId(document.elementFromPoint(position.x, position.y));
      if (!noteId || board.notes[noteId]?.type !== "source") return;

      const droppedValue = sourceDropValue(drop.paths);
      if (!droppedValue) return;

      const parsed = parseSourceValue(droppedValue);
      if (parsed.kind === "path") invalidateSourceFileAvailability(parsed.value);
      setSourceResourceValue(noteId, droppedValue, {
        field: "resource",
        kind: "atomic",
        group: 0,
        at: performance.now(),
      });
    }).catch(() => {
      // The module also loads in browser-only development, where Tauri events are unavailable.
    });
  } catch {
    // The module also loads in browser-only development, where Tauri events are unavailable.
  }
}

initializeSourceDropHandling();
