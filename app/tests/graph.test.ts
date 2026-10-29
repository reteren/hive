import { describe, expect, it } from "vitest";
import { addGraphPoint, fractionInRect, graphPointAt, graphPointText, liveGraphPoints, removeGraphPoint, updateGraphPoint } from "../src/graph/logic";
import { emptyGraphData, parseGraphData } from "../src/model/nodeData";
import { parseMcpNote } from "../src/project/index";
import { maximumWidthForKind, resizeRuleForKind } from "../src/selection/resize";
import type { Note } from "../src/model/note";

const rect = { left: 100, top: 50, width: 200, height: 100 };

describe("graph node", () => {
  it("maps client positions to plot fractions with y from the bottom", () => {
    expect(fractionInRect(100, 150, rect)).toEqual({ x: 0, y: 0 });
    expect(fractionInRect(300, 50, rect)).toEqual({ x: 1, y: 1 });
    expect(fractionInRect(1000, -40, rect)).toEqual({ x: 1, y: 1 });
  });

  it("adds, moves, labels, links and removes points without mutating the input", () => {
    const empty = emptyGraphData();
    const one = addGraphPoint(empty, { id: "p", x: 0.5, y: 2, label: "", targetId: null });
    expect(empty.points).toHaveLength(0);
    expect(one.points[0]).toMatchObject({ x: 0.5, y: 1 });
    const moved = updateGraphPoint(one, "p", { x: -1, label: "A", targetId: "n1" });
    expect(moved.points[0]).toEqual({ id: "p", x: 0, y: 1, label: "A", targetId: "n1" });
    expect(removeGraphPoint(moved, "p").points).toEqual([]);
  });

  it("shows a node point's live name and a plain point's label, and drops points of deleted nodes", () => {
    const notes = { n1: { id: "n1", name: "Target" } as Note };
    expect(graphPointText({ id: "p", x: 0, y: 0, label: "", targetId: "n1" }, notes)).toBe("Target");
    expect(graphPointText({ id: "p", x: 0, y: 0, label: "Old", targetId: "n1" }, notes)).toBe("Target");
    expect(graphPointText({ id: "p", x: 0, y: 0, label: " Mine ", targetId: null }, notes)).toBe("Mine");
    const graph = { xLabel: "", yLabel: "", points: [
      { id: "a", x: 0, y: 0, label: "Plain", targetId: null },
      { id: "b", x: 0, y: 0, label: "", targetId: "n1" },
      { id: "c", x: 0, y: 0, label: "", targetId: "gone" },
    ] };
    expect(liveGraphPoints(graph, notes).map((point) => point.id)).toEqual(["a", "b"]);
  });

  it("finds the nearest point within the hit radius", () => {
    const graph = { xLabel: "", yLabel: "", points: [{ id: "a", x: 0.5, y: 0.5, label: "", targetId: null }] };
    expect(graphPointAt(graph, 205, 100, rect)?.id).toBe("a");
    expect(graphPointAt(graph, 250, 100, rect)).toBeNull();
  });

  it("parses saved data tolerantly and keeps it through the project index", () => {
    expect(parseGraphData({ xLabel: 1, points: [{ id: "a", x: 3, y: -1 }, { id: "", x: 0, y: 0 }, { id: "b", x: "x", y: 0 }] }))
      .toEqual({ xLabel: "", yLabel: "", points: [{ id: "a", x: 1, y: 0, label: "", targetId: null }] });
    const graph = { xLabel: "Time", yLabel: "Value", points: [{ id: "a", x: 0.2, y: 0.8, label: "Peak", targetId: "n1" }] };
    const parsed = parseMcpNote({ id: "g", type: "graph", name: "Graph", file: "Graph.md", x: 0, y: 0, width: 50, height: 36, graph });
    expect(parsed.note.type).toBe("graph");
    expect(parsed.note.graph).toEqual(graph);
  });

  it("stretches freely without an upper limit", () => {
    expect(resizeRuleForKind("graph")).toMatchObject({ width: "free", height: "free", handles: "all" });
    expect(maximumWidthForKind("graph")).toBe(Number.POSITIVE_INFINITY);
  });
});
