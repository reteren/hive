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

const SHORT_LINE_LENGTH = 2.5;
const WAVE_LENGTH = 2.5;
const WAVE_AMPLITUDE = 0.8;
const CURVE_SAMPLE_SPACING = 0.5;
const WAVE_SAMPLE_SPACING = 0.25;
const MAX_CURVE_SAMPLES = 192;
const MAX_WAVE_SAMPLES = 256;
const EPSILON = 1e-9;

/** Build SVG geometry and a sampled board-space route for a link. */
export function buildShape(shape: LineShape, input: ShapeInput): ShapeResult {
  const start = safePoint(input.start);
  const end = safePoint(input.end);
  const chord = subtract(end, start);
  const length = magnitude(chord);

  if (!Number.isFinite(length) || length <= SHORT_LINE_LENGTH || shape === "straight") {
    return result([start, end], normalized(chord, { x: 1, y: 0 }));
  }

  if (shape === "orthogonal") return buildOrthogonal(start, end, chord);

  const curve = buildCurve(start, end, chord, input.startNormal, input.endNormal);
  if (shape === "curved") {
    const points = sampleCurve(curve, adaptiveCount(length, CURVE_SAMPLE_SPACING, MAX_CURVE_SAMPLES));
    return cubicResult(curve, points, normalized(subtract(end, curve.control2), chordDirection(chord)));
  }
  if (shape === "wave") return buildWave(curve, length);
  if (shape === "zigzag") return buildZigzag(start, end, chord, length);

  return result([start, end], normalized(chord, { x: 1, y: 0 }));
}

function buildCurve(start: Point, end: Point, chord: Point, startNormal: Point, endNormal: Point) {
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

function buildWave(curve: Cubic, chordLength: number): ShapeResult {
  const count = adaptiveCount(chordLength, WAVE_SAMPLE_SPACING, MAX_WAVE_SAMPLES);
  const base = sampleCurve(curve, count);
  const distances = cumulativeDistances(base);
  const totalLength = distances[distances.length - 1];
  if (!Number.isFinite(totalLength) || totalLength <= SHORT_LINE_LENGTH) {
    return result([curve.start, curve.end], normalized(subtract(curve.end, curve.start), { x: 1, y: 0 }));
  }

  const wantedCycles = Math.max(1, Math.round(totalLength / WAVE_LENGTH));
  const cycles = Math.min(wantedCycles, Math.max(1, Math.floor(count / 8)));
  const points = base.map((point, index) => {
    if (index === 0) return curve.start;
    if (index === base.length - 1) return curve.end;

    const tangent = tangentAt(base, index);
    const normal = { x: -tangent.y, y: tangent.x };
    const phase = (2 * Math.PI * cycles * distances[index]) / totalLength;
    const offset = WAVE_AMPLITUDE * Math.sin(phase);
    return add(point, scale(normal, offset));
  });

  return result(points, lastTangent(points, subtract(curve.end, curve.start)));
}

function buildZigzag(start: Point, end: Point, chord: Point, length: number): ShapeResult {
  const direction = normalized(chord, { x: 1, y: 0 });
  const normal = { x: -direction.y, y: direction.x };
  const cycles = Math.max(1, Math.round(length / WAVE_LENGTH));
  const halfPeriod = length / (cycles * 2);
  const firstCorner = halfPeriod / 2;
  const points: Point[] = [start];
  let offset = 0;

  for (let station = firstCorner; station < length - firstCorner - EPSILON; station += halfPeriod) {
    const along = add(start, scale(direction, station));
    const nextOffset = offset === 0 ? WAVE_AMPLITUDE : -offset;
    points.push(add(along, scale(normal, offset)));
    points.push(add(along, scale(normal, nextOffset)));
    offset = nextOffset;
  }

  const endCorner = add(start, scale(direction, length - firstCorner));
  points.push(add(endCorner, scale(normal, offset)));
  points.push(endCorner);
  points.push(end);
  const compactPoints = compact(points);
  return result(compactPoints, lastTangent(compactPoints, chord));
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
  const exactPath = route.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  return {
    path: exactPath,
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

function adaptiveCount(length: number, spacing: number, max: number): number {
  return clamp(Math.ceil(length / spacing), 8, max);
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

function chordDirection(chord: Point): Point {
  return normalized(chord, { x: 1, y: 0 });
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface Cubic {
  start: Point;
  control1: Point;
  control2: Point;
  end: Point;
}
