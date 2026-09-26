import type { Point } from "../board/cameraMath";

/** Transient SVG offset while the selected zone's stored geometry stays untouched. */
export const zoneMovePreview = $state({
  zoneId: null as string | null,
  offset: { x: 0, y: 0 } as Point,
});

export function setZoneMovePreview(zoneId: string, offset: Point): void {
  zoneMovePreview.zoneId = zoneId;
  zoneMovePreview.offset = { x: offset.x, y: offset.y };
}

export function clearZoneMovePreview(): void {
  zoneMovePreview.zoneId = null;
  zoneMovePreview.offset = { x: 0, y: 0 };
}
