import type { ImportanceLevel } from "../model/note";
import type { NodeScope } from "../model/nodeData";
import { board } from "../model/board.svelte";
import { resolveSummaryMembers, scopeSummaryRevision } from "../scope/scopeRevision.svelte";
import { scopeKey } from "../scope/scopeLogic";
import { RevisionCache } from "../scope/revisionCache";
import { summarizeProgress, type ProgressSummary } from "./progress";

const summaries = new RevisionCache<ProgressSummary>();

/** Shared per-scope cache so Progress nodes reuse the same aggregate during a drag. */
export function progressSummaryForScope(
  scope: NodeScope,
  importanceFor: (noteId: string) => ImportanceLevel | null,
): ProgressSummary {
  const key = scopeKey(scope);
  const revision = scopeSummaryRevision(scope, "progress");
  return summaries.get(key, revision, () =>
    summarizeProgress(resolveSummaryMembers(scope), board.notes, importanceFor));
}
