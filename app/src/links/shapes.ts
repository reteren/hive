import type { Point } from "../board/cameraMath";

export type LineShape = "straight" | "curved" | "orthogonal" | "wave" | "zigzag";

export interface ShapeInput {
  start: Point;
  end: Point;
  startNormal: Point;
  endNormal: Point;
}

export interface ShapeResult {
  path: string;
  polyline: Point[];
  endTangent: Point;
}

export interface ArrowGeometry {
  shaftPath: string;
  headPath: string;
  tip: Point;
  base: Point;
  tangent: Point;
}

const SHORT_LINE_LENGTH = 2.5;
const SHAPE_LEAD = 1;
const WAVE_PERIOD = 3;
const WAVE_AMPLITUDE = 0.75;
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

  if (!Number.isFinite(length) || length <= SHORT_LINE_LENGTH || shape === "straight") {
    return result([start, end], direction);
  }

  if (shape === "orthogonal") return buildOrthogonal(start, end, chord);

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
  };
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

function buildOrthogonal(start: Point, end: Point, chord: Point): ShapeResult {
  const middleX = start.x + chord.x / 2;
  if (!Number.isFinite(middleX)) return result([start, end], normalized(chord, { x: 1, y: 0 }));

  const points = compact([
    start,
    { x: middleX, y: start.y },
    { x: middleX, y: end.y },
    end,
  ]);
  return result(points, lastTangent(points, chord));
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
  return {
    path: smoothPathWithLeads(compactRoute),
    polyline: compactRoute,
    endTangent: normalized(subtract(curve.end, curve.control2), { x: 1, y: 0 }),
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
  return result(compact(points), normalized(subtract(curve.end, curve.control2), { x: 1, y: 0 }));
}

function cycleCount(length: number, availableSamples: number): number {
  const desired = Math.max(1, Math.round(length / WAVE_PERIOD));
  const maxCycles = Math.max(1, Math.floor(Math.max(1, availableSamples) / 8));
  return Math.min(desired, maxCycles);
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
