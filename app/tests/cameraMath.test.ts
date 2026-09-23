import { describe, expect, it } from "vitest";
import { screenToWorld, worldToScreen, zoomAt } from "../src/board/cameraMath";

describe("cameraMath", () => {
  it("round-trips world and screen coordinates", () => {
    const camera = { x: 12.5, y: -40, zoom: 2.3 };
    const viewport = { width: 1000, height: 600 };
    const world = { x: 3, y: 7 };
    const back = screenToWorld(camera, viewport, worldToScreen(camera, viewport, world));
    expect(back.x).toBeCloseTo(world.x, 9);
    expect(back.y).toBeCloseTo(world.y, 9);
  });

  it("keeps the world point under the cursor fixed while zooming", () => {
    const camera = { x: 12.5, y: -40, zoom: 1.3 };
    const viewport = { width: 1000, height: 600 };
    const cursor = { x: 180, y: 420 };
    const before = screenToWorld(camera, viewport, cursor);

    const zoomed = zoomAt(camera, viewport, cursor, 2, { minZoom: 0.05, maxZoom: 8 });
    const after = screenToWorld(zoomed, viewport, cursor);

    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
    expect(zoomed.zoom).toBe(2.6);
  });

  it("clamps zoom to the configured limits", () => {
    const camera = { x: 4, y: -7, zoom: 2 };
    const viewport = { width: 800, height: 500 };
    const cursor = { x: 120, y: 200 };

    expect(zoomAt(camera, viewport, cursor, 100, { minZoom: 0.1, maxZoom: 5 }).zoom).toBe(5);
    expect(zoomAt(camera, viewport, cursor, 0.001, { minZoom: 0.1, maxZoom: 5 }).zoom).toBe(0.1);
  });

  it("returns to the same camera after repeated zoom in and out", () => {
    const initial = { x: 12.5, y: -40, zoom: 0.8 };
    const viewport = { width: 1000, height: 600 };
    const cursor = { x: 740, y: 190 };
    const limits = { minZoom: 0.05, maxZoom: 8 };
    let camera = initial;

    for (let step = 0; step < 20; step += 1) {
      camera = zoomAt(camera, viewport, cursor, 1.1, limits);
    }
    for (let step = 0; step < 20; step += 1) {
      camera = zoomAt(camera, viewport, cursor, 1 / 1.1, limits);
    }

    expect(camera.x).toBeCloseTo(initial.x, 9);
    expect(camera.y).toBeCloseTo(initial.y, 9);
    expect(camera.zoom).toBeCloseTo(initial.zoom, 12);
  });
});
