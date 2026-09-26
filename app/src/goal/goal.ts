import { board } from "../model/board.svelte";
import type { Link } from "../model/link";
import { links } from "../model/links.svelte";
import type { Note } from "../model/note";

export interface GoalState {
  /** Number of directly connected task notes. */
  connected: number;
  /** Number of directly connected tasks that are done. */
  done: number;
  /** Gold is shown only when at least one connected task exists and all are done. */
  gold: boolean;
}

/** Pure calculation used by the reactive board selector and tests. */
export function calculateGoalState(goalId: string, notes: readonly Note[], allLinks: readonly Link[]): GoalState {
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const goal = notesById.get(goalId);
  if (goal?.type !== "goal") return { connected: 0, done: 0, gold: false };

  const taskIds = new Set<string>();
  for (const link of allLinks) {
    if (link.kind !== "strong" || link.to !== goalId) continue;
    if (notesById.get(link.from)?.task) taskIds.add(link.from);
  }

  let done = 0;
  for (const taskId of taskIds) {
    if (notesById.get(taskId)?.task?.done) done += 1;
  }

  return { connected: taskIds.size, done, gold: taskIds.size > 0 && done === taskIds.size };
}

/** Read the current board state; rune-backed stores keep GoalBody live as tasks and links change. */
export function goalState(goalId: string): GoalState {
  return calculateGoalState(goalId, Object.values(board.notes), Object.values(links.byId));
}
