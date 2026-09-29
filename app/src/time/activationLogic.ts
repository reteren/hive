import type { Link } from "../model/link";
import type { Note } from "../model/note";

/** Current activation sources are Random Choice nodes with strong links into this Time node. */
export function activationSourcesForTime(
  timeId: string,
  notes: Readonly<Record<string, Note>>,
  links: readonly Link[],
): Note[] {
  const seen = new Set<string>();
  return links.flatMap((link) => {
    if (link.to !== timeId || link.kind !== "strong" || seen.has(link.from)) return [];
    const source = notes[link.from];
    if (source?.type !== "random") return [];
    seen.add(source.id);
    return [source];
  });
}

/** Any activation node may invoke this path; only manual-stopwatch Time nodes respond. */
export function manualStopwatchTargets(
  sourceId: string,
  notes: Readonly<Record<string, Note>>,
  links: readonly Link[],
): Note[] {
  const seen = new Set<string>();
  return links.flatMap((link) => {
    if (link.from !== sourceId || link.kind !== "strong" || seen.has(link.to)) return [];
    const target = notes[link.to];
    if (target?.type !== "time" || target.time?.stopwatch?.mode !== "manual") return [];
    seen.add(target.id);
    return [target];
  });
}
