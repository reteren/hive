import type { Point } from "../board/cameraMath";
import { snapToGrid } from "../board/gridMath";
import type { HistoryCommand } from "../history/history.svelte";
import { addZone, removeZone, zones } from "../model/zones.svelte";
import { rectContour, zoneBounds, type Zone, type ZoneBounds } from "../model/zone";
import { resizeEdgeAxes, type ResizeEdge } from "../selection/resize";
import { MIN_ZONE_SIZE } from "./geometry";
import { shapesOverlap, translateShape } from "./shape";

export interface MemberPosition {
  id: string;
  x: number;
  y: number;
}

export interface ZoneMoveGesture {
  beforeZone: Zone;
  afterZone: Zone;
  beforeMembers: MemberPosition[];
  afterMembers: MemberPosition[];
  obstacles: Zone[];
  startWorld: Point;
  blocked: boolean;
}

export interface ZoneResizeGesture {
  beforeZone: Zone;
  afterZone: Zone;
  obstacles: Zone[];
  edge: ResizeEdge;
  startWorld: Point;
  blocked: boolean;
}

export function isRectZone(zone: Zone): boolean {
  if (zone.parts.length !== 1 || zone.holes.length !== 0 || zone.parts[0].length !== 4) return false;
  const bounds = zoneBounds(zone);
  const corners = rectContour(bounds.x, bounds.y, bounds.width, bounds.height);
  return zone.parts[0].every((point) => corners.some((corner) => point.x === corner.x && point.y === corner.y));
}

export function createZoneMoveGesture(
  zone: Zone,
  obstacles: readonly Zone[],
  membersAtStart: readonly MemberPosition[],
  startWorld: Point,
): ZoneMoveGesture {
  const beforeZone = copyZone(zone);
  const beforeMembers = membersAtStart.map((member) => ({ ...member }));
  return {
    beforeZone,
    afterZone: copyZone(beforeZone),
    beforeMembers,
    afterMembers: beforeMembers.map((member) => ({ ...member })),
    obstacles: obstacles.map(copyZone),
    startWorld: { ...startWorld },
    blocked: false,
  };
}

export function updateZoneMoveGesture(
  gesture: ZoneMoveGesture,
  cursorWorld: Point,
  snap: boolean,
  step: number,
  carryMembers = true,
): ZoneMoveGesture {
  const before = zoneBounds(gesture.beforeZone);
  let desired = {
    x: cursorWorld.x - gesture.startWorld.x,
    y: cursorWorld.y - gesture.startWorld.y,
  };
  if (snap) {
    const target = snapToGrid({ x: before.x + desired.x, y: before.y + desired.y }, step);
    desired = { x: target.x - before.x, y: target.y - before.y };
  }
  const applied = moveAroundObstacles(gesture.beforeZone, desired, gesture.obstacles);
  return {
    ...gesture,
    afterZone: { ...copyZone(gesture.beforeZone), ...translateShape(gesture.beforeZone, applied) },
    afterMembers: gesture.beforeMembers.map((member) => carryMembers
      ? { ...member, x: member.x + applied.x, y: member.y + applied.y }
      : { ...member }),
    blocked: applied.x !== desired.x || applied.y !== desired.y,
  };
}

export function createZoneResizeGesture(
  zone: Zone,
  obstacles: readonly Zone[],
  edge: ResizeEdge,
  startWorld: Point,
): ZoneResizeGesture {
  const beforeZone = copyZone(zone);
  return {
    beforeZone,
    afterZone: copyZone(beforeZone),
    obstacles: obstacles.map(copyZone),
    edge,
    startWorld: { ...startWorld },
    blocked: false,
  };
}

export function updateZoneResizeGesture(
  gesture: ZoneResizeGesture,
  cursorWorld: Point,
  snap: boolean,
  step: number,
): ZoneResizeGesture {
  const before = zoneBounds(gesture.beforeZone);
  const axes = resizeEdgeAxes(gesture.edge);
  let desired = { ...before };
  const delta = {
    x: cursorWorld.x - gesture.startWorld.x,
    y: cursorWorld.y - gesture.startWorld.y,
  };
  // Existing persisted zones can be smaller than 30 u; let them stay as-is, but never shrink them.
  const minWidth = Math.min(MIN_ZONE_SIZE, before.width);
  const minHeight = Math.min(MIN_ZONE_SIZE, before.height);
  if (axes.horizontal === "right") {
    let right = before.x + before.width + delta.x;
    if (snap) right = snapToGrid({ x: right, y: 0 }, step).x;
    desired.width = Math.max(minWidth, right - before.x);
  } else if (axes.horizontal === "left") {
    let left = before.x + delta.x;
    if (snap) left = snapToGrid({ x: left, y: 0 }, step).x;
    desired.x = Math.min(left, before.x + before.width - minWidth);
    desired.width = before.x + before.width - desired.x;
  }
  if (axes.vertical === "bottom") {
    let bottom = before.y + before.height + delta.y;
    if (snap) bottom = snapToGrid({ x: 0, y: bottom }, step).y;
    desired.height = Math.max(minHeight, bottom - before.y);
  } else if (axes.vertical === "top") {
    let top = before.y + delta.y;
    if (snap) top = snapToGrid({ x: 0, y: top }, step).y;
    desired.y = Math.min(top, before.y + before.height - minHeight);
    desired.height = before.y + before.height - desired.y;
  }

  const after = resizeAroundObstacles(before, desired, axes, gesture.obstacles);
  return {
    ...gesture,
    afterZone: { ...copyZone(gesture.beforeZone), parts: [rectContour(after.x, after.y, after.width, after.height)] },
    blocked: !sameBounds(after, desired),
  };
}

export function zoneGestureChanged(before: Zone, after: Zone): boolean {
  if (isRectZone(before) && isRectZone(after)) return !sameBounds(zoneBounds(before), zoneBounds(after));
  return JSON.stringify(before.parts) !== JSON.stringify(after.parts) ||
    JSON.stringify(before.holes) !== JSON.stringify(after.holes);
}

/** The caller may combine this action with note deletion in one HistoryCommand. */
export function deleteZonesAction(zoneIds: readonly string[]): Pick<HistoryCommand, "do" | "undo"> {
  const indexed = zoneIds.flatMap((id) => {
    const zone = zones.byId[id];
    const index = zones.order.indexOf(id);
    return zone && index >= 0 ? [{ zone: copyZone(zone), index }] : [];
  });
  return {
    do: () => indexed.forEach(({ zone }) => removeZone(zone.id)),
    undo: () => indexed
      .slice()
      .sort((first, second) => first.index - second.index)
      .forEach(({ zone, index }) => addZone(copyZone(zone), index)),
  };
}

function copyZone(zone: Zone): Zone {
  return {
    ...zone,
    parts: zone.parts.map((part) => part.map((point) => ({ ...point }))),
    holes: zone.holes.map((hole) => hole.map((point) => ({ ...point }))),
  };
}

function moveAroundObstacles(before: Zone, desired: Point, obstacles: readonly Zone[]): Point {
  const xy = moveInOrder(before, desired, obstacles, "xy");
  const yx = moveInOrder(before, desired, obstacles, "yx");
  return distanceSquared(xy, desired) <= distanceSquared(yx, desired) ? xy : yx;
}

function moveInOrder(before: Zone, desired: Point, obstacles: readonly Zone[], order: "xy" | "yx"): Point {
  const applied = { x: 0, y: 0 };
  for (const axis of axisOrder(order)) {
    const amount = desired[axis];
    if (amount === 0) continue;
    const at = (fraction: number): Zone => ({
      ...before,
      ...translateShape(before, { ...applied, [axis]: amount * fraction }),
    });
    applied[axis] = amount * firstCollisionFraction(at, axis, obstacles);
  }
  return applied;
}

function resizeAroundObstacles(
  before: ZoneBounds,
  desired: ZoneBounds,
  axes: ReturnType<typeof resizeEdgeAxes>,
  obstacles: readonly Zone[],
): ZoneBounds {
  const xy = resizeInOrder(before, desired, axes, obstacles, "xy");
  const yx = resizeInOrder(before, desired, axes, obstacles, "yx");
  return boundsDistanceSquared(xy, desired) <= boundsDistanceSquared(yx, desired) ? xy : yx;
}

function resizeInOrder(
  before: ZoneBounds,
  desired: ZoneBounds,
  axes: ReturnType<typeof resizeEdgeAxes>,
  obstacles: readonly Zone[],
  order: "xy" | "yx",
): ZoneBounds {
  let result = { ...before };
  for (const axis of axisOrder(order)) {
    const edge = axis === "x" ? axes.horizontal : axes.vertical;
    if (!edge) continue;
    const size = axis === "x" ? "width" : "height";
    const currentStart = result[axis];
    const currentEnd = currentStart + result[size];
    const desiredStart = desired[axis];
    const desiredEnd = desiredStart + desired[size];
    const change = edge === "right" || edge === "bottom" ? desiredEnd - currentEnd : desiredStart - currentStart;
    if (change === 0) continue;
    const rectAt = (fraction: number): ZoneBounds => edge === "right" || edge === "bottom"
      ? { ...result, [size]: result[size] + change * fraction }
      : { ...result, [axis]: result[axis] + change * fraction, [size]: result[size] - change * fraction };
    const at = (fraction: number): Zone => ({
      id: "", name: "", color: "", holes: [], parts: [rectContour(...rectValues(rectAt(fraction)))],
    });
    result = rectAt(firstCollisionFraction(at, axis, obstacles));
  }
  return result;
}

function rectValues(rect: ZoneBounds): [number, number, number, number] {
  return [rect.x, rect.y, rect.width, rect.height];
}

/** Orthogonal overlap changes only when moving and obstacle vertex coordinates align. */
function firstCollisionFraction(at: (fraction: number) => Zone, axis: "x" | "y", obstacles: readonly Zone[]): number {
  if (obstacles.length === 0) return 1;
  const start = at(0);
  const end = at(1);
  const firstBounds = zoneBounds(start);
  const lastBounds = zoneBounds(end);
  const sweep = {
    x: Math.min(firstBounds.x, lastBounds.x),
    y: Math.min(firstBounds.y, lastBounds.y),
    width: Math.max(firstBounds.x + firstBounds.width, lastBounds.x + lastBounds.width) - Math.min(firstBounds.x, lastBounds.x),
    height: Math.max(firstBounds.y + firstBounds.height, lastBounds.y + lastBounds.height) - Math.min(firstBounds.y, lastBounds.y),
  };
  const nearby = obstacles.filter((zone) => boundsOverlap(sweep, zoneBounds(zone)));
  if (nearby.length === 0) return 1;
  const startPoints = [...start.parts.flat(), ...start.holes.flat()];
  const endPoints = [...end.parts.flat(), ...end.holes.flat()];
  const fractions = new Set<number>([0, 1]);
  const obstacleCoordinates = [...new Set(nearby.flatMap((zone) =>
    [...zone.parts.flat(), ...zone.holes.flat()].map((point) => point[axis])))];
  for (let index = 0; index < startPoints.length; index += 1) {
    const coordinate = startPoints[index][axis];
    const movement = endPoints[index][axis] - coordinate;
    if (movement === 0) continue;
    for (const obstacleCoordinate of obstacleCoordinates) {
      const fraction = (obstacleCoordinate - coordinate) / movement;
      if (fraction > 0 && fraction < 1) fractions.add(fraction);
    }
  }
  const sorted = [...fractions].sort((first, second) => first - second);
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const middle = (sorted[index] + sorted[index + 1]) / 2;
    const candidate = at(middle);
    if (nearby.some((obstacle) => shapesOverlap(candidate, obstacle))) return sorted[index];
  }
  return 1;
}

function boundsOverlap(first: ZoneBounds, second: ZoneBounds): boolean {
  return first.x < second.x + second.width && second.x < first.x + first.width &&
    first.y < second.y + second.height && second.y < first.y + first.height;
}

function axisOrder(order: "xy" | "yx"): Array<"x" | "y"> {
  return order === "xy" ? ["x", "y"] : ["y", "x"];
}

function distanceSquared(first: Point, second: Point): number {
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
}

function boundsDistanceSquared(first: ZoneBounds, second: ZoneBounds): number {
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2 +
    (first.width - second.width) ** 2 + (first.height - second.height) ** 2;
}

function sameBounds(first: ZoneBounds, second: ZoneBounds): boolean {
  return first.x === second.x && first.y === second.y &&
    first.width === second.width && first.height === second.height;
}
