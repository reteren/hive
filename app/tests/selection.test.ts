import { describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import { rectContour, type Zone } from "../src/model/zone";
import {
  boundsTouch,
  hitTestNotes,
  hitTestZones,
  notesTouchingMarquee,
  rectFromPoints,
  zonesTouchingMarquee,
} from "../src/selection/hitTesting";
import {
  cancelMoveGesture,
  cancelResizeGesture,
  createMoveGesture,
  createResizeGesture,
  crossedGestureThreshold,
  moveGestureChange,
  resizeGestureChange,
  updateMoveGesture,
  updateResizeGesture,
} from "../src/selection/gestures";
import { hasResizeHandle, MIN_NOTE_WIDTH, resizeNote } from "../src/selection/resize";
import {
  captureSelectionSnapshot,
  clearSelection,
  clearSelectionUndoable,
  restoreSelectionSnapshot,
  selectMarquee,
  selectOnly,
  selectZonesOnly,
  selection,
  setSelectionUndoable,
  toggleSelected,
  toggleZoneSelected,
} from "../src/selection/selection.svelte";
import { clear as clearHistory, history, redo, undo } from "../src/history/history.svelte";
import { clearSelectedLink, selectedLink, setLinkSelectionUndoable } from "../src/links/selection.svelte";

const noteA: Note = {
  id: "a",
  type: "note",
  name: "A",
  text: "",
  x: 0,
  y: 0,
  width: 20,
  height: 10,
};

const noteB: Note = {
  ...noteA,
  id: "b",
  name: "B",
  x: 10,
  y: 5,
};

describe("selection hit testing", () => {
  it("keeps zones in a separate selection list while allowing mixed Ctrl and marquee selection", () => {
    clearSelection();
    selectZonesOnly(["zone"]);
    expect(selection.ids).toEqual([]);
    expect(selection.zoneIds).toEqual(["zone"]);
    toggleSelected("note");
    expect(selection.ids).toEqual(["note"]);
    expect(selection.zoneIds).toEqual(["zone"]);
    toggleZoneSelected("other-zone");
    selectMarquee(["beacon"], true, ["zone", "third-zone"]);
    expect(selection.ids).toEqual(["note", "beacon"]);
    expect(selection.zoneIds).toEqual(["zone", "other-zone", "third-zone"]);
    selectOnly("note");
    expect(selection.zoneIds).toEqual([]);
    clearSelection();
  });

  it("excludes dimmed notes from point and marquee hit tests", () => {
    const include = (id: string) => id !== "b";
    const bounds = (note: Note) => ({ x: note.x, y: note.y, width: note.width, height: note.height ?? 0 });
    expect(hitTestNotes({ x: 15, y: 7 }, { a: noteA, b: noteB }, ["a", "b"], bounds, include)).toEqual(["a"]);
    expect(notesTouchingMarquee({ x: 15, y: 7, width: 1, height: 1 }, { a: noteA, b: noteB }, ["a", "b"], bounds, include)).toEqual(["a"]);
  });
  it("selects zones by marquee touch and gives the topmost zone a shared boundary", () => {
    const first: Zone = { id: "z1", name: "One", color: "#445566", parts: [rectContour(0, 0, 10, 10)], holes: [] };
    const second: Zone = { id: "z2", name: "Two", color: "#667788", parts: [rectContour(10, 0, 10, 10)], holes: [] };
    const byId = { z1: first, z2: second };

    expect(zonesTouchingMarquee({ x: -2, y: 4, width: 2, height: 2 }, byId, ["z1", "z2"])).toEqual(["z1"]);
    expect(hitTestZones({ x: 10, y: 5 }, byId, ["z1", "z2"])).toBe("z2");
  });

  it("does not hit a zone inside a hole or outside its contour", () => {
    const hollow: Zone = {
      id: "hollow", name: "Hollow", color: "#445566",
      parts: [rectContour(0, 0, 10, 10)], holes: [rectContour(3, 3, 4, 4)],
    };
    expect(hitTestZones({ x: 5, y: 5 }, { hollow }, ["hollow"])).toBeNull();
    expect(hitTestZones({ x: 2, y: 2 }, { hollow }, ["hollow"])).toBe("hollow");
    expect(zonesTouchingMarquee({ x: 4, y: 4, width: 1, height: 1 }, { hollow }, ["hollow"])).toEqual([]);
  });

  it("returns overlapping notes from topmost to bottommost", () => {
    expect(hitTestNotes({ x: 15, y: 7 }, { a: noteA, b: noteB }, ["a", "b"])).toEqual(["b", "a"]);
  });

  it("selects notes touched by a marquee edge or corner", () => {
    const marquee = rectFromPoints({ x: 20, y: 0 }, { x: 30, y: 4 });
    expect(boundsTouch(marquee, { x: 0, y: 0, width: 20, height: 10 })).toBe(true);
    expect(
      notesTouchingMarquee(marquee, { a: noteA, b: noteB }, ["a", "b"], (note) => ({
        x: note.x,
        y: note.y,
        width: note.width,
        height: note.height ?? 0,
      })),
    ).toEqual(["a"]);
  });

  it("does not select notes separated from the marquee", () => {
    expect(boundsTouch({ x: 0, y: 0, width: 5, height: 5 }, { x: 5.01, y: 0, width: 3, height: 3 })).toBe(false);
  });
});

describe("undoable board selection", () => {
  it("records one Select step and restores the prior selection on Undo and Redo", () => {
    clearSelection();
    clearSelectedLink();
    clearHistory();
    const empty = captureSelectionSnapshot();
    const selected = { ...empty, ids: ["a", "b"], zoneIds: ["zone"], primaryId: "b" };

    expect(setSelectionUndoable(selected)).toBe(true);
    expect(history.entries.map(({ label }) => label)).toEqual(["Select 3 objects"]);
    expect(selection.ids).toEqual(["a", "b"]);
    expect(selection.zoneIds).toEqual(["zone"]);
    expect(selection.primaryId).toBe("b");
    expect(setSelectionUndoable(captureSelectionSnapshot())).toBe(false);
    expect(history.entries).toHaveLength(1);

    undo();
    expect(selection.ids).toEqual([]);
    expect(selection.zoneIds).toEqual([]);
    redo();
    expect(selection.ids).toEqual(["a", "b"]);
    expect(selection.zoneIds).toEqual(["zone"]);
  });

  it("includes line selection in the same selection history step", () => {
    clearSelection();
    clearSelectedLink();
    clearHistory();
    selectOnly("note");

    expect(setLinkSelectionUndoable(["line-a", "line-b"], true)).toBe(true);
    expect(selection.ids).toEqual([]);
    expect(selectedLink.ids).toEqual(["line-a", "line-b"]);
    expect(history.entries.map(({ label }) => label)).toEqual(["Select 2 objects"]);

    undo();
    expect(selection.ids).toEqual(["note"]);
    expect(selectedLink.ids).toEqual([]);
    redo();
    expect(selection.ids).toEqual([]);
    expect(selectedLink.ids).toEqual(["line-a", "line-b"]);
  });

  it("restores a captured selection raw for inclusion in a different command", () => {
    clearSelection();
    clearSelectedLink();
    clearHistory();
    selectOnly("before");
    const before = captureSelectionSnapshot();
    clearSelection();
    selectOnly("created");

    restoreSelectionSnapshot(before);
    expect(selection.ids).toEqual(["before"]);
    expect(history.entries).toEqual([]);
  });

  it("labels clearing a nonempty selection as Deselect", () => {
    clearSelection();
    clearSelectedLink();
    clearHistory();
    const empty = captureSelectionSnapshot();
    setSelectionUndoable({ ...empty, ids: ["a"], primaryId: "a" });
    setSelectionUndoable(empty);
    expect(history.entries.map(({ label }) => label)).toEqual(["Select 1 object", "Deselect"]);
  });

  it("clears note, zone, and link selection together and restores them with Undo", () => {
    clearSelection();
    clearSelectedLink();
    clearHistory();
    setSelectionUndoable({ ...captureSelectionSnapshot(), ids: ["a"], zoneIds: ["zone"], primaryId: "a" });
    setLinkSelectionUndoable(["line"]);

    expect(clearSelectionUndoable()).toBe(true);
    expect(selection.ids).toEqual([]);
    expect(selection.zoneIds).toEqual([]);
    expect(selectedLink.ids).toEqual([]);
    expect(history.entries.at(-1)?.label).toBe("Deselect");

    undo();
    expect(selection.ids).toEqual(["a"]);
    expect(selection.zoneIds).toEqual(["zone"]);
    expect(selectedLink.ids).toEqual(["line"]);
  });
});

describe("selection move and resize gestures", () => {
  it("does not move or snap a note until a drag crosses the screen threshold", () => {
    const gesture = createMoveGesture([{ id: "a", x: 13, y: 18, width: 20, height: 10 }], "a", { x: 100, y: 100 });
    expect(crossedGestureThreshold({ x: 0, y: 0 }, { x: 3.9, y: 0 })).toBe(false);
    expect(moveGestureChange(gesture)).toBeNull();
    expect(gesture.after).toEqual([{ id: "a", x: 13, y: 18, width: 20, height: 10 }]);
  });

  it("snaps a moving group by the dragged note's top-left anchor", () => {
    const gesture = createMoveGesture(
      [
        { id: "a", x: 13, y: 18, width: 20, height: 10 },
        { id: "b", x: 43, y: 48, width: 12, height: null },
      ],
      "a",
      { x: 100, y: 100 },
    );
    const moved = updateMoveGesture(gesture, { x: 104, y: 96 }, true, 10);
    expect(moved.after).toEqual([
      { id: "a", x: 20, y: 10, width: 20, height: 10 },
      { id: "b", x: 50, y: 40, width: 12, height: null },
    ]);
  });

  it("resizes from all eight edges while keeping the opposite sides fixed", () => {
    const frame = { id: "a", x: 5, y: 7, width: 20, height: 21 };
    const cases = [
      ["top-left", { x: -5, y: -4 }, { x: 0, y: 3, width: 25, height: 25 }],
      ["top", { x: 0, y: -4 }, { x: 5, y: 3, width: 20, height: 25 }],
      ["top-right", { x: 5, y: -4 }, { x: 5, y: 3, width: 25, height: 25 }],
      ["right", { x: 5, y: 0 }, { x: 5, y: 7, width: 25, height: 21 }],
      ["bottom-right", { x: 5, y: 4 }, { x: 5, y: 7, width: 25, height: 25 }],
      ["bottom", { x: 0, y: 4 }, { x: 5, y: 7, width: 20, height: 25 }],
      ["bottom-left", { x: -5, y: 4 }, { x: 0, y: 7, width: 25, height: 25 }],
      ["left", { x: -5, y: 0 }, { x: 0, y: 7, width: 25, height: 21 }],
    ] as const;

    for (const [edge, delta, expected] of cases) {
      expect(resizeNote(frame, 21, edge, delta, false, 10)).toEqual(expected);
    }
  });

  it("snaps dragged edges and clamps left/top at the minimum without moving the opposite side", () => {
    const frame = { id: "a", x: 5, y: 7, width: 20, height: null };
    expect(resizeNote(frame, 21, "right", { x: 4, y: 0 }, true, 10)).toEqual({
      x: 5,
      y: 7,
      width: 25,
      height: null,
    });
    expect(resizeNote(frame, 21, "bottom", { x: 0, y: 5 }, true, 10)).toEqual({
      x: 5,
      y: 7,
      width: 20,
      height: 23,
    });
    expect(resizeNote(frame, 21, "left", { x: 4, y: 0 }, true, 10)).toEqual({
      x: 10,
      y: 7,
      width: 15,
      height: null,
    });
    expect(resizeNote(frame, 21, "top", { x: 0, y: 4 }, true, 10)).toEqual({
      x: 5,
      y: 10,
      width: 20,
      height: 18,
    });

    const manual = { id: "a", x: 5, y: 7, width: 20, height: 21 };
    expect(resizeNote(manual, 21, "top-left", { x: 100, y: 100 }, false, 10)).toEqual({
      x: 13,
      y: 22,
      width: MIN_NOTE_WIDTH,
      height: 6,
    });
  });

  it("turns an auto-height note manual when dragging the top handle", () => {
    const frame = { id: "a", x: 5, y: 7, width: 20, height: null };
    expect(resizeNote(frame, 21, "top", { x: 0, y: 4 }, false, 10)).toEqual({
      x: 5,
      y: 11,
      width: 20,
      height: 17,
    });
  });

  it("keeps standalone module width fixed and bounds corner resizing to 1–2× base height", () => {
    const frame = { id: "module", x: 10, y: 20, width: 14, height: 4 };

    for (const kind of ["importance"] as const) {
      expect(hasResizeHandle(kind, "left")).toBe(false);
      expect(hasResizeHandle(kind, "right")).toBe(false);
      expect(hasResizeHandle(kind, "top-left")).toBe(true);
      expect(hasResizeHandle(kind, "bottom-right")).toBe(true);
    }
    for (const kind of ["purpose", "mood"] as const) {
      expect(hasResizeHandle(kind, "top-left")).toBe(false);
      expect(hasResizeHandle(kind, "bottom")).toBe(false);
    }
    expect(hasResizeHandle("note", "right")).toBe(true);

    expect(resizeNote(frame, 4, "bottom-right", { x: 50, y: 100 }, false, 10, true)).toEqual({
      x: 10, y: 20, width: 14, height: 8,
    });
    expect(resizeNote(frame, 4, "top-left", { x: -50, y: 100 }, false, 10, true)).toEqual({
      x: 10, y: 20, width: 14, height: 4,
    });
    expect(resizeNote(frame, 4, "top-right", { x: 50, y: -100 }, false, 10, true)).toEqual({
      x: 10, y: 16, width: 14, height: 8,
    });
    expect(resizeNote(frame, 4, "right", { x: 50, y: 0 }, false, 10, true)).toEqual({
      x: 10, y: 20, width: 14, height: 4,
    });
  });

  it("never offers resize handles for fixed-size beacons", () => {
    for (const edge of ["top-left", "top", "top-right", "right", "bottom-right", "bottom", "bottom-left", "left"] as const) {
      expect(hasResizeHandle("beacon", edge)).toBe(false);
    }
  });

  it("limits note width to 2.5× base and preserves width while locked", () => {
    const note = { id: "wide", type: "note" as const, x: 10, y: 5, width: 30, height: 20, maxHeight: 30 };
    const plus = { id: "mini", type: "pro" as const, x: 10, y: 5, width: 18, height: 20 };
    expect(resizeNote(note, 20, "right", { x: 200, y: 0 }, false, 10).width).toBe(75);
    expect(resizeNote(plus, 20, "right", { x: 200, y: 0 }, false, 10).width).toBe(45);
    expect(hasResizeHandle("note", "left", true)).toBe(false);
    expect(hasResizeHandle("note", "right", true)).toBe(false);
    expect(hasResizeHandle("note", "top-left", true)).toBe(true);

    expect(resizeNote(
      { ...note, widthLocked: true }, 20, "top-left", { x: -100, y: -4 }, false, 10,
    )).toEqual({ x: 10, y: 1, width: 30, height: 24 });
  });

  it("clamps manual height to content height plus five rendered lines", () => {
    const frame = {
      id: "long", type: "note" as const, x: 0, y: 0, width: 30, height: 12,
      maxHeight: 18,
    };
    expect(resizeNote(frame, 12, "bottom", { x: 0, y: 100 }, false, 10).height).toBe(18);
  });

  it("snaps a standalone module's dragged vertical edge before clamping", () => {
    const frame = { id: "module", x: 3, y: 3, width: 14, height: 4 };
    expect(resizeNote(frame, 4, "bottom", { x: 0, y: 5 }, true, 5, true)).toEqual({
      x: 3, y: 3, width: 14, height: 7,
    });
  });

  it("restores original move and resize frames on cancel without a history change", () => {
    const original = { id: "a", x: 13, y: 18, width: 20, height: null };
    const moving = createMoveGesture([original], "a", { x: 0, y: 0 });
    const preview = updateMoveGesture(moving, { x: 17, y: -8 }, false, 10);
    expect(cancelMoveGesture(preview)).toEqual([original]);
    expect(moveGestureChange(preview, true)).toBeNull();

    const resizing = createResizeGesture(original, 12, "bottom", { x: 0, y: 0 });
    const resized = updateResizeGesture(resizing, { x: 0, y: 9 }, false, 10);
    expect(cancelResizeGesture(resized)).toEqual(original);
    expect(resizeGestureChange(resized, true)).toBeNull();
  });
});
