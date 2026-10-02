import { board } from "../model/board.svelte";
import { registerNodeBody } from "../notes/nodeBodies";
import { initializeFileDropDispatch } from "../attachments/dropDispatch";
import { registerFileDropHandler } from "../attachments/service";
import { registerBoardFileDropHandler } from "../formats/boardFileDrop";
import SourceNodeBody from "./SourceNodeBody.svelte";
import { setSourceResourceValue } from "./actions.svelte";
import { invalidateSourceFileAvailability } from "./fileAvailability.svelte";
import { parseSourceValue, sourceDropTargetId, sourceDropValue } from "./logic";

registerNodeBody("source", SourceNodeBody);

let dropListenerStarted = false;

export function initializeSourceDropHandling(): void {
  if (dropListenerStarted) return;
  dropListenerStarted = true;
  initializeFileDropDispatch();
  registerBoardFileDropHandler();
  registerFileDropHandler(50, (paths, target) => {
    const noteId = sourceDropTargetId(target);
    if (!noteId || board.notes[noteId]?.type !== "source") return false;

    const droppedValue = sourceDropValue(paths);
    if (!droppedValue) return false;

    const parsed = parseSourceValue(droppedValue);
    if (parsed.kind === "path") invalidateSourceFileAvailability(parsed.value);
    setSourceResourceValue(noteId, droppedValue, {
      field: "resource",
      kind: "atomic",
      group: 0,
      at: performance.now(),
    });
    return true;
  });
}

initializeSourceDropHandling();
