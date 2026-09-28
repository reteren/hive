import { describe, expect, it } from "vitest";
import {
  boardPopupPlacement,
  fitBoardPopupAnchor,
  isOutsidePopup,
  screenAnchoredPopupStyle,
  shouldDismissOnOutsidePointer,
} from "../src/ui/boardAnchor";

describe("board popup anchor", () => {
  const viewport = { width: 800, height: 600 };

  it("follows camera pan and scales with zoom from its world corner", () => {
    const anchor = { x: 12, y: -3 };
    expect(boardPopupPlacement({ x: 0, y: 0, zoom: 1 }, viewport, anchor, 1)).toEqual({ x: 520, y: 270, scale: 1 });
    expect(boardPopupPlacement({ x: 2, y: 1, zoom: 0.5 }, viewport, anchor, 1)).toEqual({ x: 450, y: 280, scale: 0.5 });
    expect(boardPopupPlacement({ x: 2, y: 1, zoom: 0.5 }, viewport, anchor, 1, { x: 12, y: 10 }))
      .toEqual({ x: 438, y: 270, scale: 0.5 });
  });

  it("chooses an initial visible corner then leaves it at a fixed world point", () => {
    const camera = { x: 0, y: 0, zoom: 2 };
    const world = { x: 19, y: 14 };
    const anchor = fitBoardPopupAnchor(camera, viewport, world, { width: 164, height: 180 });
    const initial = boardPopupPlacement(camera, viewport, anchor, camera.zoom);
    expect(initial.x).toBeGreaterThanOrEqual(8);
    expect(initial.y).toBeGreaterThanOrEqual(8);
    expect(initial.x + 164).toBeLessThanOrEqual(792);
    expect(initial.y + 180).toBeLessThanOrEqual(592);
    expect(boardPopupPlacement({ x: 10, y: 10, zoom: 1 }, viewport, anchor, camera.zoom).scale).toBe(0.5);
  });

  it.each([0.25, 4])("opens at base screen size at zoom %s then scales with the board", (zoom) => {
    const anchor = { x: 0, y: 0 };
    const opened = boardPopupPlacement({ x: 0, y: 0, zoom }, viewport, anchor, zoom);
    const afterZoom = boardPopupPlacement({ x: 0, y: 0, zoom: zoom * 2 }, viewport, anchor, zoom);

    expect(opened.scale).toBe(1);
    expect(164 * opened.scale).toBe(164);
    expect(afterZoom.scale).toBe(2);
    expect(164 * afterZoom.scale).toBe(328);
  });

  it("dismisses only paths outside the popup and allowed opener", () => {
    const popup = new EventTarget();
    const child = new EventTarget();
    const opener = new EventTarget();
    expect(isOutsidePopup([child, popup], popup)).toBe(false);
    expect(isOutsidePopup([opener], popup, [opener])).toBe(false);
    expect(isOutsidePopup([child], popup, [opener])).toBe(true);
  });

  it("keeps a pinned popup open on outside pointer actions while retaining normal dismissal", () => {
    const popup = new EventTarget();
    const outside = new EventTarget();
    const child = new EventTarget();

    expect(shouldDismissOnOutsidePointer([outside], popup)).toBe(true);
    expect(shouldDismissOnOutsidePointer([outside], popup, [], false)).toBe(false);
    expect(shouldDismissOnOutsidePointer([child, popup], popup, [], false)).toBe(false);
  });

  it("keeps a pinned popup at its captured screen position without camera scaling", () => {
    const style = screenAnchoredPopupStyle({ x: 213, y: 96 });

    expect(style).toBe("left:213px;top:96px;transform:none;transform-origin:0 0");
  });
});
