import { describe, expect, it } from "vitest";
import { LinkRouteIndex, routeBounds } from "../src/links/routeIndex";

describe("link route bounds index", () => {
  it("finds routes crossing the viewport when both endpoint coordinates are outside it", () => {
    const index = new LinkRouteIndex();
    index.set("crossing", [{ x: -300, y: 8 }, { x: 300, y: 8 }]);
    index.set("remote", [{ x: 500, y: 500 }, { x: 600, y: 600 }]);

    expect(index.query({ x: 0, y: 0, width: 20, height: 20 })).toEqual(["crossing"]);
  });

  it("updates and removes a route without leaving stale cell entries", () => {
    const index = new LinkRouteIndex();
    index.set("link", [{ x: 0, y: 0 }, { x: 20, y: 20 }]);
    index.set("link", [{ x: 200, y: 200 }, { x: 220, y: 220 }]);

    expect(index.query({ x: 0, y: 0, width: 20, height: 20 })).toEqual([]);
    expect(index.query({ x: 200, y: 200, width: 20, height: 20 })).toEqual(["link"]);
    index.delete("link");
    expect(index.size).toBe(0);
    expect(index.query({ x: 200, y: 200, width: 20, height: 20 })).toEqual([]);
  });

  it("returns null for an empty route and computes inclusive bounds", () => {
    expect(routeBounds([])).toBeNull();
    expect(routeBounds([{ x: -2, y: 7 }, { x: 8, y: -3 }])).toEqual({ x: -2, y: -3, width: 10, height: 10 });
  });
});
