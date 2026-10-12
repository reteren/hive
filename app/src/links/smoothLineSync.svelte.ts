import { onBoardMutation } from "../model/board.svelte";
import { links, onLinksMutation } from "../model/links.svelte";
import { hasMeBeacon } from "../beacons/beaconState.svelte";
import { queueFullSmoothLineReflow, queueSmoothLineReflow } from "./smoothLines";

let started = false;
const knownEndpoints = new Map<string, readonly [string, string]>();

/** Reflow only smooth anchors incident to changed objects or link endpoints. */
export function startSmoothLineSync(): void {
  if (started) return;
  started = true;
  refreshKnownEndpoints();

  onBoardMutation((ids) => {
    if (ids === null) queueFullSmoothLineReflow();
    else queueSmoothLineReflow(ids);
  });

  onLinksMutation((ids, topologyChanged) => {
    if (!topologyChanged) return;
    if (ids === null) {
      refreshKnownEndpoints();
      queueFullSmoothLineReflow();
      return;
    }
    const changedObjects = new Set<string>();
    for (const id of ids) {
      const previous = knownEndpoints.get(id);
      if (previous) for (const endpoint of previous) changedObjects.add(endpoint);
      const link = links.byId[id];
      if (link) {
        knownEndpoints.set(id, [link.from, link.to]);
        changedObjects.add(link.from);
        changedObjects.add(link.to);
      } else {
        knownEndpoints.delete(id);
      }
    }
    queueSmoothLineReflow([...changedObjects]);
  });

  $effect.root(() => {
    $effect(() => {
      hasMeBeacon();
      queueSmoothLineReflow(["me"]);
    });
  });

  queueFullSmoothLineReflow();
}

function refreshKnownEndpoints(): void {
  knownEndpoints.clear();
  for (const link of Object.values(links.byId)) knownEndpoints.set(link.id, [link.from, link.to]);
}
