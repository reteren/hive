import { execute } from "../history/history.svelte";
import { board, updateNote } from "../model/board.svelte";
import { copyTimeNodeData } from "./data";
import type { TimeNodeData } from "./types";

export function setTimeNodeView(noteId: string, view: "time" | "stopwatch"): void {
  const note = board.notes[noteId];
  if (note?.type !== "time" || !note.time) return;
  const previous = copyTimeNodeData(note.time);
  const previousView = previous.view ?? "time";
  if (previousView === view) return;

  const next: TimeNodeData = copyTimeNodeData(previous);
  if (view === "time") delete next.view;
  else next.view = view;

  execute({
    label: view === "stopwatch" ? "Show stopwatch" : "Show Time schedule",
    target: note.name,
    do: () => updateNote(noteId, { time: copyTimeNodeData(next) }),
    undo: () => updateNote(noteId, { time: copyTimeNodeData(previous) }),
  });
}
