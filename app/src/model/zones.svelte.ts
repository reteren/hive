import type { Zone } from "./zone";

/** Zones of the open board. Raw mutations: user-facing changes go through history commands. */
export const zones = $state({
  byId: {} as Record<string, Zone>,
  /** Paint order, bottom to top. */
  order: [] as string[],
});

export function addZone(zone: Zone, index = zones.order.length): void {
  zones.byId[zone.id] = zone;
  zones.order.splice(index, 0, zone.id);
}

export function removeZone(id: string): Zone | undefined {
  const zone = zones.byId[id];
  if (!zone) return undefined;
  delete zones.byId[id];
  const index = zones.order.indexOf(id);
  if (index !== -1) zones.order.splice(index, 1);
  return zone;
}

export function updateZone(id: string, patch: Partial<Omit<Zone, "id">>): void {
  const zone = zones.byId[id];
  if (zone) Object.assign(zone, patch);
}

export function replaceZones(next: Zone[]): void {
  zones.byId = Object.fromEntries(next.map((zone) => [zone.id, zone]));
  zones.order = next.map((zone) => zone.id);
}
