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
  /** Number of directly connected child goals. */
  goals: number;
  /** Number of directly connected child goals that are gold. */
  goldGoals: number;
  /** Gold requires at least one direct task or child goal, with all direct inputs complete. */
  gold: boolean;
}

export interface GoalRow {
  kind: "tasks" | "subtasks" | "goals";
  done: number;
  total: number;
  label: string;
}

/** Rows with no inputs are omitted; their order matches the Goal body. */
export function visibleGoalRows(state: GoalState): GoalRow[] {
  const rows: GoalRow[] = [];
  if (state.connected > 0) rows.push({
    kind: "tasks", done: state.done, total: state.connected,
    label: state.connected === 1 ? "task done" : "tasks done",
  });
  if (state.subtasks > 0) rows.push({
    kind: "subtasks", done: state.doneSubtasks, total: state.subtasks, label: "subtasks",
  });
  if (state.goals > 0) rows.push({
    kind: "goals", done: state.goldGoals, total: state.goals, label: "goals",
  });
  return rows;
}

/** Pure calculation used by the reactive board selector and tests. */
export function calculateGoalState(goalId: string, notes: readonly Note[], allLinks: readonly Link[]): GoalState {
  const empty: GoalState = { connected: 0, done: 0, subtasks: 0, doneSubtasks: 0, goals: 0, goldGoals: 0, gold: false };
  const notesById = new Map(notes.map((note) => [note.id, note]));
  if (notesById.get(goalId)?.type !== "goal") return empty;

  const directTasks = new Map<string, Set<string>>();
  const childGoals = new Map<string, Set<string>>();
  const incomingTasks = new Map<string, Set<string>>();
  for (const link of allLinks) {
    if (link.kind !== "strong") continue;
    const source = notesById.get(link.from);
    const target = notesById.get(link.to);
    if (!source || !target) continue;
    const isTask = source.type !== "goal" && Boolean(source.task);
    if (isTask && source.id !== goalId) addToSet(incomingTasks, target.id, source.id);
    if (target.type !== "goal") continue;
    if (source.type === "goal") addToSet(childGoals, target.id, source.id);
    else if (isTask) addToSet(directTasks, target.id, source.id);
  }

  const goldCache = new Map<string, boolean>();
  const visiting = new Set<string>();
  function isGold(id: string): boolean {
    if (visiting.has(id)) return false;
    const cached = goldCache.get(id);
    if (cached !== undefined) return cached;
    visiting.add(id);
    const tasks = directTasks.get(id) ?? new Set<string>();
    const goals = childGoals.get(id) ?? new Set<string>();
    const gold = tasks.size + goals.size > 0 &&
      [...tasks].every((taskId) => notesById.get(taskId)?.task?.done === true) &&
      [...goals].every(isGold);
    visiting.delete(id);
    goldCache.set(id, gold);
    return gold;
  }

  const taskIds = directTasks.get(goalId) ?? new Set<string>();
  const goalIds = childGoals.get(goalId) ?? new Set<string>();

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
  let goldGoals = 0;
  for (const childId of goalIds) {
    if (isGold(childId)) goldGoals += 1;
  }

  return {
    connected: taskIds.size,
    done,
    subtasks: subtaskIds.size,
    doneSubtasks,
    goals: goalIds.size,
    goldGoals,
    gold: isGold(goalId),
  };
}

function addToSet(map: Map<string, Set<string>>, targetId: string, sourceId: string): void {
  const ids = map.get(targetId) ?? new Set<string>();
  ids.add(sourceId);
  map.set(targetId, ids);
}

/** Read the current board state; rune-backed stores keep GoalBody live as tasks and links change. */
export function goalState(goalId: string): GoalState {
  return calculateGoalState(goalId, Object.values(board.notes), Object.values(links.byId));
}
