import type { ImportanceLevel, Note } from "../model/note";

const WEIGHTS: Record<ImportanceLevel, number> = {
  basic: 1,
  medium: 2,
  important: 3,
  immediately: 4,
  absolute: 5,
};

export interface ProgressSummary {
  taskCount: number;
  doneWeight: number;
  totalWeight: number;
  percent: number | null;
}

/** Count each task once; absent Importance and Basic both weigh one point. */
export function summarizeProgress(
  noteIds: Iterable<string>,
  notes: Readonly<Record<string, Note | undefined>>,
  importanceFor: (noteId: string) => ImportanceLevel | null,
): ProgressSummary {
  let taskCount = 0;
  let doneWeight = 0;
  let totalWeight = 0;

  for (const noteId of new Set(noteIds)) {
    const note = notes[noteId];
    if (!note?.task) continue;

    taskCount += 1;
    const weight = WEIGHTS[importanceFor(noteId) ?? "basic"];
    totalWeight += weight;
    if (note.task.done) doneWeight += weight;
  }

  return {
    taskCount,
    doneWeight,
    totalWeight,
    percent: totalWeight === 0 ? null : Math.round((doneWeight / totalWeight) * 100),
  };
}
