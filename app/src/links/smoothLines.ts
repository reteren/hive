import type { Point } from "../board/cameraMath";
import { registerCommand } from "../commands/registry.svelte";
import { BEACON_SIZE } from "../model/note";
import { ME_OBJECT_ID, type Link, type LinkAnchor } from "../model/link";
import { board, updateNote } from "../model/board.svelte";
import { links, linksOf, registerLinkLifecycle, updateLink } from "../model/links.svelte";
import { execute } from "../history/history.svelte";
import { ME_POSITION } from "../board/camera.svelte";
import { noteBounds, type Bounds } from "../notes/layout.svelte";
import { registerSelectionInteractionListener, selection } from "../selection/selection.svelte";
import { selectedLinkIds } from "./selection.svelte";
import { anchorAlongRay, projectPointToAnchor, resolveLinkEndpoints, type SmoothLineAnchorSnapshot } from "./anchors";

interface SmoothEndpoint {
  bounds: Bounds;
  circular: boolean;
}

interface SmoothAnchors {
  fromAnchor?: LinkAnchor;
  toAnchor?: LinkAnchor;
}

type LinkSide = "from" | "to";
type FrameEdge = "top" | "right" | "bottom" | "left";

interface AnchorCandidate {
  linkId: string;
  side: LinkSide;
  edge: FrameEdge;
  desiredPosition: number;
  angle: number;
  polarAngle: number;
  targetCenter: Point;
}

interface AnchorGroup {
  bounds: Bounds;
  candidates: AnchorCandidate[];
}

interface FittingAnchor {
  edge: FrameEdge;
  anchor: LinkAnchor;
}

const MIN_ANCHOR_SPACING = 1;
const CORNER_CLEARANCE = 1;
const FRAME_EDGES: readonly FrameEdge[] = ["top", "right", "bottom", "left"];
const ADJACENT_EDGES: Record<FrameEdge, readonly FrameEdge[]> = {
  top: ["left", "right"],
  right: ["top", "bottom"],
  bottom: ["right", "left"],
  left: ["bottom", "top"],
};

let reflowQueued = false;

registerLinkLifecycle({
  onRestored: () => reflowSmoothLineAnchorsRaw(),
  onRemoved: () => queueSmoothReflow(),
});

registerSelectionInteractionListener((_noteIds, source) => {
  if (source === "move") reflowSmoothLineAnchorsRaw();
});

/** Smooth the links touching the requested objects, moving anchors only on those objects. */
export function smoothLinesForObjects(objectIds: readonly string[]): boolean {
  const ids = new Set(objectIds);
  if (ids.size === 0) return false;
  const affected = Object.values(links.byId).filter((link) => ids.has(link.from) || ids.has(link.to));
  return smoothLinks(affected, ids, objectIds.length === 1 ? objectName(objectIds[0]) : `${ids.size} objects`);
}

/** Toggle the persistent per-node smoothing state as one reversible history action. */
export function toggleSmoothLinesForNote(noteId: string): boolean {
  const note = board.notes[noteId];
  if (!note || note.type === "beacon") return false;

  const wasEnabled = note.smoothLines === true;
  const beforeSnapshot = copySmoothSnapshot(note.smoothLineAnchors);
  const affected = linksOf(noteId);
  const beforeLinks = affected.map((link) => ({ id: link.id, anchors: copyAnchors(link) }));
  let nextSnapshot: SmoothLineAnchorSnapshot | undefined;
  let afterLinks: Array<{ id: string; anchors: SmoothAnchors }>;

  if (!wasEnabled) {
    nextSnapshot = Object.create(null) as SmoothLineAnchorSnapshot;
    for (const link of affected) {
      const anchor = ownAnchor(link, noteId);
      nextSnapshot[link.id] = anchor ? { ...anchor } : null;
    }
    afterLinks = calculateSmoothLinkChanges(affected, new Set([noteId]), true);
  } else {
    const snapshot = note.smoothLineAnchors ?? {};
    afterLinks = affected.map((link) => {
      const anchors = copyAnchors(link);
      const saved = Object.prototype.hasOwnProperty.call(snapshot, link.id) ? snapshot[link.id] : null;
      setOwnAnchor(anchors, link, noteId, saved ? { ...saved } : undefined);
      return { id: link.id, anchors };
    });
  }

  const afterById = new Map(afterLinks.map((item) => [item.id, item.anchors]));
  const beforeById = new Map(beforeLinks.map((item) => [item.id, item.anchors]));
  const changedIds = new Set([...beforeById.keys(), ...afterById.keys()]);
  const changes = [...changedIds].flatMap((id) => {
    const previous = beforeById.get(id);
    const next = afterById.get(id);
    return previous && next && !anchorsEqual(previous, next) ? [{ id, previous, next }] : [];
  });
  const nextEnabled = !wasEnabled;
  execute({
    label: nextEnabled ? "Smooth lines" : "Remove smooth",
    target: note.name,
    do: () => {
      updateNote(noteId, {
        smoothLines: nextEnabled ? true : undefined,
        smoothLineAnchors: nextEnabled ? copySmoothSnapshot(nextSnapshot) : undefined,
      });
      changes.forEach(({ id, next }) => setAnchors(id, next));
    },
    undo: () => {
      updateNote(noteId, {
        smoothLines: wasEnabled ? true : undefined,
        smoothLineAnchors: copySmoothSnapshot(beforeSnapshot),
      });
      changes.forEach(({ id, previous }) => setAnchors(id, previous));
    },
  });
  return true;
}

/** Reflow all enabled notes after board geometry or link topology changes; anchors are derived state. */
export function reflowSmoothLineAnchorsRaw(): void {
  for (const noteId of board.order) {
    const note = board.notes[noteId];
    if (!note || note.smoothLines !== true || note.type === "beacon") continue;
    const affected = linksOf(noteId);
    if (affected.length === 0) continue;
    const snapshot = copySmoothSnapshot(note.smoothLineAnchors) ?? Object.create(null) as SmoothLineAnchorSnapshot;
    let snapshotChanged = false;
    for (const link of affected) {
      if (Object.prototype.hasOwnProperty.call(snapshot, link.id)) continue;
      snapshot[link.id] = null;
      snapshotChanged = true;
    }

    const changes = calculateSmoothLinkChanges(affected, new Set([noteId]), true);
    changes.forEach(({ id, anchors }) => setAnchors(id, anchors));
    if (snapshotChanged) updateNote(noteId, { smoothLineAnchors: snapshot });
  }
}

function queueSmoothReflow(): void {
  if (reflowQueued) return;
  reflowQueued = true;
  queueMicrotask(() => {
    reflowQueued = false;
    reflowSmoothLineAnchorsRaw();
  });
}

/** Smooth the selected links at both of their endpoints in one history action. */
export function smoothLinesForLinks(linkIds: readonly string[]): boolean {
  const ids = new Set(linkIds);
  const affected = Object.values(links.byId).filter((link) => ids.has(link.id));
  const endpointIds = new Set(affected.flatMap((link) => [link.from, link.to]));
  return smoothLinks(affected, endpointIds, affected.length === 1 ? `${objectName(affected[0].from)} → ${objectName(affected[0].to)}` : `${affected.length} lines`);
}

function smoothLinks(affected: readonly Link[], targetIds: ReadonlySet<string>, target: string): boolean {
  const changes = calculateSmoothLinkChanges(affected, targetIds, false);
  if (changes.length === 0) return false;

  const previousById = new Map(affected.map((link) => [link.id, copyAnchors(link)]));
  execute({
    label: "Smooth lines",
    target,
    do: () => changes.forEach(({ id, anchors }) => setAnchors(id, anchors)),
    undo: () => changes.forEach(({ id }) => {
      const previous = previousById.get(id);
      if (previous) setAnchors(id, previous);
    }),
  });
  return true;
}

function calculateSmoothLinkChanges(
  affected: readonly Link[],
  targetIds: ReadonlySet<string>,
  freezeOtherSides: boolean,
): Array<{ id: string; anchors: SmoothAnchors }> {
  const groups = new Map<string, AnchorGroup>();

  for (const link of affected) {
    for (const side of ["from", "to"] as const) {
      const objectId = side === "from" ? link.from : link.to;
      if (!targetIds.has(objectId)) continue;

      const endpoint = endpointFor(objectId);
      const otherEndpoint = endpointFor(side === "from" ? link.to : link.from);
      if (!endpoint || endpoint.circular || !otherEndpoint) continue;

      const targetCenter = boundsCenter(otherEndpoint.bounds);
      const facing = rayFacingAnchor(endpoint.bounds, targetCenter);
      const angle = Math.atan2(targetCenter.y - (endpoint.bounds.y + endpoint.bounds.height / 2), targetCenter.x - (endpoint.bounds.x + endpoint.bounds.width / 2));
      const candidate: AnchorCandidate = {
        linkId: link.id,
        side,
        edge: facing.edge,
        desiredPosition: edgeProgress(endpoint.bounds, facing.edge, facing.anchor),
        angle: angleForEdge(facing.edge, angle),
        polarAngle: angle,
        targetCenter,
      };
      const group = groups.get(objectId) ?? { bounds: endpoint.bounds, candidates: [] };
      group.candidates.push(candidate);
      groups.set(objectId, group);
    }
  }

  const nextById = new Map<string, SmoothAnchors>();
  for (const group of groups.values()) {
    if (!moveOverflowToAdjacentEdges(group.bounds, group.candidates)) continue;

    const byEdge = new Map<FrameEdge, AnchorCandidate[]>();
    for (const candidate of group.candidates) {
      const edgeCandidates = byEdge.get(candidate.edge) ?? [];
      edgeCandidates.push(candidate);
      byEdge.set(candidate.edge, edgeCandidates);
    }

    for (const [edge, candidates] of byEdge) {
      const length = edgeLength(group.bounds, edge);
      const minimum = CORNER_CLEARANCE;
      const maximum = length - CORNER_CLEARANCE;
      const ordered = [...candidates].sort((first, second) =>
        first.angle - second.angle || first.desiredPosition - second.desiredPosition || first.linkId.localeCompare(second.linkId),
      );
      const positions = spreadAlongEdge(ordered.map((candidate) => candidate.desiredPosition), minimum, maximum);

      ordered.forEach((candidate, index) => {
        const anchor = anchorAtPosition(group.bounds, edge, positions[index]);
        const next = nextById.get(candidate.linkId) ?? {};
        if (candidate.side === "from") next.fromAnchor = anchor;
        else next.toAnchor = anchor;
        nextById.set(candidate.linkId, next);
      });
    }
  }

  const changes = affected.flatMap((link) => {
    const next = nextById.get(link.id);
    if (!next) return [];
    const previous = copyAnchors(link);
    const merged = { ...previous, ...next };
    if (freezeOtherSides && targetedAnchorChanged(link, previous, merged, targetIds)) {
      const endpoints = renderedEndpoints(link);
      if (endpoints) {
        const from = endpointFor(link.from);
        const to = endpointFor(link.to);
        if (from && !targetIds.has(link.from) && !previous.fromAnchor) {
          merged.fromAnchor = from.circular
            ? anchorAlongRay(from.bounds, endpoints.start)
            : projectPointToAnchor(from.bounds, endpoints.start);
        }
        if (to && !targetIds.has(link.to) && !previous.toAnchor) {
          merged.toAnchor = to.circular
            ? anchorAlongRay(to.bounds, endpoints.end)
            : projectPointToAnchor(to.bounds, endpoints.end);
        }
      }
    }
    return anchorsEqual(previous, merged) ? [] : [{ id: link.id, anchors: merged }];
  });
  return changes;
}

function renderedEndpoints(link: Link) {
  const from = endpointFor(link.from);
  const to = endpointFor(link.to);
  return from && to
    ? resolveLinkEndpoints(from.bounds, to.bounds, link.fromAnchor, link.toAnchor, from.circular, to.circular)
    : null;
}

function targetedAnchorChanged(
  link: Link,
  previous: SmoothAnchors,
  next: SmoothAnchors,
  targetIds: ReadonlySet<string>,
): boolean {
  return targetIds.has(link.from) && !sameAnchor(previous.fromAnchor, next.fromAnchor) ||
    targetIds.has(link.to) && !sameAnchor(previous.toAnchor, next.toAnchor);
}

function sameAnchor(first?: LinkAnchor, second?: LinkAnchor): boolean {
  return first?.x === second?.x && first?.y === second?.y;
}

/** Pick the edge where the ray from this frame's centre exits the rectangle. */
function rayFacingAnchor(bounds: Bounds, target: Point): FittingAnchor {
  const center = boundsCenter(bounds);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (dx === 0 && dy === 0) return { edge: "top", anchor: { x: 0.5, y: 0 } };

  const horizontalExit = dx === 0 ? Number.POSITIVE_INFINITY : bounds.width / 2 / Math.abs(dx);
  const verticalExit = dy === 0 ? Number.POSITIVE_INFINITY : bounds.height / 2 / Math.abs(dy);
  // On an exact diagonal the side edge is preferable: it gives a clearer route for
  // neighbours that are mostly beside the node.
  if (horizontalExit <= verticalExit) {
    const edge: FrameEdge = dx >= 0 ? "right" : "left";
    const y = center.y + dy * horizontalExit;
    return {
      edge,
      anchor: { x: dx >= 0 ? 1 : 0, y: clamp01((y - bounds.y) / bounds.height) },
    };
  }

  const edge: FrameEdge = dy >= 0 ? "bottom" : "top";
  const x = center.x + dx * verticalExit;
  return {
    edge,
    anchor: { x: clamp01((x - bounds.x) / bounds.width), y: dy >= 0 ? 1 : 0 },
  };
}

/** Move only anchors that cannot fit at 1 u spacing to a closer adjacent edge. */
function moveOverflowToAdjacentEdges(bounds: Bounds, candidates: AnchorCandidate[]): boolean {
  const grouped = new Map<FrameEdge, AnchorCandidate[]>(FRAME_EDGES.map((edge) => [edge, []]));
  for (const candidate of candidates) grouped.get(candidate.edge)!.push(candidate);

  for (let attempt = 0; attempt < candidates.length * FRAME_EDGES.length; attempt += 1) {
    const crowdedEdge = FRAME_EDGES.find((edge) => grouped.get(edge)!.length > edgeCapacity(bounds, edge));
    if (!crowdedEdge) return true;

    let move: { candidate: AnchorCandidate; edge: FrameEdge; position: number; distance: number } | undefined;
    for (const candidate of grouped.get(crowdedEdge)!) {
      for (const edge of ADJACENT_EDGES[crowdedEdge]) {
        if (grouped.get(edge)!.length >= edgeCapacity(bounds, edge)) continue;
        const projected = closestPointOnEdge(bounds, edge, candidate.targetCenter);
        if (!move || projected.distance < move.distance) move = { candidate, edge, ...projected };
      }
    }
    if (!move) return false;

    grouped.set(crowdedEdge, grouped.get(crowdedEdge)!.filter((candidate) => candidate !== move!.candidate));
    move.candidate.edge = move.edge;
    move.candidate.desiredPosition = move.position;
    move.candidate.angle = angleForEdge(move.edge, move.candidate.polarAngle);
    grouped.get(move.edge)!.push(move.candidate);
  }
  return FRAME_EDGES.every((edge) => grouped.get(edge)!.length <= edgeCapacity(bounds, edge));
}

function edgeCapacity(bounds: Bounds, edge: FrameEdge): number {
  const length = edgeLength(bounds, edge);
  if (length < CORNER_CLEARANCE * 2) return 0;
  const span = length - CORNER_CLEARANCE * 2;
  return Math.floor(span / MIN_ANCHOR_SPACING + 1e-9) + 1;
}

function closestPointOnEdge(bounds: Bounds, edge: FrameEdge, target: Point): { position: number; distance: number } {
  const length = edgeLength(bounds, edge);
  const minimum = CORNER_CLEARANCE;
  const maximum = length - CORNER_CLEARANCE;
  let point: Point;
  let position: number;
  if (edge === "top") {
    point = { x: clamp(target.x, bounds.x + minimum, bounds.x + maximum), y: bounds.y };
    position = point.x - bounds.x;
  } else if (edge === "right") {
    point = { x: bounds.x + bounds.width, y: clamp(target.y, bounds.y + minimum, bounds.y + maximum) };
    position = point.y - bounds.y;
  } else if (edge === "bottom") {
    point = { x: clamp(target.x, bounds.x + minimum, bounds.x + maximum), y: bounds.y + bounds.height };
    position = bounds.x + bounds.width - point.x;
  } else {
    point = { x: bounds.x, y: clamp(target.y, bounds.y + minimum, bounds.y + maximum) };
    position = bounds.y + bounds.height - point.y;
  }
  return { position, distance: Math.hypot(point.x - target.x, point.y - target.y) };
}

/** Tightens desired positions to the minimum spacing while preserving angular order. */
function spreadAlongEdge(desired: readonly number[], minimum: number, maximum: number): number[] {
  if (desired.length === 0) return [];
  if (desired.length === 1) return [clamp(desired[0], minimum, maximum)];
  const spacing = MIN_ANCHOR_SPACING;
  const highestBase = maximum - spacing * (desired.length - 1);
  const adjusted = desired.map((position, index) => clamp(position, minimum, maximum) - index * spacing);
  const fitted = isotonicRegression(adjusted);
  return fitted.map((position, index) => clamp(position, minimum, highestBase) + index * spacing);
}

/** Pool-adjacent-violators regression keeps attachments ordered with minimal movement. */
function isotonicRegression(values: readonly number[]): number[] {
  const blocks: { start: number; end: number; sum: number; count: number }[] = [];
  values.forEach((value, index) => {
    blocks.push({ start: index, end: index + 1, sum: value, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1];
      const previous = blocks[blocks.length - 2];
      if (previous.sum / previous.count <= last.sum / last.count) break;
      blocks.splice(-2, 2, {
        start: previous.start,
        end: last.end,
        sum: previous.sum + last.sum,
        count: previous.count + last.count,
      });
    }
  });

  const result = Array<number>(values.length);
  for (const block of blocks) {
    const mean = block.sum / block.count;
    for (let index = block.start; index < block.end; index += 1) result[index] = mean;
  }
  return result;
}

function edgeProgress(bounds: Bounds, edge: FrameEdge, anchor: LinkAnchor): number {
  if (edge === "top") return anchor.x * bounds.width;
  if (edge === "right") return anchor.y * bounds.height;
  if (edge === "bottom") return (1 - anchor.x) * bounds.width;
  return (1 - anchor.y) * bounds.height;
}

function anchorAtPosition(bounds: Bounds, edge: FrameEdge, position: number): LinkAnchor {
  if (edge === "top") return { x: clamp(position / bounds.width, 0, 1), y: 0 };
  if (edge === "right") return { x: 1, y: clamp(position / bounds.height, 0, 1) };
  if (edge === "bottom") return { x: clamp(1 - position / bounds.width, 0, 1), y: 1 };
  return { x: 0, y: clamp(1 - position / bounds.height, 0, 1) };
}

function edgeLength(bounds: Bounds, edge: FrameEdge): number {
  return edge === "top" || edge === "bottom" ? bounds.width : bounds.height;
}

function angleForEdge(edge: FrameEdge, angle: number): number {
  return edge === "left" && angle < 0 ? angle + Math.PI * 2 : angle;
}

function endpointFor(id: string): SmoothEndpoint | null {
  if (id === ME_OBJECT_ID) {
    return {
      bounds: {
        x: ME_POSITION.x - BEACON_SIZE / 2,
        y: ME_POSITION.y - BEACON_SIZE / 2,
        width: BEACON_SIZE,
        height: BEACON_SIZE,
      },
      circular: true,
    };
  }
  const note = board.notes[id];
  return note ? { bounds: noteBounds(note), circular: note.type === "beacon" } : null;
}

function setAnchors(id: string, anchors: SmoothAnchors): void {
  updateLink(id, {
    fromAnchor: anchors.fromAnchor ? { ...anchors.fromAnchor } : undefined,
    toAnchor: anchors.toAnchor ? { ...anchors.toAnchor } : undefined,
  });
}

function ownAnchor(link: Link, noteId: string): LinkAnchor | undefined {
  if (link.from === noteId) return link.fromAnchor;
  if (link.to === noteId) return link.toAnchor;
  return undefined;
}

function setOwnAnchor(anchors: SmoothAnchors, link: Link, noteId: string, anchor?: LinkAnchor): void {
  if (link.from === noteId) anchors.fromAnchor = anchor;
  else if (link.to === noteId) anchors.toAnchor = anchor;
}

function copySmoothSnapshot(snapshot: SmoothLineAnchorSnapshot | undefined): SmoothLineAnchorSnapshot | undefined {
  if (!snapshot) return undefined;
  const copied = Object.create(null) as SmoothLineAnchorSnapshot;
  for (const [linkId, anchor] of Object.entries(snapshot)) copied[linkId] = anchor ? { ...anchor } : null;
  return copied;
}

function copyAnchors(link: Pick<Link, "fromAnchor" | "toAnchor">): SmoothAnchors {
  return {
    ...(link.fromAnchor ? { fromAnchor: { ...link.fromAnchor } } : {}),
    ...(link.toAnchor ? { toAnchor: { ...link.toAnchor } } : {}),
  };
}

function anchorsEqual(first: SmoothAnchors, second: SmoothAnchors): boolean {
  return first.fromAnchor?.x === second.fromAnchor?.x && first.fromAnchor?.y === second.fromAnchor?.y &&
    first.toAnchor?.x === second.toAnchor?.x && first.toAnchor?.y === second.toAnchor?.y;
}

function boundsCenter(bounds: Bounds): Point {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function objectName(id: string): string {
  return id === ME_OBJECT_ID ? "ME" : board.notes[id]?.name ?? "Note";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

registerCommand({
  id: "links.smoothLines",
  label: "Smooth lines",
  keys: [],
  run: () => {
    if (selection.ids.length > 0) smoothLinesForObjects(selection.ids);
    else smoothLinesForLinks(selectedLinkIds());
  },
});
