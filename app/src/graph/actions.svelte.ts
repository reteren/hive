import { execute, type HistoryCommand } from "../history/history.svelte";
import { board, updateNote } from "../model/board.svelte";
import { copyGraphData, emptyGraphData, type GraphData } from "../model/nodeData";
import { newId } from "../model/note";
import { addGraphPoint, removeGraphPoint, updateGraphPoint } from "./logic";
import { t } from "../i18n/i18n.svelte";

export function graphFor(noteId: string): GraphData {
  const note = board.notes[noteId];
  return note?.type === "graph" ? copyGraphData(note.graph ?? emptyGraphData()) : emptyGraphData();
}

export function graphChangeCommand(noteId: string, label: string, next: GraphData): HistoryCommand | null {
  const note = board.notes[noteId];
  if (note?.type !== "graph") return null;
  const before = graphFor(noteId);
  const after = copyGraphData(next);
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  return {
    label,
    target: note.name,
    do: () => updateNote(noteId, { graph: copyGraphData(after) }),
    undo: () => updateNote(noteId, { graph: copyGraphData(before) }),
  };
}

function run(command: HistoryCommand | null): boolean {
  if (!command) return false;
  execute(command);
  return true;
}

/** Returns the new point's id, or null when the node is not a Graph. */
export function addPoint(noteId: string, x: number, y: number, targetId: string | null = null): string | null {
  const id = newId();
  return run(graphChangeCommand(noteId, t("Add Graph point"), addGraphPoint(graphFor(noteId), { id, x, y, label: "", targetId }))) ? id : null;
}

export function moveGraphPoint(noteId: string, pointId: string, x: number, y: number): boolean {
  return run(graphChangeCommand(noteId, t("Move Graph point"), updateGraphPoint(graphFor(noteId), pointId, { x, y })));
}

export function renameGraphPoint(noteId: string, pointId: string, label: string): boolean {
  return run(graphChangeCommand(noteId, t("Rename Graph point"), updateGraphPoint(graphFor(noteId), pointId, { label: label.trim() })));
}

export function linkGraphPoint(noteId: string, pointId: string, targetId: string | null): boolean {
  if (targetId === noteId) return false;
  return run(graphChangeCommand(noteId, targetId ? t("Link node to Graph point") : t("Unlink Graph point"),
    updateGraphPoint(graphFor(noteId), pointId, { targetId })));
}

export function deleteGraphPoint(noteId: string, pointId: string): boolean {
  return run(graphChangeCommand(noteId, t("Delete Graph point"), removeGraphPoint(graphFor(noteId), pointId)));
}

export function renameGraphAxis(noteId: string, axis: "x" | "y", label: string): boolean {
  const next = graphFor(noteId);
  if (axis === "x") next.xLabel = label.trim();
  else next.yLabel = label.trim();
  return run(graphChangeCommand(noteId, t("Rename Graph axis"), next));
}
