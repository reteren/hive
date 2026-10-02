import type { Point } from "../board/cameraMath";
import { crossedGestureThreshold } from "../selection/gestures";

export interface VideoNodeSize {
  width: number;
  height: number;
}

/** Preserve playback on a click, and hand the gesture to the board after its drag threshold. */
export function videoCaptureAction(start: Point, current: Point): "click" | "move" {
  return crossedGestureThreshold(start, current) ? "move" : "click";
}

/** Fit a video's natural dimensions so its longest side occupies 48 board units. */
export function fitVideoSize(naturalWidth: number | undefined, naturalHeight: number | undefined, maxSide = 48): VideoNodeSize {
  const sourceWidth = validDimension(naturalWidth) ? naturalWidth : 16;
  const sourceHeight = validDimension(naturalHeight) ? naturalHeight : 9;
  const safeMaxSide = Number.isFinite(maxSide) && maxSide > 0 ? maxSide : 48;
  const scale = safeMaxSide / Math.max(sourceWidth, sourceHeight);
  return { width: sourceWidth * scale, height: sourceHeight * scale };
}

function validDimension(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
