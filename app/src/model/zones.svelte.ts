import type { Zone } from "./zone";

/** Zones of the open board. Raw mutations: user-facing changes go through history commands. */
export const zones = $state({
  byId: {} as Record<string, Zone>,
  /** Paint order, bottom to top. */
  order: [] as string[],
});

const mutationListeners = new Set<(ids: readonly string[] | null, geometryChanged: boolean) => void>();
let revision = 0;

/** Subscribe to zone changes; listeners should only record dirty IDs and schedule work. */
export function onZonesMutation(listener: (ids: readonly string[] | null, geometryChanged: boolean) => void): () => void {
  mutationListeners.add(listener);
  return () => mutationListeners.delete(listener);
}

function notifyZonesMutation(ids: readonly string[] | null, geometryChanged: boolean): void {
  revision += 1;
  for (const listener of mutationListeners) listener(ids, geometryChanged);
}

/** Non-reactive revision for cheap autosave dirty checks. */
export function zonesRevision(): number {
  return revision;
}

export function addZone(zone: Zone, index = zones.order.length): void {
  zones.byId[zone.id] = zone;
  zones.order.splice(index, 0, zone.id);
  notifyZonesMutation([zone.id], true);
}

export function removeZone(id: string): Zone | undefined {
  const zone = zones.byId[id];
  if (!zone) return undefined;
  delete zones.byId[id];
  const index = zones.order.indexOf(id);
  if (index !== -1) zones.order.splice(index, 1);
  notifyZonesMutation([id], true);
  return zone;
}

export function updateZone(id: string, patch: Partial<Omit<Zone, "id">>): void {
  const zone = zones.byId[id];
  if (zone) {
    Object.assign(zone, patch);
    notifyZonesMutation([id], "parts" in patch || "holes" in patch);
  }
}

export function replaceZones(next: Zone[]): void {
  zones.byId = Object.fromEntries(next.map((zone) => [zone.id, zone]));
  zones.order = next.map((zone) => zone.id);
  notifyZonesMutation(null, true);
}
