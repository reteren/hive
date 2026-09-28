import { describe, expect, it } from "vitest";
import { dictionaryHeightLimits } from "../src/spell/dictionarySizing";
import { board } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import {
  clampShrinkOnlyHeight,
  defaultWidthForKind,
  hasResizeHandle,
  minimumHeightForKind,
  minimumWidthForKind,
  resizeNote,
  resizeRuleForKind,
  RESIZE_EDGES,
} from "../src/selection/resize";

describe("node size rule table", () => {
  it("allows a List bottom handle only when it has more than seven rows", () => {
    expect(resizeRuleForKind("list")).toMatchObject({
      width: "locked",
      height: "free",
      handles: "bottom-if-shrinkable",
      groupDimensions: "preserve",
    });
    expect(RESIZE_EDGES.filter((edge) => hasResizeHandle("list", edge, true))).toEqual(["bottom"]);
    expect(RESIZE_EDGES.every((edge) => !hasResizeHandle("list", edge))).toBe(true);

    const id = "resize-list-threshold-test";
    const list = (rowCount: number): Note => ({
      id,
      type: "list",
      name: "List",
      text: "",
      x: 0,
      y: 0,
      width: 30,
      height: 30,
      listItems: Array.from({ length: rowCount }, (_, index) => ({ id: String(index), targetId: null, label: "" })),
    });
    const frame = { id, type: "list" as const, x: 0, y: 0, width: 30, height: 30, maxHeight: 50 };
    try {
      board.notes[id] = list(7);
      expect(resizeNote(frame, 30, "bottom", { x: 0, y: 10 }, false, 10).height).toBe(30);
      board.notes[id] = list(8);
      expect(resizeNote(frame, 30, "bottom", { x: 0, y: 10 }, false, 10).height).toBe(40);
      expect(resizeNote(frame, 30, "right", { x: 10, y: 0 }, false, 10).width).toBe(30);
      expect(resizeNote(frame, 30, "bottom-right", { x: 10, y: 10 }, false, 10).height).toBe(30);
    } finally {
      delete board.notes[id];
    }
  });

  it("locks Inbox and Dictionary width and permits only eligible bottom shrink handles", () => {
    for (const kind of ["inbox", "glossary"] as const) {
      expect(resizeRuleForKind(kind)).toMatchObject({ width: "locked", height: "shrink-only", handles: "bottom-if-shrinkable" });
      expect(RESIZE_EDGES.filter((edge) => hasResizeHandle(kind, edge, true))).toEqual(["bottom"]);
      expect(RESIZE_EDGES.every((edge) => !hasResizeHandle(kind, edge))).toBe(true);
    }
  });

  it("keeps Source and Mark as fixed while making Map freely resizable", () => {
    for (const kind of ["source", "markas"] as const) {
      expect(resizeRuleForKind(kind)).toMatchObject({ width: "locked", height: "locked", handles: "none" });
      expect(RESIZE_EDGES.every((edge) => !hasResizeHandle(kind, edge))).toBe(true);
    }
    expect(resizeRuleForKind("map")).toMatchObject({ width: "free", height: "free", handles: "all" });
    expect(RESIZE_EDGES.every((edge) => hasResizeHandle("map", edge))).toBe(true);
    expect(minimumWidthForKind("map")).toBe(20);
    expect(minimumHeightForKind("map")).toBe(15);
    expect(resizeNote({ id: "map", type: "map", x: 0, y: 0, width: 40, height: 30 }, 30, "right", { x: 20, y: 0 }, false, 10).width).toBe(60);
    expect(resizeNote({ id: "map", type: "map", x: 0, y: 0, width: 40, height: 30 }, 30, "bottom", { x: 0, y: -50 }, false, 10).height).toBe(15);
  });

  it("uses creation dimensions as resize minimums, while Map keeps its smaller free bounds", () => {
    expect(defaultWidthForKind("note")).toBe(30);
    expect(defaultWidthForKind("pro")).toBe(18);
    expect(defaultWidthForKind("purpose")).toBe(14);
    expect(defaultWidthForKind("tierlist")).toBe(60);
    expect(minimumWidthForKind("note")).toBe(30);
    expect(minimumWidthForKind("purpose")).toBe(14);
    expect(minimumWidthForKind("tierlist")).toBe(60);
    expect(minimumHeightForKind("note")).toBeCloseTo(8.2);
    expect(minimumHeightForKind("purpose")).toBeCloseTo(4.2);

    expect(resizeNote(
      { id: "note-floor", type: "note", x: 0, y: 0, width: 40, height: 20, maxHeight: 50 },
      20,
      "right",
      { x: -100, y: 0 },
      false,
      10,
    ).width).toBe(30);
    expect(resizeNote(
      { id: "note-floor", type: "note", x: 0, y: 0, width: 40, height: 20, maxHeight: 50 },
      20,
      "bottom",
      { x: 0, y: -100 },
      false,
      10,
    ).height).toBeCloseTo(8.2);
    expect(resizeNote(
      { id: "map", type: "map", x: 0, y: 0, width: 40, height: 30 },
      30,
      "right",
      { x: -100, y: 0 },
      false,
      10,
    ).width).toBe(20);
  });

  it("lets Dictionary shrink only with ten words and keeps ten rows visible", () => {
    const rows = Array.from({ length: 15 }, () => 2.3);
    expect(dictionaryHeightLimits(50, 12, rows, 9).canShrink).toBe(false);
    const limits = dictionaryHeightLimits(50, 12, rows, 15);
    expect(limits.minimumHeight).toBeCloseTo(35);
    expect(limits.canShrink).toBe(true);
    expect(dictionaryHeightLimits(35, 12, rows, 10).canShrink).toBe(false);
  });

  it("clamps shrink-only height between the ten-row minimum and natural auto height", () => {
    expect(clampShrinkOnlyHeight(10, 20, 60)).toBe(20);
    expect(clampShrinkOnlyHeight(40, 20, 60)).toBe(40);
    expect(clampShrinkOnlyHeight(90, 20, 60)).toBe(60);
  });

  it("does not let a manually shrunken Inbox grow from its bottom handle", () => {
    const frame = { id: "inbox", type: "inbox" as const, x: 0, y: 0, width: 30, height: 30, maxHeight: 60 };
    expect(resizeNote(frame, 30, "bottom", { x: 0, y: 15 }, false, 10).height).toBe(30);
    expect(resizeNote(frame, 30, "bottom", { x: 0, y: -40 }, false, 10).height).toBeCloseTo(7.8);
  });
});
