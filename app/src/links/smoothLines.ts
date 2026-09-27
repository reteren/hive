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

export interface SmoothEndpoint {
  bounds: Bounds | null;
  circular?: boolean;
}

export interface SmoothAnchors {
  fromAnchor?: LinkAnchor;
  toAnchor?: LinkAnchor;
}

/** Compute frame anchors facing the other endpoint; circles keep their radial attachments. */
export function smoothLinkAnchors(
  link: Pick<Link, "fromAnchor" | "toAnchor">,
  from: SmoothEndpoint,
  to: SmoothEndpoint,
): SmoothAnchors {
  const fromAnchor = from.circular
    ? undefined
    : to.bounds && from.bounds
      ? projectPointToAnchor(from.bounds, boundsCenter(to.bounds))
      : link.fromAnchor;
  const toAnchor = to.circular
    ? undefined
    : from.bounds && to.bounds
      ? projectPointToAnchor(to.bounds, boundsCenter(from.bounds))
      : link.toAnchor;
  return {
    ...(fromAnchor ? { fromAnchor } : {}),
    ...(toAnchor ? { toAnchor } : {}),
  };
}

/** Smooth every incoming or outgoing link touching the requested board objects. */
export function smoothLinesForObjects(objectIds: readonly string[]): boolean {
  const ids = new Set(objectIds);
  if (ids.size === 0) return false;
  const affected = Object.values(links.byId).filter((link) => ids.has(link.from) || ids.has(link.to));
  return smoothLinks(affected, objectIds.length === 1 ? objectName(objectIds[0]) : `${ids.size} objects`);
}

/** Smooth only the chosen lines, used when F3 is invoked with link selection active. */
export function smoothLinesForLinks(linkIds: readonly string[]): boolean {
  const ids = new Set(linkIds);
  const affected = Object.values(links.byId).filter((link) => ids.has(link.id));
  return smoothLinks(affected, affected.length === 1 ? `${objectName(affected[0].from)} → ${objectName(affected[0].to)}` : `${affected.length} lines`);
}

function smoothLinks(affected: readonly Link[], target: string): boolean {
  const changes = affected.flatMap((link) => {
    const from = endpointFor(link.from);
    const to = endpointFor(link.to);
    if (!from || !to) return [];
    const next = smoothLinkAnchors(link, from, to);
    const previous = copyAnchors(link);
    return anchorsEqual(previous, next) ? [] : [{ id: link.id, previous, next }];
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

registerCommand({
  id: "links.smoothLines",
  label: "Smooth lines",
  keys: [],
  run: () => {
    if (selection.ids.length > 0) smoothLinesForObjects(selection.ids);
    else smoothLinesForLinks(selectedLinkIds());
  },
});
