import { board } from "../model/board.svelte";
import { linksOf } from "../model/links.svelte";
import { ME_OBJECT_ID } from "../model/link";
import type { NodeScope } from "../model/nodeData";
import type { Note } from "../model/note";
import { zones } from "../model/zones.svelte";
import { beaconDescendants } from "../beacons/coverage";
import { hasMeBeacon } from "../beacons/beaconState.svelte";
import { zoneMembers } from "../zones/membership.svelte";
import { effectiveScope, resolveScopeIn, scopeExistsIn, type ScopeSources } from "./scopeLogic";
import { reactiveLinkRevisionFor } from "./scopeRevision.svelte";
import { t } from "../i18n/i18n.svelte";

export interface ScopeOption {
  scope: NodeScope;
  label: string;
}

function currentSources(): ScopeSources {
  return {
    notes: board.notes,
    zones: zones.byId,
    zoneMembers,
    beaconDescendants,
    mePresent: hasMeBeacon(),
  };
}

/** Board, zone, and beacon membership; beacon scope intentionally matches beacon focus. */
export function resolveScope(scope: NodeScope): Set<string> {
  return resolveScopeIn(scope, currentSources());
}

export function scopeExists(scope: NodeScope): boolean {
  return scopeExistsIn(scope, currentSources());
}

/** Most recently inserted strong link to an actual beacon overrides a progress/statistics scope. */
export function linkedBeaconForNote(noteId: string): { id: string; name: string; scope: NodeScope } | null {
  void reactiveLinkRevisionFor(noteId);
  const note = board.notes[noteId];
  if (note?.type !== "progress" && note?.type !== "stats") return null;

  const linkedIds = linksOf(noteId)
    .filter((link) => link.from === noteId && link.kind === "strong" && board.notes[link.to]?.type === "beacon")
    .map((link) => link.to);
  // Link records retain insertion order, so the last matching live link is the newest choice.
  const beaconId = linkedIds.at(-1);
  const beacon = beaconId ? board.notes[beaconId] : undefined;
  return beaconId && beacon?.type === "beacon"
    ? { id: beaconId, name: beacon.name, scope: { kind: "beacon", id: beaconId } }
    : null;
}

/** Scope choice stored on a node; absent scope behaves as Auto. */
export function scopeChoiceForNote(note: Pick<Note, "scope">): NodeScope {
  return note.scope ?? { kind: "auto" };
}

/** Effective scope for calculations: linked beacon, stored choice, or current zone/board for Auto. */
export function scopeForNote(note: Pick<Note, "id" | "scope">): NodeScope {
  const currentNote = board.notes[note.id];
  return linkedBeaconForNote(note.id)?.scope ?? effectiveScope(note.scope, currentNote?.zoneId ?? null);
}

export function scopeOptions(): ScopeOption[] {
  const zoneOptions: ScopeOption[] = Object.values(zones.byId).map((zone) => ({
    scope: { kind: "zone", id: zone.id },
    label: t("Zone: {name}", { name: zone.name }),
  }));
  const beaconIds = [...(hasMeBeacon() ? [ME_OBJECT_ID] : []), ...board.order.filter((id) => board.notes[id]?.type === "beacon")];
  const beaconOptions = beaconIds.flatMap((id): ScopeOption[] => {
    const name = id === ME_OBJECT_ID ? "ME" : board.notes[id]?.name;
    return name ? [{ scope: { kind: "beacon", id }, label: t("Beacon: {name}", { name: name }) }] : [];
  });

  return [
    { scope: { kind: "auto" }, label: t("Auto (under this node)") },
    { scope: { kind: "board" }, label: t("Board") },
    ...zoneOptions.sort(compareOptions),
    ...beaconOptions.sort(compareOptions),
  ];
}

function compareOptions(left: ScopeOption, right: ScopeOption): number {
  return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
}
