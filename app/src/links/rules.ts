import { board } from "../model/board.svelte";
import { ME_OBJECT_ID, pairKey, type Link } from "../model/link";
import { hasMeBeacon } from "../beacons/beaconState.svelte";
import type { ModuleEdge, ModuleNoteLookup, ModuleNoteValue } from "../modules/moduleLogic";

export type LinkKind = Link["kind"];
export type ExistingLink = Pick<Link, "from" | "to"> & Partial<Pick<Link, "kind">>;

/** Module links always carry their effect, even when the dashed-line tool is active. */
export function effectiveLinkKind(
  from: string,
  to: string,
  requested: LinkKind,
  notes: ModuleNoteLookup = board.notes,
): LinkKind {
  return requested === "weak" && (isModule(notes[from]) || isModule(notes[to]))
    ? "strong"
    : requested;
}

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
  if ((from === ME_OBJECT_ID || to === ME_OBJECT_ID) && !hasMeBeacon()) return "ME beacon has been deleted.";
  if (from === to) return "An object cannot link to itself.";
  const source = notes[from];
  const target = notes[to];
  const sourceIsBeacon = from === ME_OBJECT_ID || source?.type === "beacon";
  const targetIsBeacon = to === ME_OBJECT_ID || target?.type === "beacon";
  const sourceIsModule = isModule(source);
  const targetIsModule = isModule(target);
  const actualKind = effectiveLinkKind(from, to, kind, notes);
  if (sourceIsBeacon && targetIsBeacon) return "Beacons cannot link to other beacons.";
  const isProgressBeaconScopeLink =
    to !== ME_OBJECT_ID && target?.type === "beacon" && actualKind === "strong" &&
    (source?.type === "progress" || source?.type === "stats");
  if (targetIsBeacon && !isProgressBeaconScopeLink) return "Beacons can have outgoing links only.";
  if (existing.some((link) => pairKey(link.from, link.to) === pairKey(from, to))) {
    return "These objects already have a link.";
  }

  if (isProgressBeaconScopeLink) return null;
  if (target?.type === "tierlist" && actualKind === "strong") {
    if (source?.type === "progress") return "Progress nodes cannot link strongly to Tierlists.";
    if (source?.type === "stats") return null;
  }

  if (target?.type === "calculator") {
    if (sourceIsBeacon && actualKind === "strong") return "Beacons cannot fund calculators.";
    return null;
  }

  if (sourceIsBeacon || (!sourceIsModule && !targetIsModule)) return null;
  if (sourceIsModule && targetIsModule) return "Module nodes link only to notes, pluses, or minuses.";

  const module = sourceIsModule ? source : target;
  const content = sourceIsModule ? target : source;
  const allowedMessageModule = content?.type === "message" && (module?.type === "importance" || module?.type === "markas");
  if (!allowedMessageModule && !isContentNote(content)) return "Module nodes link only to notes, pluses, or minuses (Importance and Mark as also link to Message).";
  if (module?.type === "markas") return sourceIsModule ? null : "Mark as links must point outward to a note or Message.";
  if (module?.type !== "importance" || actualKind !== "strong") return null;

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
  return note?.type === "importance" || note?.type === "purpose" || note?.type === "mood" || note?.type === "markas";
}

function isContentNote(note: ModuleNoteLookup[string]): note is ModuleNoteValue {
  return note?.type === "note" || note?.type === "pro" || note?.type === "con";
}

export function moduleEdges(links: readonly ExistingLink[]): ModuleEdge[] {
  return links.flatMap((link) => link.kind
    ? [{ from: link.from, to: link.to, kind: link.kind }]
    : [{ from: link.from, to: link.to, kind: "strong" as const }]);
}
