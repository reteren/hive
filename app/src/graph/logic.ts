import type { GraphData, GraphPoint } from "../model/nodeData";
import { copyGraphData } from "../model/nodeData";
import type { Note } from "../model/note";

/** New Graph size in board units; it can then be stretched without limit. */
export const GRAPH_DEFAULT_HEIGHT = 36;
export const GRAPH_MIN_WIDTH = 24;
export const GRAPH_MIN_HEIGHT = 20;

/** A node dropped this close (CSS px) to a point attaches to it instead of making a new point. */
export const GRAPH_POINT_HIT_PX = 12;

export function clampFraction(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Client coordinates → plot fractions (x from the left, y from the bottom). */
export function fractionInRect(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
  return {
    x: clampFraction((clientX - rect.left) / Math.max(rect.width, 1)),
    y: clampFraction(1 - (clientY - rect.top) / Math.max(rect.height, 1)),
  };
}

export function addGraphPoint(graph: Readonly<GraphData>, point: GraphPoint): GraphData {
  const next = copyGraphData(graph);
  next.points.push({ ...point, x: clampFraction(point.x), y: clampFraction(point.y) });
  return next;
}

export function updateGraphPoint(graph: Readonly<GraphData>, pointId: string, patch: Partial<Omit<GraphPoint, "id">>): GraphData {
  const next = copyGraphData(graph);
  next.points = next.points.map((point) => point.id !== pointId ? point : {
    ...point,
    ...patch,
    x: clampFraction(patch.x ?? point.x),
    y: clampFraction(patch.y ?? point.y),
  });
  return next;
}

export function removeGraphPoint(graph: Readonly<GraphData>, pointId: string): GraphData {
  const next = copyGraphData(graph);
  next.points = next.points.filter((point) => point.id !== pointId);
  return next;
}

/** What a point shows: its own label, else the linked node's live name. */
export function graphPointDisplay(point: Readonly<GraphPoint>, notes: Readonly<Record<string, Note>>): { text: string; missing: boolean } {
  const target = point.targetId ? notes[point.targetId] : undefined;
  const missing = point.targetId !== null && !target;
  return { text: point.label.trim() || target?.name || "", missing };
}

/** Nearest point within `radiusPx` of a client position, measured in the plot's on-screen size. */
export function graphPointAt(
  graph: Readonly<GraphData>,
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  radiusPx = GRAPH_POINT_HIT_PX,
): GraphPoint | null {
  let best: GraphPoint | null = null;
  let bestDistance = radiusPx;
  for (const point of graph.points) {
    const distance = Math.hypot(rect.left + point.x * rect.width - clientX, rect.top + (1 - point.y) * rect.height - clientY);
    if (distance <= bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}
