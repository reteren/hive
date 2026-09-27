import { describe, expect, it } from "vitest";
import { dictionaryHeightLimits } from "../src/spell/dictionarySizing";
import {
  clampShrinkOnlyHeight,
  hasResizeHandle,
  minimumHeightForKind,
  minimumWidthForKind,
  resizeNote,
  resizeRuleForKind,
  RESIZE_EDGES,
} from "../src/selection/resize";

describe("node size rule table", () => {
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
    expect(resizeNote(frame, 30, "bottom", { x: 0, y: -40 }, false, 10).height).toBe(6);
  });
});
