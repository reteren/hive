import { ME_OBJECT_ID } from "../model/link";
import type { NodeScope } from "../model/nodeData";
import type { Note } from "../model/note";

/** Minimal read-only inputs for resolving a scope; kept injectable for pure tests. */
export interface ScopeSources {
  notes: Readonly<Record<string, Note | undefined>>;
  zones: Readonly<Record<string, unknown>>;
  zoneMembers(zoneId: string): readonly string[];
  beaconDescendants(beaconId: string): ReadonlySet<string>;
  /** Older pure callers default to the legacy always-present virtual ME beacon. */
  mePresent?: boolean;
}

export function scopeExistsIn(scope: NodeScope, sources: ScopeSources): boolean {
  if (scope.kind === "auto") return true;
  if (scope.kind === "board") return true;
  if (scope.kind === "zone") return sources.zones[scope.id] !== undefined;
  return scope.id === ME_OBJECT_ID ? sources.mePresent !== false : sources.notes[scope.id]?.type === "beacon";
}

/** Resolve a scope to distinct, existing board note IDs. Missing scopes count nothing. */
export function resolveScopeIn(scope: NodeScope, sources: ScopeSources, autoZoneId: string | null = null): Set<string> {
  const resolved = effectiveScope(scope, autoZoneId);
  if (!scopeExistsIn(resolved, sources)) return new Set();

  const candidates = resolved.kind === "board"
    ? Object.keys(sources.notes)
    : resolved.kind === "zone"
      ? sources.zoneMembers(resolved.id)
      : sources.beaconDescendants(resolved.id);

  return new Set([...candidates].filter((id) => sources.notes[id] !== undefined));
}

export function scopeKey(scope: NodeScope): string {
  if (scope.kind === "auto") return "auto";
  return scope.kind === "board" ? "board" : `${scope.kind}:${scope.id}`;
}

export function sameScope(left: NodeScope | undefined, right: NodeScope): boolean {
  if (!left || left.kind !== right.kind) return false;
  if (right.kind === "board" || right.kind === "auto") return true;
  if (left.kind === "zone" && right.kind === "zone") return left.id === right.id;
  if (left.kind === "beacon" && right.kind === "beacon") return left.id === right.id;
  return false;
}

/** Auto follows the node's current zone, falling back to the full board. */
export function effectiveScope(
  scope: NodeScope | undefined,
  zoneId: string | null,
): Exclude<NodeScope, { kind: "auto" }> {
  switch (scope?.kind) {
    case undefined:
    case "auto":
      return defaultScopeForZone(zoneId);
    case "board":
      return { kind: "board" };
    case "zone":
      return { kind: "zone", id: scope.id };
    case "beacon":
      return { kind: "beacon", id: scope.id };
  }
}

export function defaultScopeForZone(zoneId: string | null): Exclude<NodeScope, { kind: "auto" }> {
  return zoneId ? { kind: "zone", id: zoneId } : { kind: "board" };
}
