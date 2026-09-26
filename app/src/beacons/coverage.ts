import { board } from "../model/board.svelte";
import { ME_OBJECT_ID, type Link } from "../model/link";
import type { Note, NoteKind } from "../model/note";
import { links } from "../model/links.svelte";

interface NoteSnapshot {
  note: Note;
  id: string;
  type: NoteKind;
}

interface LinkSnapshot {
  link: Link;
  from: string;
  to: string;
  kind: Link["kind"];
}

interface CoverageGraph {
  notes: NoteSnapshot[];
  links: LinkSnapshot[];
  modules: string[];
  outgoing: Map<string, string[]>;
  descendantsByBeacon: Map<string, Set<string>>;
}

let coverageGraph: CoverageGraph | null = null;

/** Every board object reachable through strong outgoing links, counted once. */
export function beaconDescendants(beaconId: string): Set<string> {
  if (beaconId !== ME_OBJECT_ID && board.notes[beaconId]?.type !== "beacon") return new Set();

  const graph = currentCoverageGraph();
  const cached = graph.descendantsByBeacon.get(beaconId);
  if (cached) return new Set(cached);

  const descendants = new Set<string>();
  const pending = [...graph.outgoing.get(beaconId) ?? []];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (id === beaconId || descendants.has(id)) continue;
    descendants.add(id);
    pending.push(...graph.outgoing.get(id) ?? []);
  }
  const result = includeNetworkModules(descendants, graph.outgoing, graph.modules);
  graph.descendantsByBeacon.set(beaconId, result);
  return new Set(result);
}

function currentCoverageGraph(): CoverageGraph {
  const noteSnapshot = Object.values(board.notes).map((note) => ({ note, id: note.id, type: note.type }));
  const linkSnapshot = Object.values(links.byId).map((link) => ({
    link,
    from: link.from,
    to: link.to,
    kind: link.kind,
  }));
  if (coverageGraph && sameSnapshot(coverageGraph.notes, noteSnapshot) && sameSnapshot(coverageGraph.links, linkSnapshot)) {
    return coverageGraph;
  }

  const noteIds = new Set(noteSnapshot.map(({ id }) => id));
  const outgoing = new Map<string, string[]>();
  for (const { from, to, kind } of linkSnapshot) {
    if (kind !== "strong" || !noteIds.has(to)) continue;
    const targets = outgoing.get(from) ?? [];
    targets.push(to);
    outgoing.set(from, targets);
  }

  coverageGraph = {
    notes: noteSnapshot,
    links: linkSnapshot,
    modules: noteSnapshot.filter(({ type }) => isModule(type)).map(({ id }) => id),
    outgoing,
    descendantsByBeacon: new Map(),
  };
  return coverageGraph;
}

function sameSnapshot(
  previous: readonly NoteSnapshot[],
  current: readonly NoteSnapshot[],
): boolean;
function sameSnapshot(
  previous: readonly LinkSnapshot[],
  current: readonly LinkSnapshot[],
): boolean;
function sameSnapshot(
  previous: readonly (NoteSnapshot | LinkSnapshot)[],
  current: readonly (NoteSnapshot | LinkSnapshot)[],
): boolean {
  if (previous.length !== current.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    const first = previous[index];
    const second = current[index];
    if ("note" in first && "note" in second) {
      if (first.note !== second.note || first.id !== second.id || first.type !== second.type) return false;
    } else if ("link" in first && "link" in second) {
      if (first.link !== second.link || first.from !== second.from || first.to !== second.to || first.kind !== second.kind) return false;
    } else return false;
  }
  return true;
}

/**
 * Include an external module only when every strong target it feeds is already in the network.
 * This lets a module chain back into the network without exposing modules that also feed an
 * unrelated object. A queue propagates newly included modules through their upstream modules.
 */
function includeNetworkModules(
  network: Set<string>,
  outgoing: ReadonlyMap<string, readonly string[]>,
  moduleIds: readonly string[],
): Set<string> {
  const remainingTargets = new Map<string, Set<string>>();
  const modulesByTarget = new Map<string, string[]>();

  for (const moduleId of moduleIds) {
    const targets = new Set(outgoing.get(moduleId) ?? []);
    if (targets.size === 0) continue;
    remainingTargets.set(moduleId, new Set([...targets].filter((target) => !network.has(target))));
    for (const target of targets) {
      const feeders = modulesByTarget.get(target) ?? [];
      feeders.push(moduleId);
      modulesByTarget.set(target, feeders);
    }
  }

  const pending = moduleIds.flatMap((moduleId) => {
    const missing = remainingTargets.get(moduleId);
    return missing?.size === 0 && !network.has(moduleId) ? [moduleId] : [];
  });

  while (pending.length > 0) {
    const id = pending.pop()!;
    if (network.has(id)) continue;
    network.add(id);
    for (const feederId of modulesByTarget.get(id) ?? []) {
      const missing = remainingTargets.get(feederId);
      missing?.delete(id);
      if (missing?.size === 0 && !network.has(feederId)) pending.push(feederId);
    }
  }

  return network;
}

function isModule(type: string): boolean {
  return type === "importance" || type === "purpose" || type === "mood";
}
