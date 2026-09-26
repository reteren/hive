import { describe, expect, it } from "vitest";
import { boardPopupPlacement, fitBoardPopupAnchor, isOutsidePopup } from "../src/ui/boardAnchor";

describe("board popup anchor", () => {
  const viewport = { width: 800, height: 600 };

  it("follows camera pan and scales with zoom from its world corner", () => {
    const anchor = { x: 12, y: -3 };
    expect(boardPopupPlacement({ x: 0, y: 0, zoom: 1 }, viewport, anchor)).toEqual({ x: 520, y: 270, scale: 1 });
    expect(boardPopupPlacement({ x: 2, y: 1, zoom: 0.5 }, viewport, anchor)).toEqual({ x: 450, y: 280, scale: 0.5 });
    expect(boardPopupPlacement({ x: 2, y: 1, zoom: 0.5 }, viewport, anchor, { x: 12, y: 10 }))
      .toEqual({ x: 438, y: 270, scale: 0.5 });
  });

  it("chooses an initial visible corner then leaves it at a fixed world point", () => {
    const camera = { x: 0, y: 0, zoom: 2 };
    const world = { x: 19, y: 14 };
    const anchor = fitBoardPopupAnchor(camera, viewport, world, { width: 164, height: 180 });
    const initial = boardPopupPlacement(camera, viewport, anchor);
    expect(initial.x).toBeGreaterThanOrEqual(8);
    expect(initial.y).toBeGreaterThanOrEqual(8);
    expect(initial.x + 328).toBeLessThanOrEqual(792);
    expect(initial.y + 360).toBeLessThanOrEqual(592);
    expect(boardPopupPlacement({ x: 10, y: 10, zoom: 0.5 }, viewport, anchor).scale).toBe(0.5);
  });

  it("dismisses only paths outside the popup and allowed opener", () => {
    const popup = new EventTarget();
    const child = new EventTarget();
    const opener = new EventTarget();
    expect(isOutsidePopup([child, popup], popup)).toBe(false);
    expect(isOutsidePopup([opener], popup, [opener])).toBe(false);
    expect(isOutsidePopup([child], popup, [opener])).toBe(true);
  });
});
