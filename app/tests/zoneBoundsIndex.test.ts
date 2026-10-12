import { describe, expect, it } from "vitest";
import { rectContour, type Zone } from "../src/model/zone";
import { addZone, removeZone, replaceZones, updateZone, zonesRevision, onZonesMutation } from "../src/model/zones.svelte";
import { ZoneBoundsIndex } from "../src/zones/zoneBoundsIndex";

function zone(id: string, x: number, y: number, size = 10): Zone {
  return { id, name: id, color: "#456789", parts: [rectContour(x, y, size, size)], holes: [] };
}

describe("zone bounds index", () => {
  it("returns intersecting zone bounds in paint order and updates a moved zone", () => {
    const index = new ZoneBoundsIndex();
    const first = zone("first", 0, 0);
    const second = zone("second", 8, 8);
    index.rebuild([first, second], ["first", "second"]);

    expect(index.query({ x: 9, y: 9, width: 1, height: 1 }).map(({ id }) => id)).toEqual(["first", "second"]);

    const moved = zone("first", 40, 40);
    index.update(moved, 1);
    expect(index.query({ x: 0, y: 0, width: 10, height: 10 }).map(({ id }) => id)).toEqual(["second"]);
    expect(index.query({ x: 40, y: 40, width: 2, height: 2 }).map(({ id }) => id)).toEqual(["first"]);
  });

  it("removes stale bounds", () => {
    const index = new ZoneBoundsIndex();
    index.rebuild([zone("zone", 0, 0)], ["zone"]);
    index.remove("zone");
    expect(index.query({ x: 0, y: 0, width: 10, height: 10 })).toEqual([]);
    expect(index.boundsOf("zone")).toBeUndefined();
  });

  it("publishes synchronous zone revisions and distinguishes geometry changes", () => {
    const changes: Array<{ ids: readonly string[] | null; geometry: boolean }> = [];
    const revision = zonesRevision();
    const unsubscribe = onZonesMutation((ids, geometry) => changes.push({ ids, geometry }));
    addZone(zone("zone", 0, 0));
    updateZone("zone", { color: "#ffffff" });
    updateZone("zone", { parts: [rectContour(1, 1, 10, 10)] });
    removeZone("zone");
    replaceZones([zone("replacement", 2, 2)]);
    unsubscribe();

    expect(changes).toEqual([
      { ids: ["zone"], geometry: true },
      { ids: ["zone"], geometry: false },
      { ids: ["zone"], geometry: true },
      { ids: ["zone"], geometry: true },
      { ids: null, geometry: true },
    ]);
    expect(zonesRevision()).toBe(revision + changes.length);
  });
});
