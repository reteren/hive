import { afterEach, describe, expect, it } from "vitest";
import { clear as clearHistory, history, undo, redo } from "../src/history/history.svelte";
import { replaceZones, zones } from "../src/model/zones.svelte";
import type { Zone } from "../src/model/zone";
import { insertCut } from "../src/zones/contourEdit";
import {
  commitContourEdit,
  cutOutShapeEditArea,
  enterShapeEdit,
  leaveShapeEdit,
  shapeEdit,
} from "../src/zones/shapeEdit.svelte";

function sampleZone(): Zone {
  return {
    id: "zone-test",
    name: "Test zone",
    color: "#608ac1",
    parts: [[
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 120 },
      { x: 0, y: 120 },
    ]],
    holes: [],
    createdAt: 1,
  };
}

afterEach(() => {
  leaveShapeEdit();
  replaceZones([]);
  clearHistory();
});

describe("zone shape edit history", () => {
  it("records an edge cut as one undoable edit, including collinear points", () => {
    replaceZones([sampleZone()]);
    expect(enterShapeEdit("zone-test")).toBe(true);
    const before = shapeEdit.contour!;
    const after = insertCut(before, { ring: 0, edge: 0 }, { x: 60, y: 0 });

    expect(commitContourEdit(before, after, "Cut zone edge")).toBe(true);
    expect(history.cursor).toBe(1);
    expect(shapeEdit.contour?.rings[0].points).toHaveLength(5);

    undo();
    expect(shapeEdit.contour?.rings[0].points).toHaveLength(4);
    redo();
    expect(shapeEdit.contour?.rings[0].points).toHaveLength(5);
  });

  it("cuts out an area as one edit and undo restores the original shape", () => {
    replaceZones([sampleZone()]);
    enterShapeEdit("zone-test");
    shapeEdit.marquee = { x: 40, y: 40, width: 40, height: 40 };

    expect(cutOutShapeEditArea()).toBe(true);
    expect(history.cursor).toBe(1);
    expect(zones.byId["zone-test"]?.holes).toHaveLength(1);

    undo();
    expect(zones.byId["zone-test"]?.holes).toHaveLength(0);
    expect(shapeEdit.zoneId).toBe("zone-test");
  });

  it("deletes an emptied zone in one step and leaves shape edit", () => {
    replaceZones([sampleZone()]);
    enterShapeEdit("zone-test");
    shapeEdit.marquee = { x: -1, y: -1, width: 122, height: 122 };

    expect(cutOutShapeEditArea()).toBe(true);
    expect(zones.byId["zone-test"]).toBeUndefined();
    expect(shapeEdit.zoneId).toBeNull();
    expect(history.entries[0]?.label).toBe("Cut out zone area");

    undo();
    expect(zones.byId["zone-test"]).toBeDefined();
    expect(shapeEdit.zoneId).toBeNull();
  });
});
