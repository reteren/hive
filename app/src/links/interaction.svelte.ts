import type { Point } from "../board/cameraMath";
import type { LinkAnchor } from "../model/link";

export const lineInteraction = $state({
  sourceId: null as string | null,
  sourceAnchor: null as LinkAnchor | null,
  preview: null as Point | null,
  cutStroke: [] as Point[],
  suppressContextMenuUntil: 0,
  error: null as { message: string; x: number; y: number } | null,
});

let errorTimer: ReturnType<typeof setTimeout> | undefined;

export function setLineError(message: string, point: Point): void {
  if (errorTimer !== undefined) clearTimeout(errorTimer);
  lineInteraction.error = { message, x: point.x, y: point.y };
  errorTimer = setTimeout(() => {
    lineInteraction.error = null;
    errorTimer = undefined;
  }, 1_800);
}

export function clearLineError(): void {
  if (errorTimer !== undefined) clearTimeout(errorTimer);
  errorTimer = undefined;
  lineInteraction.error = null;
}

export function cancelLineDraft(): void {
  lineInteraction.sourceId = null;
  lineInteraction.sourceAnchor = null;
  lineInteraction.preview = null;
  lineInteraction.cutStroke = [];
  clearLineError();
}
