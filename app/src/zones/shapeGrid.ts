import type { Point } from "../board/cameraMath";
import type { ZoneBounds } from "../model/zone";
import type { ZoneShape } from "./shape";

const COORDINATE_SCALE = 1_000_000;

export interface ShapeGrid {
  xs: number[];
  ys: number[];
  cells: boolean[][];
}

export function createShapeGrid(shapes: readonly ZoneShape[], extraRects: readonly ZoneBounds[] = []): ShapeGrid {
  const ringsByShape = shapes.map(getShapeRings);
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const rings of ringsByShape) {
    for (const ring of [...rings.parts, ...rings.holes]) {
      for (const point of ring) {
        xs.add(point.x);
        ys.add(point.y);
      }
    }
  }
  for (const rect of extraRects) {
    if (!isValidRect(rect)) continue;
    xs.add(roundCoordinate(rect.x));
    xs.add(roundCoordinate(rect.x + rect.width));
    ys.add(roundCoordinate(rect.y));
    ys.add(roundCoordinate(rect.y + rect.height));
  }

  const xCoordinates = [...xs].sort((a, b) => a - b);
  const yCoordinates = [...ys].sort((a, b) => a - b);
  const cells = Array.from({ length: Math.max(0, yCoordinates.length - 1) }, (_, row) =>
    Array.from({ length: Math.max(0, xCoordinates.length - 1) }, (_, column) => {
      const x = midpoint(xCoordinates[column], xCoordinates[column + 1]);
      const y = midpoint(yCoordinates[row], yCoordinates[row + 1]);
      return ringsByShape.some((rings) => isInsideShape(rings, x, y));
    }),
  );
  return { xs: xCoordinates, ys: yCoordinates, cells };
}

export function shapeFromGrid(grid: ShapeGrid): ZoneShape {
  const edges: BoundaryEdge[] = [];
  const rows = grid.cells.length;
  const columns = Math.max(0, grid.xs.length - 1);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (!grid.cells[row][column]) continue;
      if (!cellFilled(grid, row - 1, column)) addEdge(edges, column, row, column + 1, row, 0);
      if (!cellFilled(grid, row, column + 1)) addEdge(edges, column + 1, row, column + 1, row + 1, 1);
      if (!cellFilled(grid, row + 1, column)) addEdge(edges, column + 1, row + 1, column, row + 1, 2);
      if (!cellFilled(grid, row, column - 1)) addEdge(edges, column, row + 1, column, row, 3);
    }
  }

  const outgoing = new Map<string, BoundaryEdge[]>();
  for (const edge of edges) {
    const key = vertexKey(edge.sx, edge.sy);
    const matches = outgoing.get(key) ?? [];
    matches.push(edge);
    outgoing.set(key, matches);
  }

  const rings: Point[][] = [];
  for (const start of edges) {
    if (start.used) continue;
    const startKey = vertexKey(start.sx, start.sy);
    const points: Point[] = [{ x: grid.xs[start.sx], y: grid.ys[start.sy] }];
    let current: BoundaryEdge | undefined = start;
    let closed = false;
    for (let count = 0; current && count <= edges.length; count += 1) {
      current.used = true;
      points.push({ x: grid.xs[current.ex], y: grid.ys[current.ey] });
      const endKey = vertexKey(current.ex, current.ey);
      if (endKey === startKey) {
        closed = true;
        break;
      }
      current = chooseNextEdge(outgoing.get(endKey) ?? [], current.direction);
    }
    if (closed) {
      const ring = cleanRing(points);
      if (ring.length >= 4 && Math.abs(signedRingArea(ring)) > 0) rings.push(ring);
    }
  }

  const parts = rings.filter((ring) => signedRingArea(ring) > 0).map((ring) => canonicalRing(ring, true));
  const holes = rings.filter((ring) => signedRingArea(ring) < 0).map((ring) => canonicalRing(ring, false));
  parts.sort(compareRings);
  holes.sort(compareRings);
  return { parts, holes };
}

export function pruneGrid(grid: ShapeGrid, minPart: number): boolean {
  validateMinimum(minPart);
  if (minPart === 0) return grid.cells.some((row) => row.some(Boolean));
  let changed = true;
  while (changed) {
    changed = false;
    const remove = grid.cells.map((row) => row.map(() => false));

    for (let row = 0; row < grid.cells.length; row += 1) {
      let column = 0;
      while (column < grid.cells[row].length) {
        if (!grid.cells[row][column]) {
          column += 1;
          continue;
        }
        const start = column;
        while (column < grid.cells[row].length && grid.cells[row][column]) column += 1;
        if (grid.xs[column] - grid.xs[start] < minPart) {
          for (let item = start; item < column; item += 1) remove[row][item] = true;
        }
      }
    }

    const columns = Math.max(0, grid.xs.length - 1);
    for (let column = 0; column < columns; column += 1) {
      let row = 0;
      while (row < grid.cells.length) {
        if (!grid.cells[row][column]) {
          row += 1;
          continue;
        }
        const start = row;
        while (row < grid.cells.length && grid.cells[row][column]) row += 1;
        if (grid.ys[row] - grid.ys[start] < minPart) {
          for (let item = start; item < row; item += 1) remove[item][column] = true;
        }
      }
    }

    for (let row = 0; row < grid.cells.length; row += 1) {
      for (let column = 0; column < grid.cells[row].length; column += 1) {
        if (remove[row][column] && grid.cells[row][column]) {
          grid.cells[row][column] = false;
          changed = true;
        }
      }
    }
  }
  return grid.cells.some((row) => row.some(Boolean));
}

export function gridHasThinRun(grid: ShapeGrid, minPart: number): boolean {
  validateMinimum(minPart);
  if (minPart === 0) return false;

  for (let row = 0; row < grid.cells.length; row += 1) {
    let column = 0;
    while (column < grid.cells[row].length) {
      if (!grid.cells[row][column]) {
        column += 1;
        continue;
      }
      const start = column;
      while (column < grid.cells[row].length && grid.cells[row][column]) column += 1;
      if (grid.xs[column] - grid.xs[start] < minPart) return true;
    }
  }

  const columns = Math.max(0, grid.xs.length - 1);
  for (let column = 0; column < columns; column += 1) {
    let row = 0;
    while (row < grid.cells.length) {
      if (!grid.cells[row][column]) {
        row += 1;
        continue;
      }
      const start = row;
      while (row < grid.cells.length && grid.cells[row][column]) row += 1;
      if (grid.ys[row] - grid.ys[start] < minPart) return true;
    }
  }
  return false;
}

export function gridArea(grid: ShapeGrid, rect?: ZoneBounds): number {
  let area = 0;
  for (let row = 0; row < grid.cells.length; row += 1) {
    const y = midpoint(grid.ys[row], grid.ys[row + 1]);
    for (let column = 0; column < grid.cells[row].length; column += 1) {
      if (!grid.cells[row][column]) continue;
      const x = midpoint(grid.xs[column], grid.xs[column + 1]);
      if (rect && !(x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height)) continue;
      area += (grid.xs[column + 1] - grid.xs[column]) * (grid.ys[row + 1] - grid.ys[row]);
    }
  }
  return area;
}

export function pointInRing(point: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const a = ring[previous];
    const b = ring[current];
    if (pointOnSegment(point, a, b)) return true;
    if ((a.y > point.y) !== (b.y > point.y)) {
      const crossingX = a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (crossingX > point.x) inside = !inside;
    }
  }
  return inside;
}

export function pointInShapeStrict(rings: ShapeRings, point: Point): boolean {
  return rings.parts.some((ring) => pointInRingStrict(point, ring)) &&
    !rings.holes.some((ring) => pointInRingStrict(point, ring));
}

export function shapeRings(shape: ZoneShape): ShapeRings {
  return getShapeRings(shape);
}

export function cleanRing(points: readonly Point[]): Point[] {
  const ring: Point[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const next = { x: roundCoordinate(point.x), y: roundCoordinate(point.y) };
    if (!samePoint(ring.at(-1), next)) ring.push(next);
  }
  if (ring.length > 1 && samePoint(ring[0], ring.at(-1))) ring.pop();

  let changed = true;
  while (changed && ring.length >= 3) {
    changed = false;
    for (let index = 0; index < ring.length; index += 1) {
      const previous = ring[(index + ring.length - 1) % ring.length];
      const current = ring[index];
      const next = ring[(index + 1) % ring.length];
      if (samePoint(previous, current) || samePoint(current, next) ||
        (nearEqual(previous.x, current.x) && nearEqual(current.x, next.x)) ||
        (nearEqual(previous.y, current.y) && nearEqual(current.y, next.y))) {
        ring.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return ring;
}

export function roundCoordinate(value: number): number {
  const rounded = Math.round(value * COORDINATE_SCALE) / COORDINATE_SCALE;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function pointOnSegment(point: Point, first: Point, second: Point): boolean {
  if (first.x === second.x) {
    return point.x === first.x &&
      point.y >= Math.min(first.y, second.y) &&
      point.y <= Math.max(first.y, second.y);
  }
  if (first.y === second.y) {
    return point.y === first.y &&
      point.x >= Math.min(first.x, second.x) &&
      point.x <= Math.max(first.x, second.x);
  }
  return false;
}

export function sameCoordinate(first: number, second: number): boolean {
  return first === second;
}

export function ringArea(ring: readonly Point[]): number {
  return signedRingArea(ring);
}

export function canonicalRing(input: readonly Point[], clockwise: boolean): Point[] {
  const ring = cleanRing(input);
  if (ring.length < 3) return ring;
  const area = signedRingArea(ring);
  if ((area > 0) !== clockwise) ring.reverse();
  let start = 0;
  for (let index = 1; index < ring.length; index += 1) {
    if (ring[index].y < ring[start].y ||
      (nearEqual(ring[index].y, ring[start].y) && ring[index].x < ring[start].x)) start = index;
  }
  return [...ring.slice(start), ...ring.slice(0, start)];
}

export function compareRings(first: readonly Point[], second: readonly Point[]): number {
  const a = ringSortKey(first);
  const b = ringSortKey(second);
  return a.y - b.y || a.x - b.x || Math.abs(ringArea(second)) - Math.abs(ringArea(first));
}

export interface ShapeRings {
  parts: Point[][];
  holes: Point[][];
}

function getShapeRings(shape: ZoneShape): ShapeRings {
  return {
    parts: Array.isArray(shape?.parts) ? shape.parts.map(cleanRing).filter(isValidRing) : [],
    holes: Array.isArray(shape?.holes) ? shape.holes.map(cleanRing).filter(isValidRing) : [],
  };
}

function isValidRing(ring: readonly Point[]): boolean {
  if (ring.length < 4 || Math.abs(signedRingArea(ring)) <= 0) return false;
  return ring.every((point, index) => {
    const next = ring[(index + 1) % ring.length];
    return sameCoordinate(point.x, next.x) || sameCoordinate(point.y, next.y);
  });
}

function isValidRect(rect: ZoneBounds): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}

function isInsideShape(rings: ShapeRings, x: number, y: number): boolean {
  return rings.parts.some((ring) => pointInRingStrict({ x, y }, ring)) &&
    !rings.holes.some((ring) => pointInRingStrict({ x, y }, ring));
}

function pointInRingStrict(point: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const a = ring[previous];
    const b = ring[current];
    if ((a.y > point.y) !== (b.y > point.y)) {
      const crossingX = a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (crossingX > point.x) inside = !inside;
    }
  }
  return inside;
}

function signedRingArea(ring: readonly Point[]): number {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function addEdge(edges: BoundaryEdge[], sx: number, sy: number, ex: number, ey: number, direction: number): void {
  edges.push({ sx, sy, ex, ey, direction, used: false });
}

function chooseNextEdge(edges: readonly BoundaryEdge[], incomingDirection: number): BoundaryEdge | undefined {
  const priority = [1, 0, 3, 2];
  return edges
    .filter((edge) => !edge.used)
    .sort((first, second) =>
      priority.indexOf((first.direction - incomingDirection + 4) % 4) -
        priority.indexOf((second.direction - incomingDirection + 4) % 4) || first.direction - second.direction,
    )[0];
}

function cellFilled(grid: ShapeGrid, row: number, column: number): boolean {
  return row >= 0 && row < grid.cells.length && column >= 0 && column < grid.cells[row].length && grid.cells[row][column];
}

function vertexKey(x: number, y: number): string {
  return `${x},${y}`;
}

function samePoint(first: Point | undefined, second: Point | undefined): boolean {
  return Boolean(first && second && sameCoordinate(first.x, second.x) && sameCoordinate(first.y, second.y));
}

function nearEqual(first: number, second: number): boolean {
  return first === second;
}

function midpoint(first: number, second: number): number {
  return first + (second - first) / 2;
}

function validateMinimum(minPart: number): void {
  if (!Number.isFinite(minPart) || minPart < 0) {
    throw new RangeError("Minimum zone part must be a non-negative finite number.");
  }
}

function ringSortKey(ring: readonly Point[]): Point {
  return ring.reduce((minimum, point) =>
    point.y < minimum.y || (nearEqual(point.y, minimum.y) && point.x < minimum.x) ? point : minimum,
  ring[0] ?? { x: 0, y: 0 });
}

interface BoundaryEdge {
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  /** E, S, W, N in screen coordinates. Increasing direction turns clockwise. */
  direction: number;
  used: boolean;
}
