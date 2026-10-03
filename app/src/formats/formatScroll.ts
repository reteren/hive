import { wheelScrollsText } from "../notes/textScroll";

type ScrollPosition = Pick<HTMLElement,
  "scrollTop" | "clientHeight" | "scrollHeight" | "scrollLeft" | "clientWidth" | "scrollWidth">;

/** Let the board handle wheel input once CodeMirror reaches the requested edge. */
export function formatWheelUsesEditor(scroller: ScrollPosition, deltaX: number, deltaY: number): boolean {
  if (deltaY !== 0) return wheelScrollsText(scroller.scrollTop, scroller.clientHeight, scroller.scrollHeight, deltaY);
  if (deltaX === 0 || scroller.scrollWidth <= scroller.clientWidth + 1) return false;
  return deltaX > 0
    ? scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1
    : scroller.scrollLeft > 1;
}
