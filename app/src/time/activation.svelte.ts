import { board, updateNote } from "../model/board.svelte";
import { links } from "../model/links.svelte";
import { copyTimeNodeData } from "./data";
import { manualStopwatchTargets } from "./activationLogic";
import { toggleManualStopwatch } from "./stopwatchLogic";

/**
 * Apply one activation from any future activation node. Invoke inside its HistoryCommand's `do`
 * and retain the returned rollback for the same command's `undo` so one firing is one Undo step.
 */
export function emitTimeActivation(sourceId: string, now = Date.now()): () => void {
  const targets = manualStopwatchTargets(sourceId, board.notes, Object.values(links.byId));
  const previous = targets.flatMap((note) => note.time ? [{ noteId: note.id, time: copyTimeNodeData(note.time) }] : []);

  for (const note of targets) {
    const current = note.time;
    if (!current?.stopwatch) continue;
    updateNote(note.id, {
      time: {
        ...copyTimeNodeData(current),
        stopwatch: toggleManualStopwatch(current.stopwatch, now),
      },
    });
  }

  return () => {
    for (const item of previous) updateNote(item.noteId, { time: copyTimeNodeData(item.time) });
  };
}
