import { board } from "../model/board.svelte";
import { ME_OBJECT_ID } from "../model/link";
import { links } from "../model/links.svelte";

/** Every board object reachable through strong outgoing links, counted once. */
export function beaconDescendants(beaconId: string): Set<string> {
  if (beaconId !== ME_OBJECT_ID && board.notes[beaconId]?.type !== "beacon") return new Set();

  const outgoing = new Map<string, string[]>();
  for (const link of Object.values(links.byId)) {
    if (link.kind !== "strong" || !board.notes[link.to]) continue;
    const targets = outgoing.get(link.from) ?? [];
    targets.push(link.to);
    outgoing.set(link.from, targets);
  }

  const descendants = new Set<string>();
  const pending = [...outgoing.get(beaconId) ?? []];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (id === beaconId || descendants.has(id)) continue;
    descendants.add(id);
    pending.push(...outgoing.get(id) ?? []);
  }
  return includeNetworkModules(descendants, outgoing);
}

/**
 * Include an external module only when every strong target it feeds is already in the network.
 * This lets a module chain back into the network without exposing modules that also feed an
 * unrelated object. A queue propagates newly included modules through their upstream modules.
 */
function includeNetworkModules(
  network: Set<string>,
  outgoing: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const modules = Object.values(board.notes).filter((note) => isModule(note.type));
  const remainingTargets = new Map<string, Set<string>>();
  const modulesByTarget = new Map<string, string[]>();

  for (const module of modules) {
    const targets = new Set(outgoing.get(module.id) ?? []);
    if (targets.size === 0) continue;
    remainingTargets.set(module.id, new Set([...targets].filter((target) => !network.has(target))));
    for (const target of targets) {
      const feeders = modulesByTarget.get(target) ?? [];
      feeders.push(module.id);
      modulesByTarget.set(target, feeders);
    }
  }

  const pending = modules.flatMap((module) => {
    const missing = remainingTargets.get(module.id);
    return missing?.size === 0 && !network.has(module.id) ? [module.id] : [];
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
