import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import { board, replaceBoard, updateNote } from "../src/model/board.svelte";
import { links, replaceLinks } from "../src/model/links.svelte";
import { clear, execute, history, redo, undo } from "../src/history/history.svelte";
import { noteBounds } from "../src/notes/layout.svelte";
import { insertStatisticsIntoList, extractStatisticsFromList } from "../src/stats/listStatsActions.svelte";
import { alignedListStatistics, geometryFromListStatisticsFrame, listExtensionGeometry, listStatisticsFrameLimits, listStatisticsWidth, LIST_STATS_EXTENSION_WIDTH, widthWithListStatistics } from "../src/stats/listStatsLayout";
import { statisticsPullOutMoved } from "../src/stats/listStatsPullOut";
import { parseProjectIndex, serializeProjectIndex, mergeLoadedNotes } from "../src/project/index";
import { sanitizeArchiveEntries } from "../src/archive/serialization";
import { sanitizeTrashEntries } from "../src/trash/serialization";
import { updateModuleDropPreview, moduleDropPreview, clearModuleDropPreview, tryInsertModuleOnDrop } from "../src/modules/moduleActions.svelte";
import { createMoveGesture, createResizeGesture, updateMoveGesture, updateResizeGesture, type NoteFrame } from "../src/selection/gestures";
import { createGroupScaleGesture, updateGroupScaleGesture } from "../src/selection/groupScale";

function note(id: string, type: Note["type"], fields: Partial<Note> = {}): Note {
  return { id, type, name: id, text: "", x: 0, y: 0, width: 30, height: 20, ...fields };
}
beforeEach(() => { clear(); replaceBoard([]); replaceLinks([]); clearModuleDropPreview(); });
afterEach(() => { clear(); replaceBoard([]); replaceLinks([]); clearModuleDropPreview(); });

describe("attached Statistics geometry and row alignment", () => {
  it("extends the render and shared bounds width without modifying the persisted List width", () => {
    const list = note("list", "list", { listStats: true });
    expect(listStatisticsWidth(list)).toBe(LIST_STATS_EXTENSION_WIDTH);
    expect(widthWithListStatistics(list)).toBe(60);
    expect(noteBounds(list)).toMatchObject({ x: 0, y: 0, width: 60, height: 20 });
    expect(list.width).toBe(30);
    expect(noteBounds({ ...list, listStats: false }).width).toBe(30);
    expect(noteBounds(note("plain", "note", { listStats: true })).width).toBe(30);
  });
  it("keeps the panel outside the main frame and cells at the same horizontal origin despite chrome insets", () => {
    const layout = listExtensionGeometry(299, 15, 48, 17, 134, 1);
    expect(layout).toEqual({ left: 284, top: -47, height: 133, cellLeft: 282 });
    expect(layout.left + 15).toBe(299);
    expect(layout.cellLeft + 17).toBe(299);
    expect(layout.top + 48 + layout.height).toBe(134);
  });
  it("shares row order and drag gaps, updating counts after reorder, add, remove and source changes", () => {
    const first = { id: "text", targetId: null, label: "two words" };
    const second = { id: "linked", targetId: "target", label: "Old name" };
    const notes = { target: note("target", "note", { name: "Live", text: "one" }) };
    expect(alignedListStatistics("list", [{ item: first }, { item: second }], notes, {})).toMatchObject([
      { kind: "text", text: "two words", words: 2 }, { kind: "note", name: "Live", words: 1 },
    ]);
    expect(alignedListStatistics("list", [{ item: second }, { item: null }, { item: first }], notes, {})).toMatchObject([
      { kind: "note", name: "Live" }, null, { kind: "text", text: "two words" },
    ]);
    const updated = { target: { ...notes.target, text: "one two\nthree" } };
    expect(alignedListStatistics("list", [{ item: second }], updated, {})).toMatchObject([{ words: 3, lines: 2 }]);
    expect(alignedListStatistics("list", [], updated, {})).toEqual([]);
    expect(history.entries).toHaveLength(0);
  });
});

describe("Statistics insertion/extraction round trip", () => {
  it("grows and shrinks shared bounds, consumes/restores the source and owns one Undo each way", () => {
    const list = note("list", "list", { listItems: [{ id: "row", targetId: null, label: "hello" }] });
    const stats = note("stats", "stats", { x: 85, y: 50 });
    replaceBoard([list, stats]);
    expect(insertStatisticsIntoList("stats", "list")).toBe(true);
    expect(history.entries).toHaveLength(1);
    expect(board.notes.stats).toBeUndefined();
    expect(noteBounds(board.notes.list).width).toBe(60);
    expect(board.notes.list.width).toBe(30);
    undo(); expect(noteBounds(board.notes.list).width).toBe(30);
    expect(board.notes.stats).toMatchObject({ x: 85, y: 50 });
    redo();
    expect(extractStatisticsFromList("list", { x: 100, y: 50 })).toBe(true);
    expect(history.entries).toHaveLength(2);
    expect(noteBounds(board.notes.list).width).toBe(30);
    const extracted = Object.values(board.notes).find((entry) => entry.type === "stats")!;
    expect(Object.values(links.byId)).toMatchObject([{ from: extracted.id, to: "list", kind: "strong" }]);
    undo(); expect(board.notes[extracted.id]).toBeUndefined();
    expect(noteBounds(board.notes.list).width).toBe(60);
    expect(Object.values(links.byId)).toEqual([]);
    redo(); expect(board.notes[extracted.id]).toBeDefined();
  });
  it("previews Statistics as an insertable module, including the extension part of the List bounds", () => {
    replaceBoard([note("list", "list"), note("stats", "stats", { x: 90 })]);
    updateModuleDropPreview("stats", { x: 29, y: 10 });
    expect(moduleDropPreview).toMatchObject({ moduleId: "stats", targetId: "list", allowed: true });
    expect(tryInsertModuleOnDrop("stats", { x: 29, y: 10 })).toBe(true);
    replaceBoard([board.notes.list, note("other", "stats", { x: 90 })]);
    updateModuleDropPreview("other", { x: 50, y: 10 });
    expect(moduleDropPreview).toMatchObject({ targetId: "list", allowed: false, reason: "This List already has Statistics." });
    expect(tryInsertModuleOnDrop("other", { x: 50, y: 10 })).toBe(false);
    expect(history.entries).toHaveLength(1);
    expect(board.notes.other).toBeDefined();
  });
  it("classifies clicks and small pointer jitter without extracting a node", () => {
    replaceBoard([note("list", "list", { listStats: true })]);
    expect(statisticsPullOutMoved({ x: 20, y: 20 }, { x: 20, y: 20 })).toBe(false);
    expect(statisticsPullOutMoved({ x: 20, y: 20 }, { x: 23, y: 23 })).toBe(false);
    expect(statisticsPullOutMoved({ x: 20, y: 20 }, { x: 26, y: 20 })).toBe(true);
    expect(board.notes.list.listStats).toBe(true);
    expect(history.entries).toHaveLength(0);
  });
});

describe("attached Statistics persistence", () => {
  it("keeps listStats and base width across save/load without repeatedly adding extension width", () => {
    const list = note("list", "list", { height: null, listStats: true, listItems: [{ id: "row", targetId: null, label: "hi" }] });
    const index = parseProjectIndex(serializeProjectIndex([list]));
    expect(index.notes[0]).toMatchObject({ listStats: true, width: 30 });
    const loaded = mergeLoadedNotes(index, [{ ...list, file: index.notes[0].file }])[0];
    expect(loaded).toMatchObject({ listStats: true, width: 30 });
    expect(noteBounds(loaded).width).toBe(60);
    expect(parseProjectIndex(serializeProjectIndex([loaded])).notes[0].width).toBe(30);
  });
  it("keeps the extension when Lists are restored from saved archive and trash snapshots", () => {
    const list = note("list", "list", { listStats: true });
    const archive = sanitizeArchiveEntries([{ id: "archived", archivedAt: 1, note: list, links: [] }]);
    const trash = sanitizeTrashEntries([{ id: "deleted", deletedAt: 1, notes: [list], zones: [], links: [] }]);
    expect(archive.warnings).toEqual([]); expect(trash.warnings).toEqual([]);
    for (const restored of [archive.entries[0].note, trash.entries[0].notes[0]]) {
      expect(restored).toMatchObject({ listStats: true, width: 30 });
      expect(noteBounds(restored).width).toBe(60);
    }
  });
});

describe("selection geometry with a fixed Statistics extension", () => {
  function initialFrame(): NoteFrame {
    return { id: "list", type: "list", x: 0, y: 0, width: 60, height: 20,
      ...listStatisticsFrameLimits(board.notes.list, 12, 75), maxHeight: 100 };
  }
  function apply(frame: NoteFrame): void {
    updateNote(frame.id, geometryFromListStatisticsFrame(board.notes[frame.id], frame));
  }
  function commit(before: NoteFrame, after: NoteFrame): void {
    execute({ label: "Resize", target: "List", do: () => apply(after), undo: () => apply(before) });
  }
  beforeEach(() => replaceBoard([note("list", "list", { listStats: true })]));

  it("preserves the base width across repeated moves, preview application, Undo and Redo", () => {
    const before = initialFrame();
    const moved = updateMoveGesture(createMoveGesture([before], "list", { x: 0, y: 0 }), { x: 20, y: 10 }, false, 1).after[0];
    apply(moved); apply(moved); commit(before, moved);
    expect(board.notes.list).toMatchObject({ x: 20, y: 10, width: 30 });
    expect(noteBounds(board.notes.list).width).toBe(60);
    undo(); expect(board.notes.list).toMatchObject({ x: 0, y: 0, width: 30 });
    redo(); expect(board.notes.list.width).toBe(30);
  });
  it("resizes the main width once and preserves the fixed extension at both limits and opposite anchors", () => {
    const before = initialFrame();
    const resized = updateResizeGesture(createResizeGesture(before, 20, "right", { x: 60, y: 0 }), { x: 70, y: 0 }, false, 1).after;
    commit(before, resized); expect(board.notes.list.width).toBe(40);
    undo(); expect(board.notes.list.width).toBe(30);
    redo(); expect(board.notes.list.width).toBe(40);
    const shrink = updateResizeGesture(createResizeGesture(before, 20, "left", { x: 0, y: 0 }), { x: 100, y: 0 }, false, 1).after;
    apply(shrink); expect(board.notes.list).toMatchObject({ x: 18, width: 12 });
    expect(noteBounds(board.notes.list).x + noteBounds(board.notes.list).width).toBe(60);
    const grow = updateResizeGesture(createResizeGesture(before, 20, "right", { x: 60, y: 0 }), { x: 1000, y: 0 }, false, 1).after;
    apply(grow); expect(board.notes.list.width).toBe(75);
  });
  it("group-scales combined bounds and keeps a 30u extension without inflation or a negative main width", () => {
    const before = initialFrame();
    const bounds = { x: 0, y: 0, width: 100, height: 20 };
    const other = { id: "other", type: "note" as const, x: 80, y: 0, width: 20, height: 20 };
    const gesture = createGroupScaleGesture([before, other], bounds, "right", { x: 100, y: 0 });
    const resized = updateGroupScaleGesture(gesture, { x: 150, y: 0 }, false, 1).after[0];
    commit(before, resized); expect(board.notes.list.width).toBe(60);
    expect(noteBounds(board.notes.list).width).toBe(90);
    undo(); expect(board.notes.list.width).toBe(30);
    redo(); expect(board.notes.list.width).toBe(60);
    const shrunk = updateGroupScaleGesture(gesture, { x: 0, y: 0 }, false, 1).after[0];
    apply(shrunk); expect(board.notes.list.width).toBe(12);
    const largest = updateGroupScaleGesture(gesture, { x: 1000, y: 0 }, false, 1).after[0];
    apply(largest); expect(board.notes.list.width).toBe(75);
  });
});
