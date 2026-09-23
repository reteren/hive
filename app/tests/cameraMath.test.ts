import { describe, expect, it } from "vitest";
import { screenToWorld, worldToScreen } from "../src/board/cameraMath";

describe("cameraMath", () => {
  it("round-trips world and screen coordinates", () => {
    const camera = { x: 12.5, y: -40, zoom: 2.3 };
    const viewport = { width: 1000, height: 600 };
    const world = { x: 3, y: 7 };
    const back = screenToWorld(camera, viewport, worldToScreen(camera, viewport, world));
    expect(back.x).toBeCloseTo(world.x, 9);
    expect(back.y).toBeCloseTo(world.y, 9);
  });
});
