import { board } from "../model/board.svelte";
import type { Link } from "../model/link";
import { links } from "../model/links.svelte";
import type { Note } from "../model/note";

export interface GoalState {
  /** Number of directly connected task notes. */
  connected: number;
  /** Number of directly connected tasks that are done. */
  done: number;
  /** Distinct task notes upstream of direct tasks, excluding the direct tasks. */
  subtasks: number;
  /** Number of upstream subtasks that are done. */
  doneSubtasks: number;
  /** Gold is shown only when at least one connected task exists and all are done. */
  gold: boolean;
}

/** Pure calculation used by the reactive board selector and tests. */
export function calculateGoalState(goalId: string, notes: readonly Note[], allLinks: readonly Link[]): GoalState {
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const goal = notesById.get(goalId);
  if (goal?.type !== "goal") return { connected: 0, done: 0, subtasks: 0, doneSubtasks: 0, gold: false };

  const taskIds = new Set<string>();
  const incomingTasks = new Map<string, Set<string>>();
  for (const link of allLinks) {
    if (link.kind !== "strong" || link.from === goalId) continue;
    const predecessor = notesById.get(link.from);
    if (!predecessor?.task) continue;

    if (link.to === goalId) {
      taskIds.add(predecessor.id);
      continue;
    }
    const targets = incomingTasks.get(link.to) ?? new Set<string>();
    targets.add(predecessor.id);
    incomingTasks.set(link.to, targets);
  }

  let done = 0;
  for (const taskId of taskIds) {
    if (notesById.get(taskId)?.task?.done) done += 1;
  }

  const subtaskIds = new Set<string>();
  const visited = new Set(taskIds);
  const pending = [...taskIds];
  while (pending.length > 0) {
    const targetId = pending.pop()!;
    for (const predecessorId of incomingTasks.get(targetId) ?? []) {
      if (visited.has(predecessorId)) continue;
      visited.add(predecessorId);
      subtaskIds.add(predecessorId);
      pending.push(predecessorId);
    }
  }

  let doneSubtasks = 0;
  for (const taskId of subtaskIds) {
    if (notesById.get(taskId)?.task?.done) doneSubtasks += 1;
  }

  return {
    connected: taskIds.size,
    done,
    subtasks: subtaskIds.size,
    doneSubtasks,
    gold: taskIds.size > 0 && done === taskIds.size,
  };
}

/** Read the current board state; rune-backed stores keep GoalBody live as tasks and links change. */
export function goalState(goalId: string): GoalState {
  return calculateGoalState(goalId, Object.values(board.notes), Object.values(links.byId));
}
