import { ME_OBJECT_ID } from "../model/link";
import type { NodeScope } from "../model/nodeData";
import type { Note } from "../model/note";

/** Minimal read-only inputs for resolving a scope; kept injectable for pure tests. */
export interface ScopeSources {
  notes: Readonly<Record<string, Note | undefined>>;
  zones: Readonly<Record<string, unknown>>;
  zoneMembers(zoneId: string): readonly string[];
  beaconDescendants(beaconId: string): ReadonlySet<string>;
}

export function scopeExistsIn(scope: NodeScope, sources: ScopeSources): boolean {
  if (scope.kind === "board") return true;
  if (scope.kind === "zone") return sources.zones[scope.id] !== undefined;
  return scope.id === ME_OBJECT_ID || sources.notes[scope.id]?.type === "beacon";
}

/** Resolve a scope to distinct, existing board note IDs. Missing scopes count nothing. */
export function resolveScopeIn(scope: NodeScope, sources: ScopeSources): Set<string> {
  if (!scopeExistsIn(scope, sources)) return new Set();

  const candidates = scope.kind === "board"
    ? Object.keys(sources.notes)
    : scope.kind === "zone"
      ? sources.zoneMembers(scope.id)
      : sources.beaconDescendants(scope.id);

  return new Set([...candidates].filter((id) => sources.notes[id] !== undefined));
}

export function scopeKey(scope: NodeScope): string {
  return scope.kind === "board" ? "board" : `${scope.kind}:${scope.id}`;
}

export function sameScope(left: NodeScope | undefined, right: NodeScope): boolean {
  if (!left || left.kind !== right.kind) return false;
  if (right.kind === "board") return true;
  if (left.kind === "board") return false;
  return left.id === right.id;
}

export function defaultScopeForZone(zoneId: string | null): NodeScope {
  return zoneId ? { kind: "zone", id: zoneId } : { kind: "board" };
}
