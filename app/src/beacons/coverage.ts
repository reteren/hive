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
  return descendants;
}
