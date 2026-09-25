import { describe, expect, it } from "vitest";
import { rectContour } from "../src/model/zone";
import {
  contourToShape,
  dragSegment,
  dragVertex,
  hitEdge,
  hitVertex,
  insertCut,
  scaleByVertex,
  shapeToContour,
  type ContourEditOptions,
  type EditContour,
} from "../src/zones/contourEdit";
import { hasThinPiece, shapeArea, shapeBounds, type ZoneShape } from "../src/zones/shape";

const noObstacles: ContourEditOptions = { minPart: 30, obstacles: [] };

function rectangle(x = 0, y = 0, width = 100, height = 100): ZoneShape {
  return { parts: [rectContour(x, y, width, height)], holes: [] };
}

function leftCut(): EditContour {
  return insertCut(shapeToContour(rectangle(), false), { ring: 0, edge: 3 }, { x: 0, y: 50 });
}

function pointAt(contour: EditContour, x: number, y: number): boolean {
  return contour.rings.some((ring) => ring.points.some((point) => point.x === x && point.y === y));
}

describe("zone contour editing", () => {
  it("preserves collinear cut points while editing and cleans them on re-entry", () => {
    const cut = leftCut();
    expect(cut.rings[0].points).toHaveLength(5);
    expect(shapeToContour(contourToShape(cut), false).rings[0].points).toHaveLength(4);
    expect(shapeToContour(contourToShape(cut), true).rings[0].points).toHaveLength(4);
  });

  it("finds snapped edge hits strictly inside a segment and nearest vertices", () => {
    const contour = shapeToContour(rectangle(), false);
    expect(hitEdge(contour, { x: 0.5, y: 47 }, 2, 10)).toEqual({
      ring: 0,
      edge: 3,
      point: { x: 0, y: 50 },
      distance: 0.5,
    });
    expect(hitEdge(contour, { x: 0, y: 0 }, 1)).toBeNull();
    expect(hitVertex(contour, { x: 1, y: 1 }, 2)).toEqual({ ring: 0, vertex: 0 });
  });

  it("inserts a cut immutably and ignores endpoint or off-edge clicks", () => {
    const source = shapeToContour(rectangle(), false);
    const cut = insertCut(source, { ring: 0, edge: 3 }, { x: 0, y: 50 });
    expect(cut.rings[0].points).toHaveLength(5);
    expect(source.rings[0].points).toHaveLength(4);
    expect(insertCut(cut, { ring: 0, edge: 3 }, { x: 0, y: 100 })).toEqual(cut);
    expect(insertCut(source, { ring: 0, edge: 3 }, { x: 1, y: 50 })).toEqual(source);
  });

  it("implements H21: the upper segment moves the top edge up and the cut down only to a 30u strip", () => {
    const cut = leftCut();
    const up = dragSegment(cut, { ring: 0, edge: 4 }, { x: 0, y: -20 }, noObstacles);
    expect(pointAt(up, 0, 50)).toBe(true);
    expect(pointAt(up, 0, -20)).toBe(true);
    expect(pointAt(up, 100, -20)).toBe(true);

    const down = dragSegment(cut, { ring: 0, edge: 4 }, { x: 0, y: 80 }, noObstacles);
    const movedCut = down.rings[0].points.find((point) => point.x === 0 && point.y > 50 && point.y < 100);
    expect(movedCut?.y).toBeCloseTo(70, 4);
    expect(pointAt(down, 0, 100)).toBe(true);
    expect(hasThinPiece(contourToShape(down), 30)).toBe(false);
  });

  it("moves a cut-adjacent segment into a step or outward protrusion, enforcing 30u minimum", () => {
    const cut = leftCut();
    const step = dragSegment(cut, { ring: 0, edge: 4 }, { x: 35, y: 0 }, noObstacles);
    const protrusion = dragSegment(cut, { ring: 0, edge: 4 }, { x: -35, y: 0 }, noObstacles);
    expect(shapeArea(contourToShape(step))).toBe(8_250);
    expect(shapeArea(contourToShape(protrusion))).toBe(11_750);
    expect(dragSegment(cut, { ring: 0, edge: 4 }, { x: -20, y: 0 }, noObstacles)).toEqual(cut);

    const shortUpperCut = insertCut(shapeToContour(rectangle(), false), { ring: 0, edge: 3 }, { x: 0, y: 20 });
    expect(dragSegment(shortUpperCut, { ring: 0, edge: 4 }, { x: -35, y: 0 }, noObstacles)).toEqual(shortUpperCut);
  });

  it("leaves along-drag on an uncut corner-to-corner edge unchanged", () => {
    const source = shapeToContour(rectangle(), false);
    expect(dragSegment(source, { ring: 0, edge: 0 }, { x: 40, y: 0 }, noObstacles)).toEqual(source);
  });

  it("clamps an outward segment at an obstacle and permits touching its boundary", () => {
    const obstacle: ZoneShape = { parts: [rectContour(-80, 0, 50, 100)], holes: [] };
    const moved = dragSegment(leftCut(), { ring: 0, edge: 4 }, { x: -100, y: 0 }, { ...noObstacles, obstacles: [obstacle] });
    expect(shapeBounds(contourToShape(moved)).x).toBeCloseTo(-30, 4);
    expect(shapeArea(contourToShape(moved))).toBe(11_500);
  });

  it("snaps moved segment coordinates to the grid", () => {
    const moved = dragSegment(leftCut(), { ring: 0, edge: 4 }, { x: -33, y: 0 }, { ...noObstacles, snapStep: 10 });
    expect(pointAt(moved, -30, 50)).toBe(true);
    expect(shapeBounds(contourToShape(moved)).x).toBe(-30);
  });

  it("moves only a corner's two incident runs and keeps them orthogonal", () => {
    const source = shapeToContour(rectangle(), false);
    const moved = dragVertex(source, { ring: 0, vertex: 0 }, { x: -40, y: -20 }, noObstacles);
    expect(moved.rings[0].points).toEqual([
      { x: -40, y: -20 }, { x: 100, y: -20 }, { x: 100, y: 100 }, { x: -40, y: 100 },
    ]);
    expect(source.rings[0].points[0]).toEqual({ x: 0, y: 0 });
  });

  it("scales the whole contour around the opposite bounds corner and clamps its minimum size", () => {
    const source = shapeToContour(rectangle(), false);
    const grown = scaleByVertex(source, { ring: 0, vertex: 2 }, { x: 100, y: 50 }, noObstacles);
    expect(shapeBounds(contourToShape(grown))).toEqual({ x: 0, y: 0, width: 200, height: 150 });
    const shrunk = scaleByVertex(source, { ring: 0, vertex: 2 }, { x: -90, y: -90 }, noObstacles);
    expect(shapeBounds(contourToShape(shrunk))).toEqual({ x: 0, y: 0, width: 30, height: 30 });
  });

  it("clamps corner movement and whole-zone scaling before an obstacle", () => {
    const obstacle: ZoneShape = { parts: [rectContour(150, 0, 100, 100)], holes: [] };
    const source = shapeToContour(rectangle(), false);
    const options = { ...noObstacles, obstacles: [obstacle] };
    const corner = dragVertex(source, { ring: 0, vertex: 2 }, { x: 200, y: 0 }, options);
    const scaled = scaleByVertex(source, { ring: 0, vertex: 2 }, { x: 200, y: 0 }, options);
    expect(shapeBounds(contourToShape(corner)).width).toBeCloseTo(150, 4);
    expect(shapeBounds(contourToShape(scaled)).width).toBeCloseTo(150, 4);
  });
});
