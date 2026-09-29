import { execute } from "../history/history.svelte";
import { board, updateNote } from "../model/board.svelte";
import { links } from "../model/links.svelte";
import { copyTimeNodeData } from "./data";
import { timeEnablePreference } from "./enablePreference.svelte";
import { restartTimeNode } from "./runtime.svelte";
import { linkedTaskCompletionForTime } from "./taskLink";
import { defaultAtTimeSchedule } from "./uiSchedule";

/** Shared by standalone and embedded Time controls; confirmation creates no history entry. */
export function setTimeEnabled(noteId: string, enabled: boolean, confirmed = false): "changed" | "confirmation-required" | "unchanged" {
  const note = board.notes[noteId];
  if (!note || (!note.time && note.type !== "time")) return "unchanged";
  const previous = note.time ? copyTimeNodeData(note.time)
    : { schedule: defaultAtTimeSchedule(note.createdAt ?? Date.now()), enabled: false };
  if (previous.enabled === enabled) return "unchanged";
  if (enabled && !confirmed && !timeEnablePreference.skipCompletedTimerConfirmation
    && linkedTaskCompletionForTime(noteId, Object.values(links.byId), board.notes).allDone) {
    return "confirmation-required";
  }
  const next = { ...previous, enabled };
  execute({
    label: enabled ? "Enable reminder" : "Stop reminder",
    target: note.name,
    do: () => { updateNote(noteId, { time: copyTimeNodeData(next) }); restartTimeNode(noteId); },
    undo: () => { updateNote(noteId, { time: copyTimeNodeData(previous) }); restartTimeNode(noteId); },
  });
  return "changed";
}
