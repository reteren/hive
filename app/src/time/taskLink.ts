import type { Link } from "../model/link";
import type { Note } from "../model/note";

export interface LinkedTimeState {
  noteId: string;
  enabled: boolean;
}

/** Return only strong, directed Task → Time links; weak and reverse links are visual only. */
export function linkedTimeStatesForTask(
  taskId: string,
  edges: readonly Link[],
  notes: Readonly<Record<string, Pick<Note, "type" | "time"> | undefined>>,
): LinkedTimeState[] {
  const seen = new Set<string>();
  const states: LinkedTimeState[] = [];
  for (const edge of edges) {
    if (edge.kind !== "strong" || edge.from !== taskId || seen.has(edge.to)) continue;
    const target = notes[edge.to];
    if (target?.type !== "time" || !target.time) continue;
    seen.add(edge.to);
    states.push({ noteId: edge.to, enabled: target.time.enabled });
  }
  return states;
}

/** True when an active Time has an incoming strong link from a task-bearing note. */
export function hasLinkedTaskForTime(
  timeId: string,
  edges: readonly Link[],
  notes: Readonly<Record<string, Pick<Note, "task"> | undefined>>,
): boolean {
  return edges.some((edge) => edge.kind === "strong" && edge.to === timeId && Boolean(notes[edge.from]?.task));
}
