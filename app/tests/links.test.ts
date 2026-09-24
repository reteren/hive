import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Point } from "../src/board/cameraMath";
import { clear, history, redo, undo } from "../src/history/history.svelte";
import { replaceBoard } from "../src/model/board.svelte";
import type { Link } from "../src/model/link";
import { links, replaceLinks } from "../src/model/links.svelte";
import { canCreateLinkPair } from "../src/links/rules";
import { changeLinkShape, createBoardLink, cutLinks, cycleLinkShapes, unlinkSelected } from "../src/links/operations";
import { pointAtAnchor, pointOnCircleToward, projectPointToAnchor, shapeEndpoints } from "../src/links/anchors";
import { clientToBoardPoint, clientToWorld } from "../src/links/coordinates";
import { completeLinkGesture, nextTool, previewLinkKind, resolveCutRelease } from "../src/links/gestures";
import { clearSelectedLink, selectLinks, selectedLinkIds, toggleLinkSelection } from "../src/links/selection.svelte";
import { buildShape } from "../src/links/shapes";
import {
  clipSegmentToFrames,
  flattenPath,
  linePathBetweenFrames,
  marqueeIntersectsPath,
  nextLineShape,
  strokeIntersectsPath,
  type LinkPath,
} from "../src/links/lineGeometry";

describe("link pair rules", () => {
  it("allows one direction and kind per unordered pair, but permits cycles", () => {
    const existing = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];
    expect(canCreateLinkPair("b", "a", existing)).toBe(false);
    expect(canCreateLinkPair("a", "a", existing)).toBe(false);
    expect(canCreateLinkPair("c", "a", existing)).toBe(true);
  });

  it("allows ME as a source but never as a target", () => {
    expect(canCreateLinkPair("me", "a", [])).toBe(true);
    expect(canCreateLinkPair("a", "me", [])).toBe(false);
  });
});

describe("link anchors and line tool gestures", () => {
  it("projects note picks to a normalised frame edge and preserves them after move and scale", () => {
    const initialBounds = { x: 10, y: 20, width: 30, height: 12 };
    const anchor = projectPointToAnchor(initialBounds, { x: 39, y: 25 });
    expect(anchor).toEqual({ x: 1, y: 5 / 12 });
    expect(pointAtAnchor(initialBounds, anchor)).toEqual({ x: 40, y: 25 });

    const resizedAndMoved = { x: -4, y: 15, width: 60, height: 24 };
    expect(pointAtAnchor(resizedAndMoved, anchor)).toEqual({ x: 56, y: 25 });
    const endpoints = shapeEndpoints(
      resizedAndMoved,
      { x: 100, y: 10, width: 20, height: 30 },
      anchor,
    );
    expect(endpoints.start).toEqual({ x: 56, y: 25 });
    expect(endpoints.startNormal).toEqual({ x: 1, y: 0 });
  });

  it("places an ME route start on the 3.6u beacon circle toward the target", () => {
    const endpoint = pointOnCircleToward({ x: 0, y: 0 }, 3.6, { x: 8, y: 6 });
    expect(endpoint.point.x).toBeCloseTo(2.88);
    expect(endpoint.point.y).toBeCloseTo(2.16);
    expect(Math.hypot(endpoint.point.x, endpoint.point.y)).toBeCloseTo(3.6);
    expect(endpoint.normal).toEqual({ x: 0.8, y: 0.6 });
  });

  it("maps client pointers through the board rectangle and viewport into world coordinates", () => {
    const cameraState = { x: 4, y: -3, zoom: 2 };
    const viewportSize = { width: 900, height: 640 };
    const pointer = { x: 742, y: 511 };
    const boardRect = { left: 178, top: 93 };
    const boardPoint = clientToBoardPoint(pointer, boardRect);

    expect(boardPoint).toEqual({ x: 564, y: 418 });
    const firstWorld = clientToWorld(pointer, boardRect, cameraState, viewportSize);
    expect(firstWorld.x).toBeCloseTo(9.7);
    expect(firstWorld.y).toBeCloseTo(1.9);
    const secondWorld = clientToWorld(
      { x: 1022, y: 799 },
      { left: 458, top: 381 },
      cameraState,
      { width: 564, height: 418 },
    );
    expect(secondWorld.x).toBeCloseTo(18.1);
    expect(secondWorld.y).toBeCloseTo(7.45);
  });

  it("creates on drag-release over an object, keeps click-click, and cancels outside", () => {
    const start = completeLinkGesture({
      draft: null,
      clickedId: "a",
      clickedAnchor: { x: 1, y: 0.5 },
      moved: false,
      targetId: "a",
    });
    expect(start).toMatchObject({ kind: "start", draft: { sourceId: "a", sourceAnchor: { x: 1, y: 0.5 } } });

    expect(completeLinkGesture({
      draft: null,
      clickedId: "a",
      clickedAnchor: { x: 1, y: 0.5 },
      moved: true,
      targetId: "b",
      targetAnchor: { x: 0, y: 0.25 },
    })).toEqual({
      kind: "create", from: "a", to: "b", fromAnchor: { x: 1, y: 0.5 }, toAnchor: { x: 0, y: 0.25 },
    });

    expect(completeLinkGesture({ draft: null, clickedId: "a", moved: true, targetId: null })).toEqual({ kind: "cancel" });
    expect(completeLinkGesture({
      draft: { sourceId: "a", sourceAnchor: { x: 1, y: 0.5 } },
      clickedId: "b",
      moved: false,
      targetId: "b",
      targetAnchor: { x: 0, y: 0.25 },
    })).toMatchObject({ kind: "create", from: "a", to: "b" });
  });

  it("cycles an active line tool back to select and resolves right-button cuts", () => {
    expect(nextTool("line-strong", "line-strong")).toBe("select");
    expect(nextTool("line-weak", "line-strong")).toBe("line-strong");
    expect(resolveCutRelease(false, "link-1")).toBe("cut-link");
    expect(resolveCutRelease(false, null)).toBe("ignore");
    expect(resolveCutRelease(true, null)).toBe("cut-stroke");
  });

  it("uses a solid strong or dashed weak preview kind matching the active line tool", () => {
    expect(previewLinkKind("line-strong")).toBe("strong");
    expect(previewLinkKind("line-weak")).toBe("weak");
    expect(previewLinkKind("select")).toBeNull();
  });

  it.each(["base", "orthogonal", "zigzag", "wave"] as const)("builds %s geometry on clipped frame endpoints", (shape) => {
    const source = { x: 0, y: 0, width: 20, height: 10 };
    const target = { x: 60, y: 30, width: 24, height: 20 };
    const endpoints = shapeEndpoints(source, target);
    const built = buildShape(shape, endpoints);

    expect(built.path.startsWith("M ")).toBe(true);
    expect(built.polyline[0]).toEqual(endpoints.start);
    expect(built.polyline.at(-1)).toEqual(endpoints.end);
    expect(built.polyline.length).toBeGreaterThanOrEqual(2);
    expect(pointOnFrame(built.polyline[0], source)).toBe(true);
    expect(pointOnFrame(built.polyline.at(-1)!, target)).toBe(true);
    expect(Math.hypot(built.endTangent.x, built.endTangent.y)).toBeCloseTo(1);
    expect(strokeIntersectsPath(perpendicularStroke(built.polyline), {
      type: "polyline",
      points: built.polyline,
    })).toBe(true);
  });
});

describe("line geometry", () => {
  it("clips the endpoints to the facing borders of note frames", () => {
    expect(clipSegmentToFrames(
      { x: 0, y: 0, width: 10, height: 8 },
      { x: 20, y: 2, width: 10, height: 8 },
    )).toEqual({ start: { x: 10, y: 4.5 }, end: { x: 20, y: 5.5 } });
  });

  it("clips diagonal links to frame corners without reaching text centres", () => {
    const segment = clipSegmentToFrames(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 20, width: 10, height: 10 },
    );
    expect(segment.start).toEqual({ x: 10, y: 10 });
    expect(segment.end).toEqual({ x: 20, y: 20 });
  });

  it("cycles the line creation option through base, orthogonal, zigzag, and wave", () => {
    expect(nextLineShape("base")).toBe("orthogonal");
    expect(nextLineShape("orthogonal")).toBe("zigzag");
    expect(nextLineShape("zigzag")).toBe("wave");
    expect(nextLineShape("wave")).toBe("base");
  });

  it.each(["base", "orthogonal"] as const)("keeps %s endpoints clipped to note frames", (shape) => {
    const source = { x: 0, y: 0, width: 10, height: 8 };
    const target = { x: 24, y: 16, width: 12, height: 10 };
    const path = linePathBetweenFrames(shape, source, target);
    const [start, end] = endpoints(path);

    expect(pointOnFrame(start, source)).toBe(true);
    expect(pointOnFrame(end, target)).toBe(true);
  });

  it("uses a cubic route for base lines and axis-aligned elbows for orthogonal lines", () => {
    const source = { x: 0, y: 0, width: 10, height: 8 };
    const target = { x: 24, y: 16, width: 12, height: 10 };
    const curved = linePathBetweenFrames("base", source, target);
    const orthogonal = linePathBetweenFrames("orthogonal", source, target);

    expect(curved.type).toBe("cubic");
    expect(orthogonal.type).toBe("polyline");
    if (orthogonal.type === "polyline") {
      expect(orthogonal.points.length).toBeGreaterThanOrEqual(3);
      for (let index = 1; index < orthogonal.points.length; index += 1) {
        const previous = orthogonal.points[index - 1];
        const current = orthogonal.points[index];
        expect(previous.x === current.x || previous.y === current.y).toBe(true);
      }
    }
  });

  it("selects a polyline or curved route that touches or lies inside a marquee", () => {
    const straightRoute: LinkPath = { type: "polyline", points: [{ x: 0, y: 5 }, { x: 20, y: 5 }] };
    expect(marqueeIntersectsPath({ x: 8, y: 2, width: 2, height: 4 }, straightRoute)).toBe(true);
    expect(marqueeIntersectsPath({ x: 7, y: 6, width: 4, height: 2 }, straightRoute)).toBe(false);
    expect(marqueeIntersectsPath({ x: -1, y: 4, width: 22, height: 2 }, straightRoute)).toBe(true);
    const curve: LinkPath = {
      type: "cubic",
      points: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }],
    };
    expect(marqueeIntersectsPath({ x: 4, y: 7, width: 2, height: 2 }, curve)).toBe(true);
  });

  it.each(["base", "orthogonal"] as const)("intersects a drawn cut stroke against %s geometry", (shape) => {
    const path = linePathBetweenFrames(shape, { x: 0, y: 0, width: 10, height: 8 }, { x: 24, y: 16, width: 12, height: 10 });
    const route = flattenPath(path);
    const crossing = perpendicularStroke(route);

    expect(strokeIntersectsPath(crossing, path)).toBe(true);
    expect(strokeIntersectsPath([{ x: -100, y: -100 }, { x: -90, y: -100 }], path)).toBe(false);
  });
});

describe("cutting links", () => {
  const original: Link[] = [
    {
      id: "one", from: "a", to: "b", kind: "strong", shape: "wave",
      fromAnchor: { x: 1, y: 0.4 }, toAnchor: { x: 0, y: 0.6 },
    },
    { id: "two", from: "c", to: "d", kind: "weak", shape: "zigzag" },
    { id: "three", from: "e", to: "f", kind: "strong", shape: "base" },
  ];

  beforeEach(() => {
    clear();
    replaceLinks(original.map((link) => ({ ...link })));
    clearSelectedLink();
  });

  afterEach(() => {
    clear();
    clearSelectedLink();
  });

  it("toggles links into and out of the multi-selection", () => {
    toggleLinkSelection("one");
    toggleLinkSelection("two");
    expect(selectedLinkIds()).toEqual(["one", "two"]);
    toggleLinkSelection("one");
    expect(selectedLinkIds()).toEqual(["two"]);
    toggleLinkSelection("two");
    expect(selectedLinkIds()).toEqual([]);
  });

  it("records a selected line shape change as a reversible history operation", () => {
    expect(changeLinkShape("one", "orthogonal")).toBe(true);
    expect(links.byId.one.shape).toBe("orthogonal");
    expect(undo()?.label).toBe("Line shape");
    expect(links.byId.one.shape).toBe("wave");
    expect(redo()?.label).toBe("Line shape");
    expect(links.byId.one.shape).toBe("orthogonal");
  });

  it("cycles several selected line shapes in one undoable operation", () => {
    clearSelectedLink();
    selectLinks(["one", "two"]);
    expect(cycleLinkShapes(selectedLinkIds())).toBe(true);
    expect(links.byId.one.shape).toBe("base");
    expect(links.byId.two.shape).toBe("wave");
    expect(history.entries).toHaveLength(1);

    expect(undo()?.label).toBe("Line shape");
    expect(links.byId.one.shape).toBe("wave");
    expect(links.byId.two.shape).toBe("zigzag");
    expect(redo()?.label).toBe("Line shape");
    expect(links.byId.one.shape).toBe("base");
    expect(links.byId.two.shape).toBe("wave");
  });

  it("deletes all selected links as one history operation and undo restores them", () => {
    clearSelectedLink();
    selectLinks(["one", "two"]);
    expect(unlinkSelected()).toBe(true);
    expect(Object.keys(links.byId).sort()).toEqual(["three"]);
    expect(history.entries).toHaveLength(1);

    expect(undo()?.label).toBe("Unlink lines");
    expect(Object.values(links.byId).sort(byId)).toEqual([...original].sort(byId));
    expect(selectedLinkIds()).toEqual(["one", "two"]);
    expect(redo()?.label).toBe("Unlink lines");
    expect(Object.keys(links.byId)).toEqual(["three"]);
  });

  it("cuts multiple links as one operation and undo restores the exact ids and fields", () => {
    expect(cutLinks(["one", "two", "one", "missing"])).toBe(true);
    expect(Object.keys(links.byId).sort()).toEqual(["three"]);

    expect(undo()?.label).toBe("Cut lines");
    expect(Object.values(links.byId).sort(byId)).toEqual([...original].sort(byId));
  });
});

describe("ME beacon link rules", () => {
  afterEach(() => {
    clear();
    replaceBoard([]);
    replaceLinks([]);
  });

  it("records outgoing ME links while refusing incoming ones", () => {
    replaceBoard([{ id: "target", type: "note", name: "Target", text: "", x: 10, y: 0, width: 10, height: 8 }]);
    replaceLinks([]);
    const outgoing: Link = { id: "me-target", from: "me", to: "target", kind: "strong", shape: "base" };

    expect(createBoardLink(outgoing)).toBe(true);
    expect(links.byId[outgoing.id]).toEqual(outgoing);
    expect(createBoardLink({ ...outgoing, id: "target-me", from: "target", to: "me" })).toBe(false);
    expect(undo()?.label).toBe("Link");
    expect(links.byId[outgoing.id]).toBeUndefined();
    expect(redo()?.label).toBe("Link");
    expect(links.byId[outgoing.id]).toEqual(outgoing);
  });
});

function endpoints(path: LinkPath): [Point, Point] {
  return path.type === "cubic"
    ? [path.points[0], path.points[3]]
    : [path.points[0], path.points.at(-1)!];
}

function pointOnFrame(point: Point, bounds: { x: number; y: number; width: number; height: number }): boolean {
  const onHorizontal = Math.abs(point.y - bounds.y) < 1e-8 || Math.abs(point.y - (bounds.y + bounds.height)) < 1e-8;
  const onVertical = Math.abs(point.x - bounds.x) < 1e-8 || Math.abs(point.x - (bounds.x + bounds.width)) < 1e-8;
  return (onHorizontal && point.x >= bounds.x && point.x <= bounds.x + bounds.width) ||
    (onVertical && point.y >= bounds.y && point.y <= bounds.y + bounds.height);
}

function perpendicularStroke(route: readonly Point[]): Point[] {
  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-4) continue;
    const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const normal = { x: -dy / length, y: dx / length };
    return [
      { x: middle.x - normal.x * 5, y: middle.y - normal.y * 5 },
      { x: middle.x + normal.x * 5, y: middle.y + normal.y * 5 },
    ];
  }
  throw new Error("Expected a route with a non-zero segment");
}

function byId(left: Link, right: Link): number {
  return left.id.localeCompare(right.id);
}
