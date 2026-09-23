import type { Link } from "../model/link";
import { ME_OBJECT_ID } from "../model/link";
import { board } from "../model/board.svelte";
import type { Note } from "../model/note";
import { links } from "../model/links.svelte";

/**
 * Task → Task dependencies (R3.8, decision A05): a task cannot be completed while any task
 * directly linked into it (strong link A → B) is still open. This deliberately checks only
 * direct predecessors; a longer chain is enforced one task at a time.
 */
export interface CompletionCheck {
  ok: boolean;
  /** Open predecessor note ids that block completion. */
  blockers: string[];
}

export interface DependencyAnalysis {
  /** Open direct task predecessors. Stable in board order. */
  blockers: string[];
  /** Open direct task predecessors of an already-completed task. */
  warnings: string[];
  /** Incoming predecessors which participate in a directed task cycle with the target. */
  cyclePredecessors: string[];
}

/** Pure dependency calculation, also used by tests. */
export function analyzeTaskDependencies(
  noteId: string,
  notes: Record<string, Note>,
  order: readonly string[],
  allLinks: readonly Link[],
): DependencyAnalysis {
  const target = notes[noteId];
  const empty: DependencyAnalysis = { blockers: [], warnings: [], cyclePredecessors: [] };
  if (!target?.task || noteId === ME_OBJECT_ID) return empty;

  const incoming = new Set<string>();
  for (const link of allLinks) {
    if (link.kind !== "strong" || link.to !== noteId || link.from === ME_OBJECT_ID || link.from === link.to) continue;
    const predecessor = notes[link.from];
    if (predecessor?.task) incoming.add(predecessor.id);
  }

  const stableIds = stableNoteOrder(notes, order);
  const blockers = stableIds.filter((id) => incoming.has(id) && notes[id]?.task?.done === false);
  const warnings = target.task.done
    ? stableIds.filter((id) => incoming.has(id) && notes[id]?.task?.done === false)
    : [];

  const taskEdges = new Map<string, string[]>();
  for (const link of allLinks) {
    if (link.kind !== "strong" || link.from === ME_OBJECT_ID || link.to === ME_OBJECT_ID || link.from === link.to) continue;
    if (!notes[link.from]?.task || !notes[link.to]?.task) continue;
    const outgoing = taskEdges.get(link.from) ?? [];
    outgoing.push(link.to);
    taskEdges.set(link.from, outgoing);
  }

  const cyclePredecessors = stableIds.filter((id) =>
    incoming.has(id) && hasPath(noteId, id, taskEdges),
  );

  return { blockers, warnings, cyclePredecessors };
}

/** Whether the selected task can be marked complete right now. */
export function canCompleteTask(noteId: string): CompletionCheck {
  const { blockers } = analyzeTaskDependencies(
    noteId,
    board.notes,
    board.order,
    Object.values(links.byId),
  );
  return { ok: blockers.length === 0, blockers };
}

/** Open direct predecessors of a completed task, for the stale-completion warning badge. */
export function dependencyWarnings(noteId: string): string[] {
  return analyzeTaskDependencies(
    noteId,
    board.notes,
    board.order,
    Object.values(links.byId),
  ).warnings;
}

/** Direct predecessors that close a task dependency cycle with this task. */
export function dependencyCyclePredecessors(noteId: string): string[] {
  return analyzeTaskDependencies(
    noteId,
    board.notes,
    board.order,
    Object.values(links.byId),
  ).cyclePredecessors;
}

function stableNoteOrder(notes: Record<string, Note>, order: readonly string[]): string[] {
  const seen = new Set<string>();
  const stable: string[] = [];
  for (const id of order) {
    if (notes[id] && !seen.has(id)) {
      stable.push(id);
      seen.add(id);
    }
  }
  // Normally every note is in board.order. Keep malformed/partially-loaded test or project
  // states deterministic too, without depending on link insertion order.
  for (const id of Object.keys(notes).sort()) {
    if (!seen.has(id)) stable.push(id);
  }
  return stable;
}

function hasPath(start: string, goal: string, outgoing: ReadonlyMap<string, readonly string[]>): boolean {
  if (start === goal) return true;
  const pending = [start];
  const visited = new Set<string>([start]);
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const next of outgoing.get(current) ?? []) {
      if (next === goal) return true;
      if (!visited.has(next)) {
        visited.add(next);
        pending.push(next);
      }
    }
  }
  return false;
}
