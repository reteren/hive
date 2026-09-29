import type { Point } from "../board/cameraMath";
import { snapToGrid } from "../board/gridMath";
import type { HistoryCommand } from "../history/history.svelte";
import { addZone, removeZone, zones } from "../model/zones.svelte";
import { rectContour, zoneBounds, type Zone, type ZoneBounds } from "../model/zone";
import { resizeEdgeAxes, type ResizeEdge } from "../selection/resize";
import { MIN_ZONE_SIZE } from "./geometry";
import { roundCoordinate } from "./shapeGrid";
import { shapesOverlap, translateShape } from "./shape";

export interface MemberPosition {
  id: string;
  x: number;
  y: number;
}

export interface ZoneMoveGesture {
  beforeZone: Zone;
  afterZone: Zone;
  beforeBounds: ZoneBounds;
  beforeIsRect: boolean;
  beforeMembers: MemberPosition[];
  afterMembers: MemberPosition[];
  obstacles: Zone[];
  obstacleBounds: ZoneBounds[];
  obstacleIsRect: boolean[];
  startWorld: Point;
  offset: Point;
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
  const obstacleCopies = obstacles.map(copyZone);
  const beforeMembers = membersAtStart.map((member) => ({ ...member }));
  return {
    beforeZone,
    afterZone: copyZone(beforeZone),
    beforeBounds: zoneBounds(beforeZone),
    beforeIsRect: isRectZone(beforeZone),
    beforeMembers,
    afterMembers: beforeMembers.map((member) => ({ ...member })),
    obstacles: obstacleCopies,
    obstacleBounds: obstacleCopies.map(zoneBounds),
    obstacleIsRect: obstacleCopies.map(isRectZone),
    startWorld: { ...startWorld },
    offset: { x: 0, y: 0 },
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
  const before = gesture.beforeBounds;
  let desired = {
    x: cursorWorld.x - gesture.startWorld.x,
    y: cursorWorld.y - gesture.startWorld.y,
  };
  if (snap) {
    const target = snapToGrid({ x: before.x + desired.x, y: before.y + desired.y }, step);
    desired = { x: target.x - before.x, y: target.y - before.y };
  }
  const applied = moveAroundObstacles(gesture, desired);
  return {
    ...gesture,
    afterZone: translateZone(gesture.beforeZone, applied),
    offset: applied,
    afterMembers: gesture.beforeMembers.map((member) => carryMembers
      ? { ...member, x: member.x + applied.x, y: member.y + applied.y }
      : { ...member }),
    blocked: applied.x !== desired.x || applied.y !== desired.y,
  };
}

/** Ctrl carries zone members; Ctrl+Alt explicitly disables snapping for that move. */
export function zoneMoveShouldSnap(gridSnap: boolean, carryMembers: boolean, alt: boolean): boolean {
  return carryMembers ? !alt : gridSnap;
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
  centered = false,
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
  if (centered) {
    const centerX = before.x + before.width / 2;
    const centerY = before.y + before.height / 2;
    if (axes.horizontal) {
      let handleX = (axes.horizontal === "right" ? before.x + before.width : before.x) + delta.x;
      if (snap) handleX = snapToGrid({ x: handleX, y: 0 }, step).x;
      const halfWidth = axes.horizontal === "right" ? handleX - centerX : centerX - handleX;
      desired.width = Math.max(minWidth, halfWidth * 2);
      desired.x = centerX - desired.width / 2;
    }
    if (axes.vertical) {
      let handleY = (axes.vertical === "bottom" ? before.y + before.height : before.y) + delta.y;
      if (snap) handleY = snapToGrid({ x: 0, y: handleY }, step).y;
      const halfHeight = axes.vertical === "bottom" ? handleY - centerY : centerY - handleY;
      desired.height = Math.max(minHeight, halfHeight * 2);
      desired.y = centerY - desired.height / 2;
    }
  } else {
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
  }

  const after = centered
    ? resizeCenteredAroundObstacles(before, desired, gesture.obstacles)
    : resizeAroundObstacles(before, desired, axes, gesture.obstacles);
  return {
    ...gesture,
    afterZone: scaleZoneShape(gesture.beforeZone, before, after),
    blocked: !sameBounds(after, desired),
  };
}

export function zoneGestureChanged(before: Zone, after: Zone): boolean {
  if (isRectZone(before) && isRectZone(after)) return !sameBounds(zoneBounds(before), zoneBounds(after));
  return JSON.stringify(before.parts) !== JSON.stringify(after.parts) ||
    JSON.stringify(before.holes) !== JSON.stringify(after.holes);
}

export function cancelZoneMoveGesture(gesture: ZoneMoveGesture): Pick<ZoneMoveGesture, "beforeZone" | "beforeMembers"> {
  return { beforeZone: gesture.beforeZone, beforeMembers: gesture.beforeMembers };
}

/** The preview is already applied; record both zone and captured members as one Undo step. */
export function zoneMoveHistoryCommand(
  gesture: ZoneMoveGesture,
  apply: (zone: Zone, members: readonly MemberPosition[]) => void,
): HistoryCommand | null {
  if (!zoneGestureChanged(gesture.beforeZone, gesture.afterZone)) return null;
  return {
    label: "Move zone",
    target: gesture.beforeZone.name,
    do: () => apply(gesture.afterZone, gesture.afterMembers),
    undo: () => apply(gesture.beforeZone, gesture.beforeMembers),
  };
}

/** Resize geometry is already previewed; undo and redo both return to its dedicated mode. */
export function zoneResizeHistoryCommand(
  gesture: ZoneResizeGesture,
  apply: (zone: Zone) => void,
  enterResizeMode: (zoneId: string) => void,
): HistoryCommand | null {
  if (!zoneGestureChanged(gesture.beforeZone, gesture.afterZone)) return null;
  const zoneId = gesture.beforeZone.id;
  return {
    label: "Resize zone",
    target: gesture.beforeZone.name,
    do: () => {
      apply(gesture.afterZone);
      enterResizeMode(zoneId);
    },
    undo: () => {
      apply(gesture.beforeZone);
      enterResizeMode(zoneId);
    },
  };
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

function moveAroundObstacles(gesture: ZoneMoveGesture, desired: Point): Point {
  const xy = moveInOrder(gesture, desired, "xy");
  const yx = moveInOrder(gesture, desired, "yx");
  return distanceSquared(xy, desired) <= distanceSquared(yx, desired) ? xy : yx;
}

function moveInOrder(gesture: ZoneMoveGesture, desired: Point, order: "xy" | "yx"): Point {
  const applied = { x: 0, y: 0 };
  for (const axis of axisOrder(order)) {
    const amount = desired[axis];
    if (amount === 0) continue;
    applied[axis] = amount * firstMoveCollisionFraction(gesture, applied, axis, amount);
  }
  return applied;
}

/** Translation preserves a zone's topology, so moving it does not need grid normalization. */
function translateZone(zone: Zone, delta: Point): Zone {
  if (delta.x === 0 && delta.y === 0) return zone;
  const moveRing = (ring: readonly Point[]) => ring.map((point) => ({
    x: roundCoordinate(point.x + delta.x),
    y: roundCoordinate(point.y + delta.y),
  }));
  return {
    ...zone,
    parts: zone.parts.map(moveRing),
    holes: zone.holes.map(moveRing),
  };
}

/** Collision samples use cached bounds and avoid the full shape grid for rectangle pairs. */
function firstMoveCollisionFraction(
  gesture: ZoneMoveGesture,
  applied: Point,
  axis: "x" | "y",
  amount: number,
): number {
  const startBounds = translatedBounds(gesture.beforeBounds, applied);
  const endOffset = { ...applied, [axis]: applied[axis] + amount };
  const endBounds = translatedBounds(gesture.beforeBounds, endOffset);
  const sweep = {
    x: Math.min(startBounds.x, endBounds.x),
    y: Math.min(startBounds.y, endBounds.y),
    width: Math.max(startBounds.x + startBounds.width, endBounds.x + endBounds.width) - Math.min(startBounds.x, endBounds.x),
    height: Math.max(startBounds.y + startBounds.height, endBounds.y + endBounds.height) - Math.min(startBounds.y, endBounds.y),
  };
  const nearby: number[] = [];
  for (let index = 0; index < gesture.obstacles.length; index += 1) {
    if (boundsOverlap(sweep, gesture.obstacleBounds[index])) nearby.push(index);
  }
  if (nearby.length === 0) return 1;

  const sourcePoints = [...gesture.beforeZone.parts.flat(), ...gesture.beforeZone.holes.flat()];
  const obstacleCoordinates = new Set<number>();
  for (const index of nearby) {
    const obstacle = gesture.obstacles[index];
    for (const ring of [...obstacle.parts, ...obstacle.holes]) {
      for (const point of ring) obstacleCoordinates.add(point[axis]);
    }
  }
  const coordinates = [...obstacleCoordinates];
  const fractions = new Set<number>([0, 1]);
  for (const point of sourcePoints) {
    const coordinate = point[axis] + applied[axis];
    for (const obstacleCoordinate of coordinates) {
      const fraction = (obstacleCoordinate - coordinate) / amount;
      if (fraction > 0 && fraction < 1) fractions.add(fraction);
    }
  }

  const sorted = [...fractions].sort((first, second) => first - second);
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const fraction = (sorted[index] + sorted[index + 1]) / 2;
    const offset = { ...applied, [axis]: applied[axis] + amount * fraction };
    const candidateBounds = translatedBounds(gesture.beforeBounds, offset);
    const candidate = translateZone(gesture.beforeZone, offset);
    for (const obstacleIndex of nearby) {
      const obstacleBounds = gesture.obstacleBounds[obstacleIndex];
      if (!boundsOverlap(candidateBounds, obstacleBounds)) continue;
      if (gesture.beforeIsRect && gesture.obstacleIsRect[obstacleIndex]) return sorted[index];
      if (shapesOverlap(candidate, gesture.obstacles[obstacleIndex])) return sorted[index];
    }
  }
  return 1;
}

function translatedBounds(bounds: ZoneBounds, delta: Point): ZoneBounds {
  const x = roundCoordinate(bounds.x + delta.x);
  const y = roundCoordinate(bounds.y + delta.y);
  const right = roundCoordinate(bounds.x + bounds.width + delta.x);
  const bottom = roundCoordinate(bounds.y + bounds.height + delta.y);
  return { x, y, width: right - x, height: bottom - y };
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

function resizeCenteredAroundObstacles(before: ZoneBounds, desired: ZoneBounds, obstacles: readonly Zone[]): ZoneBounds {
  if (obstacles.length === 0 || !rectBoundsOverlapAny(desired, obstacles)) return desired;
  const at = (fraction: number): ZoneBounds => ({
    x: before.x + (desired.x - before.x) * fraction,
    y: before.y + (desired.y - before.y) * fraction,
    width: before.width + (desired.width - before.width) * fraction,
    height: before.height + (desired.height - before.height) * fraction,
  });
  let allowed = 0;
  let blocked = 1;
  for (let index = 0; index < 40; index += 1) {
    const middle = (allowed + blocked) / 2;
    if (rectBoundsOverlapAny(at(middle), obstacles)) blocked = middle;
    else allowed = middle;
  }
  return at(allowed);
}

function rectBoundsOverlapAny(bounds: ZoneBounds, obstacles: readonly Zone[]): boolean {
  const rectangle: Zone = {
    id: "",
    name: "",
    color: "",
    parts: [rectContour(bounds.x, bounds.y, bounds.width, bounds.height)],
    holes: [],
  };
  return obstacles.some((obstacle) => shapesOverlap(rectangle, obstacle));
}

function scaleZoneShape(zone: Zone, before: ZoneBounds, after: ZoneBounds): Zone {
  const scaleX = before.width === 0 ? 1 : after.width / before.width;
  const scaleY = before.height === 0 ? 1 : after.height / before.height;
  const scaleRing = (ring: readonly Point[]) => ring.map((point) => ({
    x: roundCoordinate(after.x + (point.x - before.x) * scaleX),
    y: roundCoordinate(after.y + (point.y - before.y) * scaleY),
  }));
  return {
    ...copyZone(zone),
    parts: zone.parts.map(scaleRing),
    holes: zone.holes.map(scaleRing),
  };
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
