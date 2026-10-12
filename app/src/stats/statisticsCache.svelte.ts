import type { NodeScope } from "../model/nodeData";
import { board } from "../model/board.svelte";
import { resolveSummaryMembers, scopeSummaryRevision } from "../scope/scopeRevision.svelte";
import { scopeKey } from "../scope/scopeLogic";
import { RevisionCache } from "../scope/revisionCache";
import { summarizeTextStatistics, type TextStatistics } from "./statistics";

const summaries = new RevisionCache<TextStatistics>();

/** Shared per-scope cache for ordinary text Statistics nodes. */
export function textStatisticsForScope(scope: NodeScope): TextStatistics {
  const key = scopeKey(scope);
  const revision = scopeSummaryRevision(scope, "text");
  return summaries.get(key, revision, () =>
    summarizeTextStatistics(resolveSummaryMembers(scope), board.notes));
}
