import type { Point } from "../board/cameraMath";
import { snapToGrid } from "../board/gridMath";
import type { HistoryCommand } from "../history/history.svelte";
import { addZone, removeZone, zones } from "../model/zones.svelte";
import { rectContour, zoneBounds, type Zone, type ZoneBounds } from "../model/zone";
import { resizeEdgeAxes, type ResizeEdge } from "../selection/resize";
import { MIN_ZONE_SIZE } from "./geometry";

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
  obstacles: ZoneBounds[];
  startWorld: Point;
  blocked: boolean;
}

export interface ZoneResizeGesture {
  beforeZone: Zone;
  afterZone: Zone;
  obstacles: ZoneBounds[];
  edge: ResizeEdge;
  startWorld: Point;
  blocked: boolean;
}

export function isRectZone(zone: Zone): boolean {
  if (zone.parts.length !== 1 || zone.holes.length !== 0 || zone.parts[0].length !== 4) return false;
  const bounds = zoneBounds(zone);
  return zone.parts[0].every((point, index) => {
    const corner = rectContour(bounds.x, bounds.y, bounds.width, bounds.height)[index];
    return point.x === corner.x && point.y === corner.y;
  });
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
    obstacles: obstacles.map(zoneBounds),
    startWorld: { ...startWorld },
    blocked: false,
  };
}

export function updateZoneMoveGesture(
  gesture: ZoneMoveGesture,
  cursorWorld: Point,
  snap: boolean,
  step: number,
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
  const applied = moveAroundObstacles(before, desired, gesture.obstacles);
  return {
    ...gesture,
    afterZone: translateZone(gesture.beforeZone, applied),
    afterMembers: gesture.beforeMembers.map((member) => ({
      ...member, x: member.x + applied.x, y: member.y + applied.y,
    })),
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
    obstacles: obstacles.map(zoneBounds),
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
  const a = before.parts.flat();
  const b = after.parts.flat();
  return a.length !== b.length || a.some((point, index) => point.x !== b[index].x || point.y !== b[index].y);
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

function translateZone(zone: Zone, delta: Point): Zone {
  return {
    ...copyZone(zone),
    parts: zone.parts.map((part) => part.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y }))),
    holes: zone.holes.map((hole) => hole.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y }))),
  };
}

function copyZone(zone: Zone): Zone {
  return {
    ...zone,
    parts: zone.parts.map((part) => part.map((point) => ({ ...point }))),
    holes: zone.holes.map((hole) => hole.map((point) => ({ ...point }))),
  };
}

function moveAroundObstacles(
  before: ZoneBounds,
  desired: Point,
  obstacles: readonly ZoneBounds[],
): Point {
  const xy = moveInOrder(before, desired, obstacles, "xy");
  const yx = moveInOrder(before, desired, obstacles, "yx");
  return distanceSquared(xy, desired) <= distanceSquared(yx, desired) ? xy : yx;
}

function moveInOrder(
  before: ZoneBounds,
  desired: Point,
  obstacles: readonly ZoneBounds[],
  order: "xy" | "yx",
): Point {
  let bounds = { ...before };
  let applied = { x: 0, y: 0 };
  for (const axis of axisOrder(order)) {
    const amount = clampMoveAxis(bounds, axis, desired[axis], obstacles);
    bounds = { ...bounds, [axis]: bounds[axis] + amount };
    applied = { ...applied, [axis]: amount };
  }
  return applied;
}

function clampMoveAxis(bounds: ZoneBounds, axis: "x" | "y", desired: number, obstacles: readonly ZoneBounds[]): number {
  let allowed = desired;
  const other = axis === "x" ? "y" : "x";
  const size = axis === "x" ? "width" : "height";
  const otherSize = axis === "x" ? "height" : "width";
  for (const obstacle of obstacles) {
    if (!intervalsOverlap(bounds[other], bounds[other] + bounds[otherSize], obstacle[other], obstacle[other] + obstacle[otherSize])) continue;
    if (desired > 0 && obstacle[axis] >= bounds[axis] + bounds[size]) {
      allowed = Math.min(allowed, obstacle[axis] - (bounds[axis] + bounds[size]));
    } else if (desired < 0 && obstacle[axis] + obstacle[size] <= bounds[axis]) {
      allowed = Math.max(allowed, obstacle[axis] + obstacle[size] - bounds[axis]);
    }
  }
  return allowed;
}

function resizeAroundObstacles(
  before: ZoneBounds,
  desired: ZoneBounds,
  axes: ReturnType<typeof resizeEdgeAxes>,
  obstacles: readonly ZoneBounds[],
): ZoneBounds {
  const xy = resizeInOrder(before, desired, axes, obstacles, "xy");
  const yx = resizeInOrder(before, desired, axes, obstacles, "yx");
  return boundsDistanceSquared(xy, desired) <= boundsDistanceSquared(yx, desired) ? xy : yx;
}

function resizeInOrder(
  before: ZoneBounds,
  desired: ZoneBounds,
  axes: ReturnType<typeof resizeEdgeAxes>,
  obstacles: readonly ZoneBounds[],
  order: "xy" | "yx",
): ZoneBounds {
  let result = { ...before };
  for (const axis of axisOrder(order)) {
    const edge = axis === "x" ? axes.horizontal : axes.vertical;
    if (!edge) continue;
    const size = axis === "x" ? "width" : "height";
    const other = axis === "x" ? "y" : "x";
    const otherSize = axis === "x" ? "height" : "width";
    const currentStart = result[axis];
    const currentEnd = currentStart + result[size];
    const desiredStart = desired[axis];
    const desiredEnd = desiredStart + desired[size];
    let next = edge === "right" || edge === "bottom" ? desiredEnd : desiredStart;
    const expanding = edge === "right" || edge === "bottom"
      ? next > currentEnd
      : next < currentStart;
    if (expanding) {
      for (const obstacle of obstacles) {
        if (!intervalsOverlap(result[other], result[other] + result[otherSize], obstacle[other], obstacle[other] + obstacle[otherSize])) continue;
        if (edge === "right" || edge === "bottom") {
          if (obstacle[axis] >= currentEnd) next = Math.min(next, obstacle[axis]);
        } else if (obstacle[axis] + obstacle[size] <= currentStart) {
          next = Math.max(next, obstacle[axis] + obstacle[size]);
        }
      }
    }
    if (edge === "right" || edge === "bottom") {
      result = { ...result, [size]: next - currentStart };
    } else {
      result = { ...result, [axis]: next, [size]: currentEnd - next };
    }
  }
  return result;
}

function intervalsOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
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
