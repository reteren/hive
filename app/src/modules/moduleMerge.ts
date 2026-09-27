import { pairKey, type Link } from "../model/link";
import type { Note, PurposeKind, MoodKind } from "../model/note";
import type { CustomMark } from "../model/nodeData";
import { linkRefusalReason } from "../links/rules";
import { mergeCustomMarks } from "../markas/markasLogic";

export type ModuleMergePlan = (
  | { field: "purposes"; values: PurposeKind[] }
  | { field: "moods"; values: MoodKind[] }
  | { field: "customMarks"; values: CustomMark[]; frame: boolean }
) & {
  removedLinks: Link[];
  addedLinks: Link[];
};

export type ModuleMergeResult =
  | { ok: true; plan: ModuleMergePlan }
  | { ok: false; reason: string };

/** Target values keep their order; new source values follow without duplicates. */
export function planModuleMerge(
  source: Note,
  target: Note,
  allLinks: readonly Link[],
  notes: Readonly<Record<string, Note>>,
): ModuleMergeResult {
  if ((source.type !== "purpose" && source.type !== "mood" && source.type !== "markas") ||
    target.type !== source.type || source.id === target.id) {
    return { ok: false, reason: "Only matching Purpose, Mood, or Mark as nodes can merge." };
  }
  const valueChange = source.type === "purpose"
    ? { field: "purposes" as const, values: appendUnique(target.purposes ?? [], source.purposes ?? []) }
    : source.type === "mood"
      ? { field: "moods" as const, values: appendUnique(target.moods ?? [], source.moods ?? []) }
      : {
          field: "customMarks" as const,
          values: mergeCustomMarks(target.customMarks ?? [], source.customMarks ?? []),
          frame: target.customMarkFrame === true || source.customMarkFrame === true,
        };
  const removedLinks = allLinks.filter((link) => link.from === source.id || link.to === source.id);
  const remaining = allLinks.filter((link) => !removedLinks.includes(link));
  const addedLinks: Link[] = [];
  for (const link of removedLinks) {
    if (link.kind !== "strong") continue;
    const otherId = link.from === source.id ? link.to : link.from;
    if (otherId === target.id) continue;
    const candidate: Link = {
      ...link,
      from: link.from === source.id ? target.id : link.from,
      to: link.to === source.id ? target.id : link.to,
    };
    const existing = [...remaining, ...addedLinks];
    if (existing.some((edge) => pairKey(edge.from, edge.to) === pairKey(candidate.from, candidate.to))) continue;
    const refusal = linkRefusalReason(candidate.from, candidate.to, candidate.kind, existing, notes);
    if (refusal) return { ok: false, reason: refusal };
    addedLinks.push(candidate);
  }
  return { ok: true, plan: { ...valueChange, removedLinks, addedLinks } };
}

function appendUnique<T>(target: readonly T[], source: readonly T[]): T[] {
  const values = [...target];
  for (const value of source) if (!values.includes(value)) values.push(value);
  return values;
}
