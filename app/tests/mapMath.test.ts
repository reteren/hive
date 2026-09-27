import { describe, expect, it } from "vitest";
import { cameraViewportRect, fitMap, mapToWorld, wholeBoardBounds, worldToMap } from "../src/map/mapMath";

describe("map geometry", () => {
  it("fits notes, zones, and ME inside the whole-board bounds", () => {
    const bounds = wholeBoardBounds(
      [{ id: "note", x: -120, y: 50, width: 40, height: 30 }],
      [{
        id: "zone",
        parts: [[{ x: 220, y: -80 }, { x: 340, y: -80 }, { x: 340, y: 40 }, { x: 220, y: 40 }]],
      }],
    );

    expect(bounds).toEqual({ x: -120, y: -80, width: 460, height: 160 });

    const transform = fitMap(bounds, { width: 400, height: 300 }, 20);
    const corners = [
      worldToMap({ x: bounds.x, y: bounds.y }, transform),
      worldToMap({ x: bounds.x + bounds.width, y: bounds.y + bounds.height }, transform),
      worldToMap({ x: 0, y: 0 }, transform),
    ];
    expect(corners.every((point) => point.x >= 20 - 1e-8 && point.x <= 380 + 1e-8 && point.y >= 20 - 1e-8 && point.y <= 280 + 1e-8)).toBe(true);
  });

  it("converts map coordinates back to the same world point", () => {
    const transform = fitMap({ x: -70, y: 25, width: 300, height: 180 }, { width: 400, height: 300 }, 18);
    const world = { x: 41.25, y: 116.5 };

    const roundTrip = mapToWorld(worldToMap(world, transform), transform);
    expect(roundTrip.x).toBeCloseTo(world.x);
    expect(roundTrip.y).toBeCloseTo(world.y);
  });

  it("projects the camera viewport rectangle around the camera centre", () => {
    const transform = fitMap({ x: -100, y: -80, width: 400, height: 300 }, { width: 400, height: 300 }, 15);
    const camera = { x: 100, y: 50, zoom: 2 };
    const viewport = { width: 800, height: 600 };

    const rect = cameraViewportRect(camera, viewport, transform);
    const worldCenter = mapToWorld({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, transform);

    expect(worldCenter.x).toBeCloseTo(camera.x);
    expect(worldCenter.y).toBeCloseTo(camera.y);
    expect(rect.width).toBeCloseTo(40 * transform.scale);
    expect(rect.height).toBeCloseTo(30 * transform.scale);
  });
});
