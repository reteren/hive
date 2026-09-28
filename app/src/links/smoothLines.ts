import { registerCommand } from "../commands/registry.svelte";
import { BEACON_SIZE } from "../model/note";
import { ME_OBJECT_ID, type Link, type LinkAnchor } from "../model/link";
import { board } from "../model/board.svelte";
import { links, updateLink } from "../model/links.svelte";
import { execute } from "../history/history.svelte";
import { ME_POSITION } from "../board/camera.svelte";
import { noteBounds, type Bounds } from "../notes/layout.svelte";
import { selection } from "../selection/selection.svelte";
import { selectedLinkIds } from "./selection.svelte";
import { projectPointToAnchor } from "./anchors";

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
  desiredPoint: { x: number; y: number };
}

interface AnchorGroup {
  bounds: Bounds;
  candidates: AnchorCandidate[];
}

const MIN_ANCHOR_SPACING = 1;
const CORNER_CLEARANCE = 1;

/** Smooth the links touching the requested objects, moving anchors only on those objects. */
export function smoothLinesForObjects(objectIds: readonly string[]): boolean {
  const ids = new Set(objectIds);
  if (ids.size === 0) return false;
  const affected = Object.values(links.byId).filter((link) => ids.has(link.from) || ids.has(link.to));
  return smoothLinks(affected, ids, objectIds.length === 1 ? objectName(objectIds[0]) : `${ids.size} objects`);
}

/** Smooth the selected links at both of their endpoints in one history action. */
export function smoothLinesForLinks(linkIds: readonly string[]): boolean {
  const ids = new Set(linkIds);
  const affected = Object.values(links.byId).filter((link) => ids.has(link.id));
  const endpointIds = new Set(affected.flatMap((link) => [link.from, link.to]));
  return smoothLinks(affected, endpointIds, affected.length === 1 ? `${objectName(affected[0].from)} → ${objectName(affected[0].to)}` : `${affected.length} lines`);
}

function smoothLinks(affected: readonly Link[], targetIds: ReadonlySet<string>, target: string): boolean {
  const groups = new Map<string, AnchorGroup>();

  for (const link of affected) {
    for (const side of ["from", "to"] as const) {
      const objectId = side === "from" ? link.from : link.to;
      if (!targetIds.has(objectId)) continue;

      const endpoint = endpointFor(objectId);
      const otherEndpoint = endpointFor(side === "from" ? link.to : link.from);
      if (!endpoint || endpoint.circular || !otherEndpoint) continue;

      const otherCenter = boundsCenter(otherEndpoint.bounds);
      const desiredAnchor = projectPointToAnchor(endpoint.bounds, otherCenter);
      const edge = anchorEdge(desiredAnchor);
      const position = edge === "top"
        ? desiredAnchor.x * endpoint.bounds.width
        : edge === "right"
          ? desiredAnchor.y * endpoint.bounds.height
          : edge === "bottom"
            ? (1 - desiredAnchor.x) * endpoint.bounds.width
            : (1 - desiredAnchor.y) * endpoint.bounds.height;
      const center = boundsCenter(endpoint.bounds);
      const polarAngle = Math.atan2(otherCenter.y - center.y, otherCenter.x - center.x);
      const candidate: AnchorCandidate = {
        linkId: link.id,
        side,
        edge,
        desiredPosition: position,
        angle: angleForEdge(edge, polarAngle),
        polarAngle,
        desiredPoint: {
          x: endpoint.bounds.x + desiredAnchor.x * endpoint.bounds.width,
          y: endpoint.bounds.y + desiredAnchor.y * endpoint.bounds.height,
        },
      };
      const group = groups.get(objectId) ?? { bounds: endpoint.bounds, candidates: [] };
      group.candidates.push(candidate);
      groups.set(objectId, group);
    }
  }

  const nextById = new Map<string, SmoothAnchors>();
  for (const group of groups.values()) {
    rebalanceCrowdedEdges(group.bounds, group.candidates);
    const byEdge = new Map<FrameEdge, AnchorCandidate[]>();
    for (const candidate of group.candidates) {
      const edgeCandidates = byEdge.get(candidate.edge) ?? [];
      edgeCandidates.push(candidate);
      byEdge.set(candidate.edge, edgeCandidates);
    }

    for (const [edge, candidates] of byEdge) {
      const length = edgeLength(group.bounds, edge);
      const cornerClearance = Math.min(CORNER_CLEARANCE, length / 2);
      const minimum = cornerClearance;
      const maximum = length - cornerClearance;
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
    return anchorsEqual(previous, merged) ? [] : [{ id: link.id, previous, next: merged }];
  });
  if (changes.length === 0) return false;

  execute({
    label: "Smooth lines",
    target,
    do: () => changes.forEach(({ id, next }) => setAnchors(id, next)),
    undo: () => changes.forEach(({ id, previous }) => setAnchors(id, previous)),
  });
  return true;
}

/** Ordered least-squares spacing, with a fallback only if the entire frame is over capacity. */
function spreadAlongEdge(desired: readonly number[], minimum: number, maximum: number): number[] {
  if (desired.length === 0) return [];
  const span = Math.max(0, maximum - minimum);
  const spacing = desired.length > 1
    ? Math.min(MIN_ANCHOR_SPACING, span / (desired.length - 1))
    : 0;
  const highestBase = maximum - spacing * (desired.length - 1);
  const adjusted = desired.map((position, index) => clamp(position, minimum, maximum) - index * spacing);
  const fitted = isotonicRegression(adjusted);
  return fitted.map((position, index) => clamp(position, minimum, highestBase) + index * spacing);
}

function rebalanceCrowdedEdges(bounds: Bounds, candidates: AnchorCandidate[]): void {
  const edges: readonly FrameEdge[] = ["top", "right", "bottom", "left"];
  const grouped = new Map<FrameEdge, AnchorCandidate[]>(edges.map((edge) => [edge, []]));
  for (const candidate of candidates) grouped.get(candidate.edge)!.push(candidate);

  const capacity = (edge: FrameEdge): number => {
    const length = edgeLength(bounds, edge);
    const margin = Math.min(CORNER_CLEARANCE, length / 2);
    return Math.floor(Math.max(0, length - margin * 2) / MIN_ANCHOR_SPACING + 1e-9) + 1;
  };

  for (let attempt = 0; attempt < candidates.length * edges.length; attempt += 1) {
    const crowded = edges.find((edge) => grouped.get(edge)!.length > capacity(edge));
    if (!crowded) return;

    let move: { candidate: AnchorCandidate; edge: FrameEdge; position: number; distance: number } | undefined;
    for (const candidate of grouped.get(crowded)!) {
      for (const edge of edges) {
        if (edge === crowded || grouped.get(edge)!.length >= capacity(edge)) continue;
        const projected = closestPointOnEdge(bounds, edge, candidate.desiredPoint);
        if (!move || projected.distance < move.distance) {
          move = { candidate, edge, ...projected };
        }
      }
    }
    if (!move) return;

    grouped.set(crowded, grouped.get(crowded)!.filter((candidate) => candidate !== move!.candidate));
    move.candidate.edge = move.edge;
    move.candidate.desiredPosition = move.position;
    move.candidate.angle = angleForEdge(move.edge, move.candidate.polarAngle);
    grouped.get(move.edge)!.push(move.candidate);
  }
}

function closestPointOnEdge(
  bounds: Bounds,
  edge: FrameEdge,
  desired: { x: number; y: number },
): { position: number; distance: number } {
  const length = edgeLength(bounds, edge);
  const margin = Math.min(CORNER_CLEARANCE, length / 2);
  let x = desired.x;
  let y = desired.y;
  if (edge === "top" || edge === "bottom") {
    x = clamp(x, bounds.x + margin, bounds.x + bounds.width - margin);
    y = edge === "top" ? bounds.y : bounds.y + bounds.height;
  } else {
    x = edge === "left" ? bounds.x : bounds.x + bounds.width;
    y = clamp(y, bounds.y + margin, bounds.y + bounds.height - margin);
  }
  const along = edge === "top"
    ? x - bounds.x
    : edge === "right"
      ? y - bounds.y
      : edge === "bottom"
        ? bounds.x + bounds.width - x
        : bounds.y + bounds.height - y;
  return { position: along, distance: Math.hypot(x - desired.x, y - desired.y) };
}

function angleForEdge(edge: FrameEdge, polarAngle: number): number {
  return edge === "left" && polarAngle < 0 ? polarAngle + Math.PI * 2 : polarAngle;
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

function anchorAtPosition(bounds: Bounds, edge: FrameEdge, position: number): LinkAnchor {
  if (edge === "top") return { x: clamp(position / bounds.width, 0, 1), y: 0 };
  if (edge === "right") return { x: 1, y: clamp(position / bounds.height, 0, 1) };
  if (edge === "bottom") return { x: clamp(1 - position / bounds.width, 0, 1), y: 1 };
  return { x: 0, y: clamp(1 - position / bounds.height, 0, 1) };
}

function edgeLength(bounds: Bounds, edge: FrameEdge): number {
  return edge === "top" || edge === "bottom" ? bounds.width : bounds.height;
}

function anchorEdge(anchor: LinkAnchor): FrameEdge {
  if (anchor.y === 0) return "top";
  if (anchor.x === 1) return "right";
  if (anchor.y === 1) return "bottom";
  return "left";
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

function boundsCenter(bounds: Bounds): { x: number; y: number } {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function objectName(id: string): string {
  return id === ME_OBJECT_ID ? "ME" : board.notes[id]?.name ?? "Note";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
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
