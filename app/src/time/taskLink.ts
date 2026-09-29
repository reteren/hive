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
    if (!target?.time) continue;
    seen.add(edge.to);
    states.push({ noteId: edge.to, enabled: target.time.enabled });
  }
  const ownTime = notes[taskId]?.time;
  if (ownTime && !seen.has(taskId)) states.push({ noteId: taskId, enabled: ownTime.enabled });
  return states;
}

/** Embedded task timers include their own host task; duplicate links count once. */
export function linkedTaskCompletionForTime(
  timeId: string,
  edges: readonly Link[],
  notes: Readonly<Record<string, Pick<Note, "task" | "time"> | undefined>>,
  completingTaskId?: string,
): { total: number; done: number; allDone: boolean } {
  const ids = new Set<string>();
  if (notes[timeId]?.time && notes[timeId]?.task) ids.add(timeId);
  for (const edge of edges) {
    if (edge.kind === "strong" && edge.to === timeId && notes[edge.from]?.task) ids.add(edge.from);
  }
  const done = [...ids].filter((id) => id === completingTaskId || notes[id]?.task?.done).length;
  return { total: ids.size, done, allDone: ids.size > 0 && done === ids.size };
}

/** True when an active Time has an incoming strong link from a task-bearing note. */
export function hasLinkedTaskForTime(
  timeId: string,
  edges: readonly Link[],
  notes: Readonly<Record<string, Pick<Note, "task" | "time"> | undefined>>,
): boolean {
  return linkedTaskCompletionForTime(timeId, edges, notes).total > 0;
}
