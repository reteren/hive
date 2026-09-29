import { describe, expect, it } from "vitest";
import { cameraViewportRect, clientToMapPoint, fitMap, mapDragThresholdExceeded, mapToWorld, mapTransformForBounds, projectMapLinks, wholeBoardBounds, worldToMap, zoomMapTransform } from "../src/map/mapMath";
import { noteBounds } from "../src/notes/layout.svelte";

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

  it("uses the first measured board bounds for both displayed marks and click conversion", () => {
    const notes = [
      { id: "first", x: -340, y: 180, width: 28, height: 16 },
      { id: "second", x: 720, y: -90, width: 34, height: 22 },
    ];
    const bounds = wholeBoardBounds(notes, []);
    const transform = mapTransformForBounds(bounds, { width: 400, height: 300 }, 15, 1.3);
    const clickedWorldPoint = { x: 693, y: -61 };

    expect(mapToWorld(worldToMap(clickedWorldPoint, transform), transform).x).toBeCloseTo(clickedWorldPoint.x);
    expect(mapToWorld(worldToMap(clickedWorldPoint, transform), transform).y).toBeCloseTo(clickedWorldPoint.y);
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

  it("uses a captured SVG inverse matrix and ignores sub-threshold click jitter", () => {
    const captured = { a: 0.5, b: 0, c: 0, d: 0.5, e: -30, f: 18 };
    const changedAfterCameraPan = { ...captured, e: 80, f: -42 };
    const client = { x: 260, y: 124 };
    const pointAtPointerDown = clientToMapPoint(client, captured);

    expect(pointAtPointerDown).toEqual({ x: 100, y: 80 });
    expect(clientToMapPoint(client, changedAfterCameraPan)).not.toEqual(pointAtPointerDown);
    expect(mapDragThresholdExceeded({ x: 0, y: 0 }, { x: 3.9, y: 0 })).toBe(false);
    expect(mapDragThresholdExceeded({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    expect(mapDragThresholdExceeded({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
  });

  it("maps clicks exactly with internal zoom and Shift-scaled node bounds", () => {
    const small = noteBounds({ id: "small", type: "note", name: "small", text: "", x: -180, y: 90, width: 30, height: 14, scale: 0.5 });
    const large = noteBounds({ id: "large", type: "note", name: "large", text: "", x: 260, y: -130, width: 42, height: 26, scale: 2.5 });
    const notes = [{ id: "small", ...small }, { id: "large", ...large }];
    const bounds = wholeBoardBounds(notes, []);
    const clickedWorld = { x: large.x + large.width * 0.37, y: large.y + large.height * 0.61 };

    for (const internalZoom of [0.35, 1, 2.75, 12]) {
      const transform = mapTransformForBounds(bounds, { width: 400, height: 300 }, 15, internalZoom);
      const clickedMap = worldToMap(clickedWorld, transform);
      const inverseClientMatrix = { a: 0.8, b: 0, c: 0, d: 0.8, e: -45, f: 22 };
      const client = {
        x: (clickedMap.x - inverseClientMatrix.e) / inverseClientMatrix.a,
        y: (clickedMap.y - inverseClientMatrix.f) / inverseClientMatrix.d,
      };
      const recoveredMap = clientToMapPoint(client, inverseClientMatrix);
      const recoveredWorld = mapToWorld(recoveredMap, transform);
      expect(recoveredWorld.x).toBeCloseTo(clickedWorld.x, 9);
      expect(recoveredWorld.y).toBeCloseTo(clickedWorld.y, 9);
    }
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
