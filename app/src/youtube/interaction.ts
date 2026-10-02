import type { Point } from "../board/cameraMath";
import { crossedGestureThreshold } from "../selection/gestures";

/** Keep the YouTube surface's drag decision aligned with the board's move threshold. */
export function youtubeCaptureAction(start: Point, current: Point): "click" | "move" {
  return crossedGestureThreshold(start, current) ? "move" : "click";
}

/** Return the seek target only for an ended video with looping enabled. */
export function youtubeLoopRestart(playerState: number, loop: boolean | undefined, start: number | undefined): number | null {
  return playerState === 0 && loop === true ? start ?? 0 : null;
}

/** Suppress the iframe/browser menu while leaving the board's capture listener able to route it. */
export function suppressYoutubeContextMenu(event: Pick<MouseEvent, "preventDefault">): void {
  event.preventDefault();
}
