import { describe, expect, it } from "vitest";
import { findNonOverlappingZoneOffset, parseNotesPayload, serializeNotes, zonesOverlap } from "../src/clipboard/payload";
import { rectContour, zoneNameEdge, type Zone } from "../src/model/zone";
import { parseProjectIndexWithWarnings, serializeProjectIndex } from "../src/project/index";
import { hitTestZones, zonesTouchingMarquee } from "../src/selection/hitTesting";
import { chooseZoneForBounds } from "../src/zones/membership.svelte";
import { rectangleOverlapsZones, zoneAreaInRect, zoneCreationPreview } from "../src/zones/geometry";
import { createZoneMoveGesture, createZoneResizeGesture, updateZoneMoveGesture, updateZoneResizeGesture } from "../src/zones/zoneGestures";

function zone(id: string, parts: Zone["parts"], holes: Zone["holes"] = []): Zone {
  return { id, name: id, color: "#608ac1", parts, holes };
}

const lShape = zone("L", [[
  { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 5 },
  { x: 5, y: 5 }, { x: 5, y: 30 }, { x: 0, y: 30 },
]]);

describe("complex zones across board operations", () => {
  it("uses occupied area for membership and creation instead of the bounding box", () => {
    const emptyCorner = { x: 10, y: 10, width: 4, height: 4 };
    const other = zone("other", [rectContour(10, 10, 4, 4)]);
    expect(zoneAreaInRect(lShape, emptyCorner)).toBe(0);
    expect(chooseZoneForBounds(emptyCorner, [lShape, other])).toBe("other");
    expect(rectangleOverlapsZones(emptyCorner, [lShape])).toBe(false);
    expect(zoneCreationPreview({ x: 10, y: 10 }, { x: 40, y: 40 }, [lShape], 4).blocked).toBe(false);
  });

  it("moves and resizes into empty space inside a complex zone's bounds, then stops at its contour", () => {
    const source = zone("source", [rectContour(12, 12, 4, 4)]);
    const move = createZoneMoveGesture(source, [lShape], [], { x: 0, y: 0 });
    const free = updateZoneMoveGesture(move, { x: 8, y: 0 }, false, 10);
    const blocked = updateZoneMoveGesture(move, { x: -20, y: 0 }, false, 10);
    expect(free.afterZone.parts[0][0].x).toBe(20);
    expect(free.blocked).toBe(false);
    expect(blocked.afterZone.parts[0][0].x).toBe(5);
    expect(blocked.blocked).toBe(true);
    expect(zonesOverlap(blocked.afterZone, lShape)).toBe(false);

    const resize = createZoneResizeGesture(source, [lShape], "left", { x: 0, y: 0 });
    const expanded = updateZoneResizeGesture(resize, { x: -20, y: 0 }, false, 10);
    expect(expanded.afterZone.parts[0][0].x).toBe(5);
    expect(expanded.blocked).toBe(true);
    expect(zonesOverlap(expanded.afterZone, lShape)).toBe(false);
  });

  it("keeps holes and parts through clipboard and board.json without needless paste displacement", () => {
    const complex = zone("complex", [rectContour(0, 0, 60, 60), rectContour(80, 0, 30, 30)], [rectContour(15, 15, 30, 30)]);
    const inHole = zone("in-hole", [rectContour(20, 20, 5, 5)]);
    expect(zonesOverlap(complex, inHole)).toBe(false);
    expect(findNonOverlappingZoneOffset([inHole], [complex])).toEqual({ x: 0, y: 0 });
    expect(parseNotesPayload(serializeNotes([], [], [complex]))?.zones[0]).toMatchObject({
      sourceId: complex.id, parts: complex.parts, holes: complex.holes,
    });

    const loaded = parseProjectIndexWithWarnings(serializeProjectIndex([], undefined, [], [], [complex]));
    expect(loaded.index.zones).toEqual([complex]);
    expect(loaded.warnings).toEqual([]);
    expect(zoneNameEdge(complex)).toEqual({ x: 0, y: 0, width: 60 });
  });

  it("does not select through a hole or the gap between parts", () => {
    const complex = zone("complex", [rectContour(0, 0, 60, 60), rectContour(80, 0, 30, 30)], [rectContour(15, 15, 30, 30)]);
    const byId = { complex };
    expect(hitTestZones({ x: 20, y: 20 }, byId, ["complex"])).toBeNull();
    expect(hitTestZones({ x: 65, y: 10 }, byId, ["complex"])).toBeNull();
    expect(hitTestZones({ x: 85, y: 10 }, byId, ["complex"])).toBe("complex");
    expect(zonesTouchingMarquee({ x: 20, y: 20, width: 5, height: 5 }, byId, ["complex"])).toEqual([]);
    expect(zonesTouchingMarquee({ x: 65, y: 10, width: 5, height: 5 }, byId, ["complex"])).toEqual([]);
    expect(zonesTouchingMarquee({ x: 85, y: 10, width: 5, height: 5 }, byId, ["complex"])).toEqual(["complex"]);
  });

  it("drops a diagonal or undersized contour from board.json with a warning", () => {
    const base = JSON.parse(serializeProjectIndex([], undefined, [], [], [zone("bad", [rectContour(0, 0, 30, 30)])]));
    base.zones[0].parts = [[{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 20, y: 30 }, { x: 0, y: 30 }]];
    const diagonal = parseProjectIndexWithWarnings(JSON.stringify(base));
    expect(diagonal.index.zones).toEqual([]);
    expect(diagonal.warnings.join(" ")).toMatch(/Invalid zones/);

    base.zones[0].parts = [[{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 30 }]];
    const triangle = parseProjectIndexWithWarnings(JSON.stringify(base));
    expect(triangle.index.zones).toEqual([]);
  });
});
