import type { Point } from "../board/cameraMath";

export type LineShape = "straight" | "curved" | "orthogonal" | "wave" | "zigzag";

export interface ShapeInput {
  start: Point;
  end: Point;
  startNormal: Point;
  endNormal: Point;
  sourceBounds?: ShapeBounds;
  targetBounds?: ShapeBounds;
}

export interface ShapeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShapeResult {
  path: string;
  polyline: Point[];
  endTangent: Point;
  /** Board-space arc-length ranges for shape-aligned weak-line dashes. */
  dashRanges?: Array<{ start: number; end: number }>;
}

export interface ArrowGeometry {
  shaftPath: string;
  headPath: string;
  tip: Point;
  base: Point;
  tangent: Point;
  shaftLength: number;
}

const SHORT_LINE_LENGTH = 2.5;
const SHAPE_LEAD = 1;
const WAVE_PERIOD = 3;
const WAVE_AMPLITUDE = 0.75;
const SHAPE_GAP_FRACTION = 0.22;
const ORTHOGONAL_STUB = 1.5;
const ORTHOGONAL_CLEARANCE = 0.3;
const SHAPE_MIN_LENGTH = SHAPE_LEAD * 2 + WAVE_PERIOD;
const SAMPLE_SPACING = 0.08;
const MAX_SAMPLES = 512;
const EPSILON = 1e-9;

/** Build SVG geometry and a sampled board-space route for a link. */
export function buildShape(shape: LineShape, input: ShapeInput): ShapeResult {
  const start = safePoint(input.start);
  const end = safePoint(input.end);
  const chord = subtract(end, start);
  const length = magnitude(chord);
  const direction = normalized(chord, { x: 1, y: 0 });

  if (!Number.isFinite(length) || length <= EPSILON) {
    return result([start, end], direction);
  }

  if (shape === "straight") return result([start, end], direction);
  if (length <= SHORT_LINE_LENGTH && shape !== "orthogonal") return result([start, end], direction);

  if (shape === "orthogonal") {
    return buildOrthogonal(start, end, chord, input.startNormal, input.endNormal, input.sourceBounds, input.targetBounds);
  }

  const curve = buildCurve(start, end, chord, input.startNormal, input.endNormal);
  if (shape === "curved") {
    const points = sampleCurve(curve, adaptiveCount(length, SAMPLE_SPACING));
    return cubicResult(curve, points, normalized(subtract(end, curve.control2), direction));
  }

  if (length < SHAPE_MIN_LENGTH) return result([start, end], direction);
  const leadCurve = buildLeadCurve(start, end, direction, input.startNormal, input.endNormal);
  if (shape === "wave") return buildWave(leadCurve);
  if (shape === "zigzag") return buildZigzag(leadCurve);

  return result([start, end], direction);
}

/** Build a world-space triangular arrowhead and stop its shaft at the head base. */
export function buildArrowGeometry(
  shape: LineShape,
  geometry: ShapeResult,
  headLength = 1.6,
  headWidth = 1.2,
): ArrowGeometry {
  const route = geometry.polyline.length > 0 ? geometry.polyline : [{ x: 0, y: 0 }];
  const tip = route[route.length - 1];
  const distances = cumulativeDistances(route);
  const totalLength = distances[distances.length - 1] ?? 0;
  const trimDistance = Math.min(Math.max(0, finite(headLength)), totalLength * 0.45);
  const base = pointAtDistance(route, distances, Math.max(0, totalLength - trimDistance));
  const shaftPoints = trimRoute(route, distances, Math.max(0, totalLength - trimDistance));
  const tangent = normalized(geometry.endTangent, lastTangent(route, { x: 1, y: 0 }));
  const normal = { x: -tangent.y, y: tangent.x };
  const halfWidth = Math.max(0, finite(headWidth)) / 2;
  const left = add(base, scale(normal, halfWidth));
  const right = subtract(base, scale(normal, halfWidth));
  const smooth = shape === "curved" || shape === "wave";

  return {
    shaftPath: smooth ? smoothPath(shaftPoints) : pathFromPoints(shaftPoints),
    headPath: `M ${tip.x} ${tip.y} L ${left.x} ${left.y} L ${right.x} ${right.y} Z`,
    tip,
    base,
    tangent,
    shaftLength: Math.max(0, totalLength - trimDistance),
  };
}

/** Build independent dash paths for wave/zigzag without breaking their defining bends. */
export function buildShapeDashPaths(
  shape: LineShape,
  geometry: ShapeResult,
  endDistance = Number.POSITIVE_INFINITY,
): string[] {
  if (shape !== "wave" && shape !== "zigzag") return [];
  const distances = cumulativeDistances(geometry.polyline);
  const ranges = geometry.dashRanges ?? [];
  const paths: string[] = [];
  const cutoff = Number.isFinite(endDistance) ? Math.max(0, endDistance) : Number.POSITIVE_INFINITY;

  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    const closesAtArrowBase = Number.isFinite(endDistance) && index === ranges.length - 1;
    const end = closesAtArrowBase ? Math.min(cutoff, distances.at(-1) ?? range.end) : Math.min(range.end, cutoff);
    if (end - range.start <= EPSILON) continue;
    const points = pointsBetweenDistances(geometry.polyline, distances, range.start, end);
    if (points.length < 2) continue;
    paths.push(shape === "wave" ? smoothPath(points) : pathFromPoints(points));
  }
  return paths;
}

function buildCurve(start: Point, end: Point, chord: Point, startNormal: Point, endNormal: Point): Cubic {
  const length = magnitude(chord);
  const direction = normalized(chord, { x: 1, y: 0 });
  const firstNormal = normalized(safeVector(startNormal), direction);
  const secondNormal = normalized(safeVector(endNormal), scale(direction, -1));
  const handle = clamp(length * 0.35, 1, 36);

  return {
    start,
    control1: add(start, scale(firstNormal, handle)),
    control2: add(end, scale(secondNormal, handle)),
    end,
  };
}

function buildLeadCurve(start: Point, end: Point, direction: Point, startNormal: Point, endNormal: Point): Cubic {
  const firstNormal = normalized(safeVector(startNormal), direction);
  const secondNormal = normalized(safeVector(endNormal), scale(direction, -1));
  const curveStart = add(start, scale(firstNormal, SHAPE_LEAD));
  const curveEnd = add(end, scale(secondNormal, SHAPE_LEAD));
  const chord = subtract(curveEnd, curveStart);
  const handle = clamp(magnitude(chord) * 0.35, 1, 36);

  return {
    start: curveStart,
    control1: add(curveStart, scale(firstNormal, handle)),
    control2: add(curveEnd, scale(secondNormal, handle)),
    end: curveEnd,
    leadStart: start,
    leadEnd: end,
  };
}

function buildOrthogonal(
  start: Point,
  end: Point,
  chord: Point,
  startNormal: Point,
  endNormal: Point,
  sourceBounds?: ShapeBounds,
  targetBounds?: ShapeBounds,
): ShapeResult {
  const fallback = normalized(chord, { x: 1, y: 0 });
  const sourceDirection = unit(startNormal, fallback);
  const targetDirection = unit(endNormal, scale(fallback, -1));
  const startStub = add(start, scale(sourceDirection, ORTHOGONAL_STUB));
  const endStub = add(end, scale(targetDirection, ORTHOGONAL_STUB));
  const obstacles = [sourceBounds, targetBounds]
    .filter((bounds): bounds is ShapeBounds => bounds !== undefined)
    .map((bounds) => expandBounds(bounds, ORTHOGONAL_CLEARANCE));
  const middle = routeOrthogonalStubs(startStub, endStub, sourceDirection, targetDirection, obstacles);
  const points = compact([start, startStub, ...middle, endStub, end]);
  return result(points, scale(targetDirection, -1));
}

function buildWave(curve: Cubic): ShapeResult {
  const base = sampleCurve(curve, adaptiveCount(magnitude(subtract(curve.end, curve.start)), SAMPLE_SPACING));
  const distances = cumulativeDistances(base);
  const length = distances[distances.length - 1];
  if (!Number.isFinite(length) || length <= EPSILON) return result([curve.start, curve.end], { x: 1, y: 0 });

  const cycles = cycleCount(length, base.length - 2);
  const points: Point[] = [];
  const rampLength = Math.min(0.35, length / 4);
  for (let index = 0; index < base.length; index += 1) {
    const point = base[index];
    const tangent = tangentAt(base, index);
    const normal = { x: -tangent.y, y: tangent.x };
    const position = distances[index];
    const envelope = smoothStep(Math.min(position, length - position) / rampLength);
    const phase = (2 * Math.PI * cycles * position) / length;
    const offset = WAVE_AMPLITUDE * Math.sin(phase) * envelope;
    points.push(add(point, scale(normal, offset)));
  }

  const route = [curve.leadStart ?? curve.start, curve.start, ...points, curve.end, curve.leadEnd ?? curve.end];
  const compactRoute = compact(route);
  const leadLength = magnitude(subtract(points[0], curve.leadStart ?? curve.start));
  const activeDistances = cumulativeDistances(points);
  const halfPeriod = length / (cycles * 2);
  const gapWidth = halfPeriod * SHAPE_GAP_FRACTION;
  const dashRanges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < cycles * 2; index += 1) {
    const startDistance = index * halfPeriod + gapWidth / 2;
    const endDistance = (index + 1) * halfPeriod - gapWidth / 2;
    dashRanges.push({
      start: index === 0 ? 0 : leadLength + mapDistance(distances, activeDistances, startDistance),
      end: leadLength + mapDistance(distances, activeDistances, endDistance),
    });
  }
  return {
    path: smoothPathWithLeads(compactRoute),
    polyline: compactRoute,
    endTangent: normalized(subtract(curve.end, curve.control2), { x: 1, y: 0 }),
    dashRanges,
  };
}

function buildZigzag(curve: Cubic): ShapeResult {
  const base = sampleCurve(curve, adaptiveCount(magnitude(subtract(curve.end, curve.start)), SAMPLE_SPACING));
  const distances = cumulativeDistances(base);
  const length = distances[distances.length - 1];
  if (!Number.isFinite(length) || length <= EPSILON) return result([curve.start, curve.end], { x: 1, y: 0 });

  const cycles = cycleCount(length, base.length - 2);
  const period = length / cycles;
  const stations: Array<{ distance: number; offset: number }> = [];
  for (let index = 0; index < cycles * 2; index += 1) {
    stations.push({
      distance: period * (index * 0.5 + 0.25),
      offset: index % 2 === 0 ? WAVE_AMPLITUDE : -WAVE_AMPLITUDE,
    });
  }

  const points: Point[] = [curve.leadStart ?? curve.start, curve.start];
  for (const station of stations) {
    const center = pointAtDistance(base, distances, station.distance);
    const direction = tangentAtDistance(base, distances, station.distance);
    const normal = { x: -direction.y, y: direction.x };
    points.push(add(center, scale(normal, station.offset)));
  }
  points.push(curve.end, curve.leadEnd ?? curve.end);
  const route = compact(points);
  const routeDistances = cumulativeDistances(route);
  const peakDistances = stations.map((_, index) => routeDistances[index + 2]);
  const dashRanges = peakDistances.map((peak, index) => {
    const previous = peakDistances[index - 1];
    const next = peakDistances[index + 1];
    const spacingBefore = previous === undefined ? next === undefined ? 0 : next - peak : peak - previous;
    const spacingAfter = next === undefined ? spacingBefore : next - peak;
    const start = index === 0 ? 0 : peak - spacingBefore / 2 + spacingBefore * SHAPE_GAP_FRACTION / 2;
    const end = peak + spacingAfter / 2 - spacingAfter * SHAPE_GAP_FRACTION / 2;
    return { start, end };
  });
  return {
    ...result(route, normalized(subtract(curve.end, curve.control2), { x: 1, y: 0 })),
    dashRanges,
  };
}

function cycleCount(length: number, availableSamples: number): number {
  const desired = Math.max(1, Math.round(length / WAVE_PERIOD));
  const maxCycles = Math.max(1, Math.floor(Math.max(1, availableSamples) / 8));
  return Math.min(desired, maxCycles);
}

function routeOrthogonalStubs(
  start: Point,
  end: Point,
  startNormal: Point,
  endNormal: Point,
  obstacles: readonly ShapeBounds[],
): Point[] {
  if (samePoint(start, end)) return [start, end];
  const minX = Math.min(start.x, end.x, ...obstacles.map(bounds => bounds.x));
  const maxX = Math.max(start.x, end.x, ...obstacles.map(bounds => bounds.x + bounds.width));
  const minY = Math.min(start.y, end.y, ...obstacles.map(bounds => bounds.y));
  const maxY = Math.max(start.y, end.y, ...obstacles.map(bounds => bounds.y + bounds.height));
  const padding = Math.max(2, Math.max(maxX - minX, maxY - minY) * 0.1);
  const xValues = uniqueSorted([
    start.x, end.x, (start.x + end.x) / 2,
    minX - padding, maxX + padding,
    ...obstacles.flatMap(bounds => [bounds.x, bounds.x + bounds.width]),
  ]);
  const yValues = uniqueSorted([
    start.y, end.y, (start.y + end.y) / 2,
    minY - padding, maxY + padding,
    ...obstacles.flatMap(bounds => [bounds.y, bounds.y + bounds.height]),
  ]);
  const nodes: Point[] = [];
  for (const x of xValues) {
    for (const y of yValues) {
      const point = { x, y };
      if (isInsideAny(point, obstacles)) continue;
      nodes.push(point);
    }
  }

  const findNode = (point: Point): number => nodes.findIndex(node => samePoint(node, point));
  const startIndex = findNode(start);
  const endIndex = findNode(end);
  if (startIndex < 0 || endIndex < 0) return [start, end];

  const adjacency: Array<Array<{ node: number; direction: number; length: number }>> = nodes.map(() => []);
  for (let first = 0; first < nodes.length; first += 1) {
    for (let second = first + 1; second < nodes.length; second += 1) {
      const direction = directionBetween(nodes[first], nodes[second]);
      if (direction < 0 || !isClear(nodes[first], nodes[second], obstacles)) continue;
      const length = magnitude(subtract(nodes[second], nodes[first]));
      adjacency[first].push({ node: second, direction, length });
      adjacency[second].push({ node: first, direction: (direction + 2) % 4, length });
    }
  }

  const initialDirection = cardinalDirection(startNormal);
  const requiredEndDirection = cardinalDirection(scale(endNormal, -1));
  const states = new Map<string, RouteState>();
  const initial: RouteState = {
    node: startIndex,
    direction: initialDirection,
    bends: 0,
    length: 0,
    previous: null,
    visited: false,
  };
  states.set(routeStateKey(initial.node, initial.direction), initial);

  while (true) {
    let current: RouteState | undefined;
    for (const state of states.values()) {
      if (state.visited) continue;
      if (!current || compareRouteCost(state, current) < 0) current = state;
    }
    if (!current) return [start, end];
    current.visited = true;

    if (current.node === endIndex && (requiredEndDirection < 0 || current.direction === requiredEndDirection)) {
      const route: Point[] = [];
      let cursor: RouteState | null = current;
      while (cursor) {
        route.push(nodes[cursor.node]);
        cursor = cursor.previous ? states.get(cursor.previous) ?? null : null;
      }
      return route.reverse();
    }

    for (const edge of adjacency[current.node]) {
      if (current.node === startIndex && initialDirection >= 0 && edge.direction !== initialDirection) continue;
      if (edge.node === endIndex && requiredEndDirection >= 0 && edge.direction !== requiredEndDirection) continue;
      const bends = current.bends + (current.direction >= 0 && current.direction !== edge.direction ? 1 : 0);
      const length = current.length + edge.length;
      const key = routeStateKey(edge.node, edge.direction);
      const previous = states.get(key);
      if (previous && compareCost(bends, length, previous.bends, previous.length) >= 0) continue;
      states.set(key, {
        node: edge.node,
        direction: edge.direction,
        bends,
        length,
        previous: routeStateKey(current.node, current.direction),
        visited: false,
      });
    }
  }
}

interface RouteState {
  node: number;
  /** E, S, W, N; -1 when the source is radial rather than axis aligned. */
  direction: number;
  bends: number;
  length: number;
  previous: string | null;
  visited: boolean;
}

function routeStateKey(node: number, direction: number): string {
  return `${node}:${direction}`;
}

function compareRouteCost(a: RouteState, b: RouteState): number {
  return compareCost(a.bends, a.length, b.bends, b.length);
}

function compareCost(aBends: number, aLength: number, bBends: number, bLength: number): number {
  return aBends - bBends || aLength - bLength;
}

function directionBetween(start: Point, end: Point): number {
  if (Math.abs(start.y - end.y) <= EPSILON) return end.x >= start.x ? 0 : 2;
  if (Math.abs(start.x - end.x) <= EPSILON) return end.y >= start.y ? 1 : 3;
  return -1;
}

function cardinalDirection(vector: Point): number {
  if (Math.abs(vector.x) > Math.abs(vector.y) && Math.abs(vector.y) <= EPSILON) return vector.x >= 0 ? 0 : 2;
  if (Math.abs(vector.y) > Math.abs(vector.x) && Math.abs(vector.x) <= EPSILON) return vector.y >= 0 ? 1 : 3;
  return -1;
}

function expandBounds(bounds: ShapeBounds, amount: number): ShapeBounds {
  return {
    x: bounds.x - amount,
    y: bounds.y - amount,
    width: bounds.width + amount * 2,
    height: bounds.height + amount * 2,
  };
}

function isInsideAny(point: Point, obstacles: readonly ShapeBounds[]): boolean {
  return obstacles.some(bounds => point.x > bounds.x + EPSILON && point.x < bounds.x + bounds.width - EPSILON &&
    point.y > bounds.y + EPSILON && point.y < bounds.y + bounds.height - EPSILON);
}

function isClear(start: Point, end: Point, obstacles: readonly ShapeBounds[]): boolean {
  return obstacles.every(bounds => {
    if (Math.abs(start.y - end.y) <= EPSILON) {
      return !(start.y > bounds.y + EPSILON && start.y < bounds.y + bounds.height - EPSILON &&
        Math.max(Math.min(start.x, end.x), bounds.x + EPSILON) < Math.min(Math.max(start.x, end.x), bounds.x + bounds.width - EPSILON));
    }
    if (Math.abs(start.x - end.x) <= EPSILON) {
      return !(start.x > bounds.x + EPSILON && start.x < bounds.x + bounds.width - EPSILON &&
        Math.max(Math.min(start.y, end.y), bounds.y + EPSILON) < Math.min(Math.max(start.y, end.y), bounds.y + bounds.height - EPSILON));
    }
    return false;
  });
}

function uniqueSorted(values: number[]): number[] {
  return values.filter(Number.isFinite).sort((a, b) => a - b).filter((value, index, sorted) =>
    index === 0 || Math.abs(value - sorted[index - 1]) > EPSILON);
}

function sampleCurve(curve: Cubic, count: number): Point[] {
  const points: Point[] = [];
  for (let index = 0; index <= count; index += 1) {
    if (index === 0) points.push(curve.start);
    else if (index === count) points.push(curve.end);
    else points.push(cubicPoint(curve, index / count));
  }
  return points;
}

function cubicPoint(curve: Cubic, t: number): Point {
  const inverse = 1 - t;
  const inverseSquared = inverse * inverse;
  const tSquared = t * t;
  return {
    x: inverseSquared * inverse * curve.start.x + 3 * inverseSquared * t * curve.control1.x +
      3 * inverse * tSquared * curve.control2.x + tSquared * t * curve.end.x,
    y: inverseSquared * inverse * curve.start.y + 3 * inverseSquared * t * curve.control1.y +
      3 * inverse * tSquared * curve.control2.y + tSquared * t * curve.end.y,
  };
}

function result(points: Point[], fallbackTangent: Point): ShapeResult {
  const route = points.length > 0 ? points : [{ x: 0, y: 0 }];
  return {
    path: pathFromPoints(route),
    polyline: route,
    endTangent: lastTangent(route, fallbackTangent),
  };
}

function cubicResult(curve: Cubic, points: Point[], endTangent: Point): ShapeResult {
  return {
    path: `M ${curve.start.x} ${curve.start.y} C ${curve.control1.x} ${curve.control1.y}, ${curve.control2.x} ${curve.control2.y}, ${curve.end.x} ${curve.end.y}`,
    polyline: points,
    endTangent,
  };
}

function pathFromPoints(points: readonly Point[]): string {
  const route = points.length > 0 ? points : [{ x: 0, y: 0 }];
  return route.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function smoothPath(points: readonly Point[]): string {
  if (points.length < 3) return pathFromPoints(points);
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const start = points[index];
    const end = points[index + 1];
    const next = points[Math.min(points.length - 1, index + 2)];
    const control1 = add(start, scale(subtract(end, previous), 1 / 6));
    const control2 = subtract(end, scale(subtract(next, start), 1 / 6));
    path += ` C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`;
  }
  return path;
}

function smoothPathWithLeads(points: readonly Point[]): string {
  if (points.length < 4) return pathFromPoints(points);
  let path = `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  for (let index = 1; index < points.length - 2; index += 1) {
    const previous = points[Math.max(1, index - 1)];
    const start = points[index];
    const end = points[index + 1];
    const next = points[Math.min(points.length - 2, index + 2)];
    const control1 = add(start, scale(subtract(end, previous), 1 / 6));
    const control2 = subtract(end, scale(subtract(next, start), 1 / 6));
    path += ` C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`;
  }
  const endLead = points[points.length - 1];
  return `${path} L ${endLead.x} ${endLead.y}`;
}

function trimRoute(points: readonly Point[], distances: readonly number[], endDistance: number): Point[] {
  if (points.length < 2) return [...points];
  const route: Point[] = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    if (distances[index] < endDistance - EPSILON) route.push(points[index]);
    else {
      route.push(pointAtDistance(points, distances, endDistance));
      break;
    }
  }
  if (route.length === 1) route.push(pointAtDistance(points, distances, endDistance));
  return compact(route);
}

function pointAtDistance(points: readonly Point[], distances: readonly number[], distance: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1 || distance <= 0) return points[0];
  const total = distances[distances.length - 1] ?? 0;
  if (distance >= total) return points[points.length - 1];

  for (let index = 1; index < distances.length; index += 1) {
    if (distances[index] < distance) continue;
    const segmentLength = distances[index] - distances[index - 1];
    const ratio = segmentLength <= EPSILON ? 0 : (distance - distances[index - 1]) / segmentLength;
    return interpolate(points[index - 1], points[index], ratio);
  }
  return points[points.length - 1];
}

function pointsBetweenDistances(
  points: readonly Point[],
  distances: readonly number[],
  startDistance: number,
  endDistance: number,
): Point[] {
  if (points.length < 2 || distances.length !== points.length) return [];
  const total = distances[distances.length - 1] ?? 0;
  const start = clamp(startDistance, 0, total);
  const end = clamp(endDistance, start, total);
  const segment = [pointAtDistance(points, distances, start)];
  for (let index = 1; index < points.length - 1; index += 1) {
    if (distances[index] > start + EPSILON && distances[index] < end - EPSILON) segment.push(points[index]);
  }
  segment.push(pointAtDistance(points, distances, end));
  return compact(segment);
}

function mapDistance(sourceDistances: readonly number[], targetDistances: readonly number[], value: number): number {
  if (sourceDistances.length < 2 || sourceDistances.length !== targetDistances.length) return value;
  const sourceEnd = sourceDistances[sourceDistances.length - 1];
  const bounded = clamp(value, 0, sourceEnd);
  for (let index = 1; index < sourceDistances.length; index += 1) {
    if (sourceDistances[index] + EPSILON < bounded) continue;
    const span = sourceDistances[index] - sourceDistances[index - 1];
    const ratio = span <= EPSILON ? 0 : (bounded - sourceDistances[index - 1]) / span;
    return targetDistances[index - 1] + (targetDistances[index] - targetDistances[index - 1]) * ratio;
  }
  return targetDistances[targetDistances.length - 1];
}

function tangentAtDistance(points: readonly Point[], distances: readonly number[], distance: number): Point {
  for (let index = 1; index < distances.length; index += 1) {
    if (distances[index] + EPSILON >= distance) {
      return normalized(subtract(points[index], points[index - 1]), { x: 1, y: 0 });
    }
  }
  return lastTangent(points, { x: 1, y: 0 });
}

function interpolate(start: Point, end: Point, ratio: number): Point {
  return add(start, scale(subtract(end, start), clamp(ratio, 0, 1)));
}

function lastTangent(points: readonly Point[], fallback: Point): Point {
  for (let index = points.length - 1; index > 0; index -= 1) {
    const segment = subtract(points[index], points[index - 1]);
    if (magnitude(segment) > EPSILON) return normalized(segment, normalized(fallback, { x: 1, y: 0 }));
  }
  return normalized(fallback, { x: 1, y: 0 });
}

function tangentAt(points: readonly Point[], index: number): Point {
  const before = points[Math.max(0, index - 1)];
  const after = points[Math.min(points.length - 1, index + 1)];
  return normalized(subtract(after, before), { x: 1, y: 0 });
}

function cumulativeDistances(points: readonly Point[]): number[] {
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    distances.push(distances[index - 1] + magnitude(subtract(points[index], points[index - 1])));
  }
  return distances;
}

function adaptiveCount(length: number, spacing: number): number {
  return clamp(Math.ceil(length / spacing), 8, MAX_SAMPLES);
}

function compact(points: Point[]): Point[] {
  return points.filter((point, index) => index === 0 || magnitude(subtract(point, points[index - 1])) > EPSILON);
}

function safePoint(point: Point | undefined): Point {
  return { x: finite(point?.x), y: finite(point?.y) };
}

function safeVector(point: Point | undefined): Point {
  return { x: finite(point?.x), y: finite(point?.y) };
}

function finite(value: number | undefined): number {
  return Number.isFinite(value) ? value as number : 0;
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(point: Point, amount: number): Point {
  return { x: point.x * amount, y: point.y * amount };
}

function magnitude(point: Point): number {
  return Math.hypot(point.x, point.y);
}

function normalized(point: Point, fallback: Point): Point {
  const length = magnitude(point);
  if (!Number.isFinite(length) || length <= EPSILON) {
    const fallbackLength = magnitude(fallback);
    return Number.isFinite(fallbackLength) && fallbackLength > EPSILON
      ? { x: fallback.x / fallbackLength, y: fallback.y / fallbackLength }
      : { x: 1, y: 0 };
  }
  return { x: point.x / length, y: point.y / length };
}

function unit(point: Point, fallback: Point): Point {
  return normalized(safeVector(point), fallback);
}

function samePoint(first: Point, second: Point): boolean {
  return Math.abs(first.x - second.x) <= EPSILON && Math.abs(first.y - second.y) <= EPSILON;
}

function smoothStep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface Cubic {
  start: Point;
  control1: Point;
  control2: Point;
  end: Point;
  leadStart?: Point;
  leadEnd?: Point;
}
