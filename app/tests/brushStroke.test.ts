import { beforeEach, describe, expect, it } from "vitest";
import { rectContour, type Zone } from "../src/model/zone";
import { replaceZones, zones } from "../src/model/zones.svelte";
import { brushRectangleShape, createBrushHistoryCommand, resolvePaintTarget, type CompletedBrushGesture } from "../src/zones/brushStroke.svelte";
import { shapeArea, type ZoneShape } from "../src/zones/shape";

function zone(id: string, x: number, y: number, width: number, height: number): Zone {
  return { id, name: id.toUpperCase(), color: "#608ac1", parts: [rectContour(x, y, width, height)], holes: [] };
}

function stroke(mode: "paint" | "erase", shape: ZoneShape, targetZoneId: string | null = null): CompletedBrushGesture {
  return { mode, rectangle: false, targetZoneId, shape };
}

describe("zone brush stroke state and history", () => {
  beforeEach(() => replaceZones([]));

  it("resolves a paint start to the topmost zone containing the point", () => {
    replaceZones([zone("lower", 0, 0, 100, 100), zone("upper", 25, 25, 50, 50)]);
    const entries = zones.order.map((id) => ({ id, shape: { parts: zones.byId[id].parts, holes: zones.byId[id].holes } }));
    expect(resolvePaintTarget({ x: 50, y: 50 }, entries)).toBe("upper");
    expect(resolvePaintTarget({ x: 10, y: 10 }, entries)).toBe("lower");
    expect(resolvePaintTarget({ x: 150, y: 150 }, entries)).toBeNull();
  });

  it("snaps Ctrl-drag rectangle bounds to 10u and expands it to the 20u minimum", () => {
    expect(brushRectangleShape({ x: 13, y: 21 }, { x: 57, y: 66 })).toEqual({
      parts: [rectContour(10, 20, 50, 50)],
      holes: [],
    });
    expect(brushRectangleShape({ x: 13, y: 21 }, { x: 12, y: 20 })).toEqual({
      parts: [rectContour(-10, 0, 20, 20)],
      holes: [],
    });
  });

  it("creates a paint command for a new zone and restores it through undo", () => {
    const command = createBrushHistoryCommand(stroke("paint", { parts: [rectContour(0, 0, 40, 40)], holes: [] }));
    expect(command?.label).toBe("Paint zone");
    expect(command?.target).toBe("Zone");
    command?.do();
    expect(zones.order).toHaveLength(1);
    expect(shapeArea(zones.byId[zones.order[0]])).toBe(1_600);
    command?.undo();
    expect(zones.order).toEqual([]);
  });

  it("extends the zone selected at stroke start as one undoable command", () => {
    replaceZones([zone("one", 0, 0, 100, 100)]);
    const command = createBrushHistoryCommand(stroke("paint", { parts: [rectContour(90, 10, 20, 20)], holes: [] }, "one"));
    expect(command?.label).toBe("Paint zone");
    command?.do();
    expect(shapeArea(zones.byId.one)).toBe(10_200);
    command?.undo();
    expect(shapeArea(zones.byId.one)).toBe(10_000);
  });

  it("erases multiple regions in one command and undo restores geometry and order", () => {
    replaceZones([zone("a", 0, 0, 100, 100), zone("b", 120, 0, 100, 100)]);
    const command = createBrushHistoryCommand(stroke("erase", { parts: [rectContour(0, 0, 220, 100)], holes: [] }));
    expect(command?.label).toBe("Erase zone");
    command?.do();
    expect(zones.order).toEqual([]);
    command?.undo();
    expect(zones.order).toEqual(["a", "b"]);
    expect(shapeArea(zones.byId.a)).toBe(10_000);
    expect(shapeArea(zones.byId.b)).toBe(10_000);
  });

  it("keeps one split zone identity and restores its shape on undo", () => {
    replaceZones([zone("one", 0, 0, 100, 100)]);
    const command = createBrushHistoryCommand(stroke("erase", { parts: [rectContour(40, 0, 20, 100)], holes: [] }));
    command?.do();
    expect(zones.order).toEqual(["one"]);
    expect(zones.byId.one.parts).toHaveLength(2);
    command?.undo();
    expect(zones.byId.one.parts).toHaveLength(1);
    expect(shapeArea(zones.byId.one)).toBe(10_000);
  });
});
