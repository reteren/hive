import { describe, expect, it } from "vitest";
import { cameraViewportRect, fitMap, mapToWorld, projectMapLinks, wholeBoardBounds, worldToMap, zoomMapTransform } from "../src/map/mapMath";

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

  it("keeps the map centre fixed while zooming its internal view", () => {
    const transform = fitMap({ x: -100, y: -80, width: 400, height: 300 }, { width: 400, height: 300 }, 15);
    const zoomed = zoomMapTransform(transform, { width: 400, height: 300 }, 2);
    const centerBefore = mapToWorld({ x: 200, y: 150 }, transform);
    const centerAfter = mapToWorld({ x: 200, y: 150 }, zoomed);

    expect(centerAfter.x).toBeCloseTo(centerBefore.x);
    expect(centerAfter.y).toBeCloseTo(centerBefore.y);
    expect(zoomed.scale).toBe(transform.scale * 2);
  });

  it("projects strong and weak links between node centres and skips oversized link sets", () => {
    const transform = fitMap({ x: 0, y: 0, width: 100, height: 100 }, { width: 400, height: 300 }, 10);
    const notes = [
      { id: "a", x: 10, y: 20, width: 20, height: 10 },
      { id: "b", x: 60, y: 40, width: 20, height: 20 },
    ];
    const links = [
      { id: "strong", from: "a", to: "b", kind: "strong" as const },
      { id: "weak", from: "me", to: "b", kind: "weak" as const },
    ];
    const projected = projectMapLinks(links, notes, transform);

    expect(projected).toHaveLength(2);
    expect(projected[0]?.from).toEqual(worldToMap({ x: 20, y: 25 }, transform));
    expect(projected[0]?.to).toEqual(worldToMap({ x: 70, y: 50 }, transform));
    expect(projected.map(({ kind }) => kind)).toEqual(["strong", "weak"]);
    expect(projectMapLinks([...links, { id: "extra", from: "a", to: "b", kind: "weak" }], notes, transform, "me", { x: 0, y: 0 }, 2)).toEqual([]);
  });
});
