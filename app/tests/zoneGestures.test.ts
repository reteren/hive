import { describe, expect, it } from "vitest";
import { addNote, board, removeNote } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import { rectContour, zoneBounds, type Zone } from "../src/model/zone";
import { addZone, zones } from "../src/model/zones.svelte";
import { deleteSelection } from "../src/clipboard/commands";
import { clear as clearHistory, history, record, redo, undo } from "../src/history/history.svelte";
import { clearSelection, selection, selectZonesOnly, toggleSelected } from "../src/selection/selection.svelte";
import {
  createZoneMoveGesture,
  createZoneResizeGesture,
  cancelZoneMoveGesture,
  deleteZonesAction,
  updateZoneMoveGesture,
  updateZoneResizeGesture,
  zoneMoveShouldSnap,
  zoneMoveHistoryCommand,
  zoneResizeHistoryCommand,
} from "../src/zones/zoneGestures";

function zone(id: string, x: number, y: number, width: number, height: number): Zone {
  return { id, name: id, color: "#456789", parts: [rectContour(x, y, width, height)], holes: [] };
}

describe("zone move and resize", () => {
  it("never produces positive-area overlap across directions and all eight resize handles", () => {
    const source = zone("a", 0, 0, 4, 4);
    const directions = [-16, -8, 0, 8, 16];
    const edges = ["top-left", "top", "top-right", "right", "bottom-right", "bottom", "bottom-left", "left"] as const;
    for (const obstacleX of directions) for (const obstacleY of directions) {
      const obstacle = zone("b", obstacleX, obstacleY, 4, 4);
      const obstacleBounds = zoneBounds(obstacle);
      // Existing zones never start with positive-area overlap.
      if (overlapByArea(zoneBounds(source), obstacleBounds)) continue;
      const moving = createZoneMoveGesture(source, [obstacle], [], { x: 0, y: 0 });
      for (const dx of directions) for (const dy of directions) {
        const moved = updateZoneMoveGesture(moving, { x: dx, y: dy }, false, 10);
        expect(overlapByArea(zoneBounds(moved.afterZone), obstacleBounds)).toBe(false);
        for (const edge of edges) {
          const resizing = createZoneResizeGesture(source, [obstacle], edge, { x: 0, y: 0 });
          const resized = updateZoneResizeGesture(resizing, { x: dx, y: dy }, false, 10);
          expect(overlapByArea(zoneBounds(resized.afterZone), obstacleBounds)).toBe(false);
        }
      }
    }
  });

  it("carries only members captured when Ctrl is held while moving", () => {
    const moving = zone("a", 0, 0, 4, 4);
    const gesture = createZoneMoveGesture(moving, [], [{ id: "member", x: 1, y: 1 }], { x: 0, y: 0 });
    const first = updateZoneMoveGesture(gesture, { x: 4, y: 0 }, false, 10, true);
    const second = updateZoneMoveGesture(first, { x: 8, y: 0 }, false, 10, true);

    expect(zoneBounds(second.afterZone)).toEqual({ x: 8, y: 0, width: 4, height: 4 });
    expect(second.afterMembers).toEqual([{ id: "member", x: 9, y: 1 }]);
    expect(second.beforeMembers).toEqual([{ id: "member", x: 1, y: 1 }]);
    expect(updateZoneMoveGesture(gesture, { x: 8, y: 0 }, false, 10, false).afterMembers)
      .toEqual([{ id: "member", x: 1, y: 1 }]);
    expect(updateZoneMoveGesture(createZoneMoveGesture(moving, [], [], { x: 0, y: 0 }), { x: 8, y: 0 }, false, 10).afterMembers).toEqual([]);
  });

  it("uses Ctrl+Alt to carry zone members without grid snapping", () => {
    expect(zoneMoveShouldSnap(true, false, false)).toBe(true);
    expect(zoneMoveShouldSnap(false, true, false)).toBe(true);
    expect(zoneMoveShouldSnap(true, true, true)).toBe(false);

    const source = zone("a", 3, 3, 4, 4);
    const gesture = createZoneMoveGesture(source, [], [{ id: "member", x: 4, y: 4 }], { x: 0, y: 0 });
    const moved = updateZoneMoveGesture(gesture, { x: 8, y: 0 }, zoneMoveShouldSnap(true, true, true), 10, true);
    expect(zoneBounds(moved.afterZone)).toMatchObject({ x: 11, y: 3 });
    expect(moved.afterMembers).toEqual([{ id: "member", x: 12, y: 4 }]);
  });

  it("cancels to the original zone and member positions and records a move as one Undo step", () => {
    clearHistory();
    const gesture = createZoneMoveGesture(zone("a", 0, 0, 4, 4), [], [{ id: "member", x: 1, y: 2 }], { x: 0, y: 0 });
    const moved = updateZoneMoveGesture(gesture, { x: 8, y: 5 }, false, 10, true);
    const cancelled = cancelZoneMoveGesture(moved);
    expect(zoneBounds(cancelled.beforeZone)).toMatchObject({ x: 0, y: 0 });
    expect(cancelled.beforeMembers).toEqual([{ id: "member", x: 1, y: 2 }]);

    let currentZone = moved.afterZone;
    let currentMembers = moved.afterMembers;
    const command = zoneMoveHistoryCommand(moved, (nextZone, nextMembers) => {
      currentZone = nextZone;
      currentMembers = [...nextMembers];
    });
    expect(command).not.toBeNull();
    record(command!);
    expect(history.entries).toHaveLength(1);
    undo();
    expect(zoneBounds(currentZone)).toMatchObject({ x: 0, y: 0 });
    expect(currentMembers).toEqual([{ id: "member", x: 1, y: 2 }]);
    redo();
    expect(zoneBounds(currentZone)).toMatchObject({ x: 8, y: 5 });
    expect(currentMembers).toEqual([{ id: "member", x: 9, y: 7 }]);
    clearHistory();
  });

  it("stops at a touching boundary even when the pointer moves past the obstacle", () => {
    const gesture = createZoneMoveGesture(zone("a", 0, 0, 4, 4), [zone("b", 10, 0, 4, 4)], [], { x: 0, y: 0 });
    const first = updateZoneMoveGesture(gesture, { x: 20, y: 0 }, false, 10);
    const farther = updateZoneMoveGesture(first, { x: 40, y: 0 }, false, 10);

    expect(zoneBounds(first.afterZone).x).toBe(6);
    expect(zoneBounds(farther.afterZone).x).toBe(6);
    expect(first.blocked).toBe(true);
    expect(farther.blocked).toBe(true);
    expect(updateZoneMoveGesture(gesture, { x: 6, y: 0 }, false, 10).blocked).toBe(false);
  });

  it("clamps movement from the left and top without crossing touching obstacles", () => {
    const source = zone("a", 10, 10, 4, 4);
    const left = createZoneMoveGesture(source, [zone("left", 2, 10, 4, 4)], [], { x: 0, y: 0 });
    const top = createZoneMoveGesture(source, [zone("top", 10, 2, 4, 4)], [], { x: 0, y: 0 });
    const movedLeft = updateZoneMoveGesture(left, { x: -20, y: 0 }, false, 10);
    const movedTop = updateZoneMoveGesture(top, { x: 0, y: -20 }, false, 10);

    expect(zoneBounds(movedLeft.afterZone)).toEqual({ x: 6, y: 10, width: 4, height: 4 });
    expect(zoneBounds(movedTop.afterZone)).toEqual({ x: 10, y: 6, width: 4, height: 4 });
    expect(movedLeft.blocked && movedTop.blocked).toBe(true);
  });

  it("slides around a zone when the other axis has room and applies grid snap first", () => {
    const gesture = createZoneMoveGesture(zone("a", 3, 3, 4, 4), [zone("b", 10, 3, 4, 4)], [], { x: 0, y: 0 });
    const blocked = updateZoneMoveGesture(gesture, { x: 20, y: 0 }, false, 10);
    const slid = updateZoneMoveGesture(gesture, { x: 20, y: 8 }, false, 10);
    const snapped = updateZoneMoveGesture(gesture, { x: 4, y: 0 }, true, 10);

    expect(zoneBounds(blocked.afterZone)).toMatchObject({ x: 6, y: 3 });
    expect(zoneBounds(slid.afterZone)).toMatchObject({ x: 23, y: 11 });
    expect(slid.blocked).toBe(false);
    expect(zoneBounds(snapped.afterZone).x).toBe(6);
    expect(snapped.blocked).toBe(true);
  });

  it("clamps resizing at an obstacle while preserving the opposite edge", () => {
    const gesture = createZoneResizeGesture(zone("a", 0, 0, 4, 4), [zone("b", 10, 0, 4, 4)], "bottom-right", { x: 0, y: 0 });
    const resized = updateZoneResizeGesture(gesture, { x: 20, y: 5 }, false, 10);

    expect(zoneBounds(resized.afterZone)).toEqual({ x: 0, y: 0, width: 10, height: 9 });
    expect(resized.blocked).toBe(true);
    expect(updateZoneResizeGesture(gesture, { x: 6, y: 5 }, false, 10).blocked).toBe(false);
  });

  it("clamps top-left resize while retaining the opposite corner", () => {
    const gesture = createZoneResizeGesture(zone("a", 10, 10, 4, 4), [zone("b", 2, 10, 4, 4)], "top-left", { x: 0, y: 0 });
    const resized = updateZoneResizeGesture(gesture, { x: -20, y: 0 }, false, 10);

    expect(zoneBounds(resized.afterZone)).toEqual({ x: 6, y: 10, width: 8, height: 4 });
    expect(resized.blocked).toBe(true);
  });

  it("lets a corner resize slide along the free axis and preserves legacy small zones", () => {
    const gesture = createZoneResizeGesture(zone("a", 0, 0, 4, 4), [zone("b", 10, 0, 4, 4)], "bottom-right", { x: 0, y: 0 });
    const vertical = updateZoneResizeGesture(gesture, { x: 20, y: 10 }, false, 10);
    const shrink = updateZoneResizeGesture(gesture, { x: -20, y: -20 }, false, 10);

    expect(zoneBounds(vertical.afterZone)).toEqual({ x: 0, y: 0, width: 10, height: 14 });
    expect(zoneBounds(shrink.afterZone)).toEqual({ x: 0, y: 0, width: 4, height: 4 });
  });

  it("keeps the 30u minimum during resize and does not shrink smaller legacy dimensions", () => {
    const standard = createZoneResizeGesture(zone("standard", 0, 0, 30, 30), [], "bottom-right", { x: 30, y: 30 });
    const standardShrink = updateZoneResizeGesture(standard, { x: -100, y: -100 }, false, 10);
    expect(zoneBounds(standardShrink.afterZone)).toEqual({ x: 0, y: 0, width: 30, height: 30 });

    const legacy = createZoneResizeGesture(zone("legacy", 0, 0, 12, 18), [], "bottom-right", { x: 12, y: 18 });
    const legacyShrink = updateZoneResizeGesture(legacy, { x: -100, y: -100 }, false, 10);
    expect(zoneBounds(legacyShrink.afterZone)).toEqual({ x: 0, y: 0, width: 12, height: 18 });
  });

  it("keeps the zone centre fixed when Shift-resizing an edge or corner", () => {
    const source = zone("centered", 0, 0, 100, 80);
    const rightEdge = createZoneResizeGesture(source, [], "right", { x: 100, y: 40 });
    const sideResize = updateZoneResizeGesture(rightEdge, { x: 110, y: 40 }, false, 10, true);
    expect(zoneBounds(sideResize.afterZone)).toEqual({ x: -10, y: 0, width: 120, height: 80 });

    const corner = createZoneResizeGesture(source, [], "top-right", { x: 100, y: 0 });
    const cornerResize = updateZoneResizeGesture(corner, { x: 110, y: -10 }, false, 10, true);
    expect(zoneBounds(cornerResize.afterZone)).toEqual({ x: -10, y: -10, width: 120, height: 100 });
  });

  it("undoes a resize and re-enters its mode in one history step", () => {
    clearHistory();
    const before = zone("resize-history", 0, 0, 100, 80);
    const gesture = createZoneResizeGesture(before, [], "right", { x: 100, y: 40 });
    const resized = updateZoneResizeGesture(gesture, { x: 110, y: 40 }, false, 10, true);
    let current = resized.afterZone;
    let resizeMode: string | null = null;
    const command = zoneResizeHistoryCommand(resized, (next) => { current = next; }, (id) => { resizeMode = id; });

    expect(command).not.toBeNull();
    record(command!);
    expect(history.entries).toHaveLength(1);
    resizeMode = null;
    undo();
    expect(zoneBounds(current)).toEqual({ x: 0, y: 0, width: 100, height: 80 });
    expect(resizeMode).toBe(before.id);
    redo();
    expect(zoneBounds(current)).toEqual({ x: -10, y: 0, width: 120, height: 80 });
    expect(resizeMode).toBe(before.id);
    clearHistory();
  });

  it("preserves a complex zone shape and hole while resizing its bounds", () => {
    const irregular: Zone = {
      id: "irregular",
      name: "Irregular",
      color: "#456789",
      parts: [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }]],
      holes: [[{ x: 40, y: 20 }, { x: 50, y: 40 }, { x: 60, y: 20 }]],
    };
    const gesture = createZoneResizeGesture(irregular, [], "right", { x: 100, y: 40 });
    const resized = updateZoneResizeGesture(gesture, { x: 120, y: 40 }, false, 10);

    expect(resized.afterZone.parts[0]).toHaveLength(3);
    expect(resized.afterZone.holes[0]).toHaveLength(3);
    expect(resized.afterZone.parts[0][1]).toEqual({ x: 120, y: 0 });
    expect(resized.afterZone.holes[0][1]).toEqual({ x: 60, y: 40 });
  });

  it("clamps a Shift resize at an obstacle without moving the zone centre", () => {
    const source = zone("centered", 0, 0, 100, 80);
    const gesture = createZoneResizeGesture(source, [zone("obstacle", 110, 20, 20, 40)], "right", { x: 100, y: 40 });
    const resized = updateZoneResizeGesture(gesture, { x: 130, y: 40 }, false, 10, true);
    const bounds = zoneBounds(resized.afterZone);

    expect(bounds.x + bounds.width / 2).toBeCloseTo(50, 8);
    expect(resized.blocked).toBe(true);
    expect(overlapByArea(bounds, zoneBounds(zone("obstacle", 110, 20, 20, 40)))).toBe(false);
  });
});

function overlapByArea(a: ReturnType<typeof zoneBounds>, b: ReturnType<typeof zoneBounds>): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("zone deletion action", () => {
  it("deletes a mixed selection through the command in one history step", () => {
    clearHistory();
    clearSelection();
    zones.byId = {};
    zones.order = [];
    board.notes = {};
    board.order = [];
    addZone(zone("zone", 0, 0, 8, 8));
    const note: Note = { id: "note", type: "note", name: "Note", text: "", x: 1, y: 1, width: 2, height: 2 };
    addNote(note);
    selectZonesOnly(["zone"]);
    toggleSelected("note");

    deleteSelection();
    expect(zones.order).toEqual([]);
    expect(board.order).toEqual([]);
    expect(selection.ids).toEqual([]);
    expect(selection.zoneIds).toEqual([]);
    expect(history.entries).toHaveLength(1);
    undo();
    expect(zones.order).toEqual(["zone"]);
    expect(board.order).toEqual(["note"]);
    expect(selection.ids).toEqual(["note"]);
    expect(selection.zoneIds).toEqual(["zone"]);
    clearHistory();
    clearSelection();
  });
  it("combines with note deletion in one undoable action and leaves unselected content", () => {
    zones.byId = {};
    zones.order = [];
    board.notes = {};
    board.order = [];
    const first = zone("zone-a", 0, 0, 8, 8);
    const second = zone("zone-b", 8, 0, 8, 8);
    addZone(first);
    addZone(second);
    const selected: Note = { id: "selected", type: "note", name: "Selected", text: "", x: 1, y: 1, width: 2, height: 2 };
    const retained: Note = { ...selected, id: "retained", name: "Retained", x: 3 };
    addNote(selected);
    addNote(retained);
    const zonesAction = deleteZonesAction(["zone-a"]);
    const combined = {
      do: () => { zonesAction.do(); removeNote(selected.id); },
      undo: () => { addNote(selected, 0); zonesAction.undo(); },
    };

    combined.do();
    expect(zones.order).toEqual(["zone-b"]);
    expect(board.order).toEqual(["retained"]);
    combined.undo();
    expect(zones.order).toEqual(["zone-a", "zone-b"]);
    expect(board.order).toEqual(["selected", "retained"]);
  });
});
