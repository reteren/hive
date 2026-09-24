import { describe, expect, it } from "vitest";
import type { Zone } from "../src/model/zone";
import { rectContour } from "../src/model/zone";
import { chooseZoneForBounds } from "../src/zones/membership.svelte";
import { rectangleOverlapsZones, zoneAreaInRect, zoneCreationPreview, zoneTouchesRect } from "../src/zones/geometry";

function zone(id: string, x: number, y: number, width: number, height: number): Zone {
  return { id, name: id, color: "#608ac1", parts: [rectContour(x, y, width, height)], holes: [] };
}

describe("zone geometry and membership choices", () => {
  it("counts an edge or corner touch but gives it zero covered area", () => {
    const first = zone("a", 0, 0, 10, 10);
    const edge = { x: 10, y: 3, width: 2, height: 2 };
    const corner = { x: 10, y: 10, width: 2, height: 2 };
    expect(zoneTouchesRect(first, edge)).toBe(true);
    expect(zoneTouchesRect(first, corner)).toBe(true);
    expect(zoneAreaInRect(first, edge)).toBe(0);
    expect(rectangleOverlapsZones(edge, [first])).toBe(false);
  });

  it("picks greater occupied area and preserves a previous exact-tie membership", () => {
    const a = zone("a", 0, 0, 10, 10);
    const b = zone("b", 10, 0, 10, 10);
    expect(chooseZoneForBounds({ x: 8, y: 2, width: 8, height: 4 }, [a, b])).toBe("b");
    const tied = { x: 8, y: 2, width: 4, height: 4 };
    expect(chooseZoneForBounds(tied, [a, b], "a", () => 0.99)).toBe("a");
    expect(chooseZoneForBounds(tied, [a, b], null, () => 0.99)).toBe("b");
  });

  it("excludes a future hole while retaining contact with its boundary", () => {
    const ring = { ...zone("ring", 0, 0, 20, 20), holes: [rectContour(5, 5, 10, 10)] };
    expect(zoneAreaInRect(ring, { x: 6, y: 6, width: 2, height: 2 })).toBe(0);
    expect(zoneTouchesRect(ring, { x: 6, y: 6, width: 2, height: 2 })).toBe(false);
    expect(zoneTouchesRect(ring, { x: 5, y: 6, width: 2, height: 2 })).toBe(true);
  });

  it("uses every disconnected part of one zone", () => {
    const twoParts = { ...zone("parts", 0, 0, 5, 5), parts: [rectContour(0, 0, 5, 5), rectContour(15, 0, 5, 5)] };
    expect(zoneTouchesRect(twoParts, { x: 16, y: 1, width: 2, height: 2 })).toBe(true);
    expect(zoneAreaInRect(twoParts, { x: 16, y: 1, width: 2, height: 2 })).toBe(4);
    expect(zoneTouchesRect(twoParts, { x: 8, y: 1, width: 2, height: 2 })).toBe(false);
  });

  it("stops creation at an obstacle, allows touching, and rejects tiny resulting zones", () => {
    const obstacle = zone("obstacle", 10, 5, 10, 10);
    const preview = zoneCreationPreview({ x: 0, y: 0 }, { x: 20, y: 20 }, [obstacle]);
    expect(preview.blocked).toBe(true);
    expect(preview.reason).toMatch(/overlap/);
    expect(preview.rect?.width).toBeCloseTo(10, 3);
    expect(preview.rect && rectangleOverlapsZones(preview.rect, [obstacle])).toBe(false);
    expect(zoneCreationPreview({ x: 9, y: 8 }, { x: 20, y: 20 }, [obstacle]).rect).toBeNull();
    expect(zoneCreationPreview({ x: 0, y: 0 }, { x: 1, y: 3 }, []).rect?.width).toBe(1);
  });
});
