import { beforeEach, describe, expect, it } from "vitest";
import { clear, history, redo, undo } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import { zones, replaceZones } from "../src/model/zones.svelte";
import { selection, selectZonesOnly } from "../src/selection/selection.svelte";
import { createZone, deleteZone, recolorZone, renameZone, ZONE_COLORS } from "../src/zones/commands";
import { getCommand } from "../src/commands/registry.svelte";
import { leaveShapeEdit, shapeEdit } from "../src/zones/shapeEdit.svelte";

describe("zone commands", () => {
  beforeEach(() => {
    leaveShapeEdit();
    clear();
    replaceZones([]);
    replaceBoard([]);
    selection.ids = [];
    selection.zoneIds = [];
    selection.primaryId = null;
  });

  it("creates unique names and rotating colours as individual Undo steps", () => {
    const first = createZone({ x: 0, y: 0, width: 30, height: 30 });
    const second = createZone({ x: 30, y: 0, width: 30, height: 30 });
    expect(first?.name).toBe("Zone");
    expect(second?.name).toBe("Zone 2");
    expect(first?.color).toBe(ZONE_COLORS[0]);
    expect(second?.color).toBe(ZONE_COLORS[1]);
    expect(history.entries.map((entry) => entry.label)).toEqual(["Create zone", "Create zone"]);
    undo();
    expect(zones.byId[second!.id]).toBeUndefined();
    redo();
    expect(zones.byId[second!.id]).toBeDefined();
  });

  it("refuses tiny and overlapping rectangles without creating history", () => {
    createZone({ x: 0, y: 0, width: 30, height: 30 });
    expect(createZone({ x: 10, y: 2, width: 1, height: 8 })).toBeNull();
    expect(createZone({ x: 29, y: 2, width: 30, height: 30 })).toBeNull();
    expect(history.entries).toHaveLength(1);
  });

  it("renames, recolours and deletes only the zone with reversible commands", () => {
    replaceBoard([{ id: "note", name: "Note", type: "note", text: "content", x: 1, y: 1, width: 3, height: 3 }]);
    const created = createZone({ x: 0, y: 0, width: 30, height: 30 })!;
    expect(renameZone(created.id, "Work")).toBe(true);
    expect(recolorZone(created.id, "#123456")).toBe(true);
    expect(deleteZone(created.id)).toBe(true);
    expect(board.notes.note?.text).toBe("content");
    expect(zones.byId[created.id]).toBeUndefined();
    expect(history.entries.map((entry) => entry.label)).toEqual(["Create zone", "Rename zone", "Zone colour", "Delete zone"]);
    undo();
    expect(zones.byId[created.id]?.name).toBe("Work");
    expect(zones.byId[created.id]?.color).toBe("#123456");
    undo();
    expect(zones.byId[created.id]?.color).toBe(ZONE_COLORS[0]);
    undo();
    expect(zones.byId[created.id]?.name).toBe("Zone");
  });

  it("enters shape editing with E only when exactly one zone is selected", () => {
    const created = createZone({ x: 0, y: 0, width: 120, height: 120 })!;
    const command = getCommand("zone.editShape");
    expect(command?.keys).toEqual(["KeyE"]);

    selectZonesOnly([created.id]);
    command?.run();
    expect(shapeEdit.zoneId).toBe(created.id);
    leaveShapeEdit();

    selectZonesOnly([created.id]);
    selection.ids = ["note"];
    command?.run();
    expect(shapeEdit.zoneId).toBeNull();
  });
});
