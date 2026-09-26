import { board } from "../model/board.svelte";
import { ME_OBJECT_ID } from "../model/link";
import type { NodeScope } from "../model/nodeData";
import type { Note } from "../model/note";
import { zones } from "../model/zones.svelte";
import { beaconDescendants } from "../beacons/coverage";
import { zoneMembers, zoneOf } from "../zones/membership.svelte";
import { resolveScopeIn, scopeExistsIn, defaultScopeForZone } from "./scopeLogic";

export interface ScopeOption {
  scope: NodeScope;
  label: string;
}

function currentSources() {
  return {
    notes: board.notes,
    zones: zones.byId,
    zoneMembers,
    beaconDescendants,
  };
}

/** Board, zone, and beacon membership; beacon scope intentionally matches beacon focus. */
export function resolveScope(scope: NodeScope): Set<string> {
  return resolveScopeIn(scope, currentSources());
}

export function scopeExists(scope: NodeScope): boolean {
  return scopeExistsIn(scope, currentSources());
}

/** Nodes without an explicit choice lazily follow their current zone, or use the board. */
export function scopeForNote(note: Pick<Note, "id" | "scope">): NodeScope {
  return note.scope ?? defaultScopeForZone(zoneOf(note.id));
}

export function scopeOptions(): ScopeOption[] {
  const zoneOptions: ScopeOption[] = Object.values(zones.byId).map((zone) => ({
    scope: { kind: "zone", id: zone.id },
    label: `Zone: ${zone.name}`,
  }));
  const beaconIds = [ME_OBJECT_ID, ...board.order.filter((id) => board.notes[id]?.type === "beacon")];
  const beaconOptions = beaconIds.flatMap((id): ScopeOption[] => {
    const name = id === ME_OBJECT_ID ? "ME" : board.notes[id]?.name;
    return name ? [{ scope: { kind: "beacon", id }, label: `Beacon: ${name}` }] : [];
  });

  return [
    { scope: { kind: "board" }, label: "Board" },
    ...zoneOptions.sort(compareOptions),
    ...beaconOptions.sort(compareOptions),
  ];
}

function compareOptions(left: ScopeOption, right: ScopeOption): number {
  return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
}
