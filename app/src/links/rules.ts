import { board } from "../model/board.svelte";
import { ME_OBJECT_ID, pairKey, type Link } from "../model/link";
import type { ModuleEdge, ModuleNoteLookup, ModuleNoteValue } from "../modules/moduleLogic";

export type LinkKind = Link["kind"];
export type ExistingLink = Pick<Link, "from" | "to"> & Partial<Pick<Link, "kind">>;

/** Pair occupancy is direction and kind independent; this deliberately permits cycles. */
export function canCreateLinkPair(
  from: string,
  to: string,
  existing: readonly ExistingLink[],
  kind: LinkKind = "strong",
  notes: ModuleNoteLookup = board.notes,
): boolean {
  return linkRefusalReason(from, to, kind, existing, notes) === null;
}

/** Explain why a proposed link is refused; module rules live here with pair rules. */
export function linkRefusalReason(
  from: string,
  to: string,
  kind: LinkKind,
  existing: readonly ExistingLink[],
  notes: ModuleNoteLookup = board.notes,
): string | null {
  if (from === to) return "An object cannot link to itself.";
  const source = notes[from];
  const target = notes[to];
  const sourceIsModule = isModule(source);
  const targetIsModule = isModule(target);
  if ((sourceIsModule || targetIsModule) && kind !== "strong") {
    return "Importance and Purpose modules require strong links.";
  }
  if (to === ME_OBJECT_ID) return "Beacons can have outgoing links only.";
  if (existing.some((link) => pairKey(link.from, link.to) === pairKey(from, to))) {
    return "These objects already have a link.";
  }

  if (!sourceIsModule && !targetIsModule) return null;
  if (sourceIsModule && targetIsModule) return "Module nodes link only to notes, pluses, or minuses.";

  const module = sourceIsModule ? source : target;
  const content = sourceIsModule ? target : source;
  if (!isContentNote(content)) return "Module nodes link only to notes, pluses, or minuses.";
  if (module?.type !== "importance" || kind !== "strong") return null;

  if (content.importance) return "This note already has an Importance source.";
  const occupiedByExternalImportance = existing.some((link) => {
    if ((link.kind ?? "strong") !== "strong") return false;
    const otherId = link.from === content.id ? link.to : link.to === content.id ? link.from : null;
    if (!otherId || otherId === module.id) return false;
    const linkedModule = notes[otherId];
    return linkedModule?.type === "importance" && Boolean(linkedModule.importance);
  });
  return occupiedByExternalImportance ? "This note already has an Importance source." : null;
}

function isModule(note: ModuleNoteLookup[string]): boolean {
  return note?.type === "importance" || note?.type === "purpose";
}

function isContentNote(note: ModuleNoteLookup[string]): note is ModuleNoteValue {
  return note?.type === "note" || note?.type === "pro" || note?.type === "con";
}

export function moduleEdges(links: readonly ExistingLink[]): ModuleEdge[] {
  return links.flatMap((link) => link.kind
    ? [{ from: link.from, to: link.to, kind: link.kind }]
    : [{ from: link.from, to: link.to, kind: "strong" as const }]);
}
