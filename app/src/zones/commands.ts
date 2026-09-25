import type { ZoneBounds } from "../model/zone";
import { rectContour, type Zone } from "../model/zone";
import { zones, addZone, removeZone, updateZone } from "../model/zones.svelte";
import { newId } from "../model/note";
import { execute } from "../history/history.svelte";
import { registerCommand } from "../commands/registry.svelte";
import { tool } from "../tools/tool.svelte";
import { uniqueName } from "../notes/naming";
import { MIN_ZONE_SIZE, rectangleOverlapsZones } from "./geometry";

export const ZONE_COLORS = ["#608ac1", "#a882c2", "#72a98b", "#c59965", "#b87582", "#73a9b6"] as const;

export function createZone(rect: ZoneBounds): Zone | null {
  if (rect.width < MIN_ZONE_SIZE || rect.height < MIN_ZONE_SIZE || rectangleOverlapsZones(rect, Object.values(zones.byId))) return null;
  const zone: Zone = {
    id: newId(),
    name: uniqueName("Zone", Object.values(zones.byId).map((existing) => existing.name)),
    color: ZONE_COLORS[zones.order.length % ZONE_COLORS.length],
    parts: [rectContour(rect.x, rect.y, rect.width, rect.height)],
    holes: [],
    createdAt: Date.now(),
  };
  execute({
    label: "Create zone",
    target: zone.name,
    do: () => addZone(zone),
    undo: () => { removeZone(zone.id); },
  });
  return zone;
}

export function renameZone(id: string, proposed: string): boolean {
  const zone = zones.byId[id];
  if (!zone) return false;
  const next = uniqueName(proposed, Object.values(zones.byId).filter((other) => other.id !== id).map((other) => other.name));
  if (next === zone.name) return false;
  const before = zone.name;
  execute({ label: "Rename zone", target: next, do: () => updateZone(id, { name: next }), undo: () => updateZone(id, { name: before }) });
  return true;
}

export function recolorZone(id: string, color: string): boolean {
  const zone = zones.byId[id];
  if (!zone || !/^#[0-9a-f]{6}$/i.test(color) || zone.color.toLowerCase() === color.toLowerCase()) return false;
  const before = zone.color;
  execute({ label: "Zone colour", target: zone.name, do: () => updateZone(id, { color }), undo: () => updateZone(id, { color: before }) });
  return true;
}

export function deleteZone(id: string): boolean {
  const zone = zones.byId[id];
  if (!zone) return false;
  const index = zones.order.indexOf(id);
  execute({ label: "Delete zone", target: zone.name, do: () => { removeZone(id); }, undo: () => addZone(zone, index) });
  return true;
}

registerCommand({
  id: "tool.zone",
  label: "Zone Tool",
  keys: ["KeyZ"],
  run: () => { tool.active = tool.active === "zone" ? "select" : "zone"; },
  isActive: () => tool.active === "zone",
});
