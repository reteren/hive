import { describe, expect, it, vi } from "vitest";
import { beginTransientCameraChange, cameraSettings, isTransientCameraChange } from "../src/board/camera.svelte";
import { withCameraFit } from "../src/mcp/view/camera";

describe("temporary MCP camera fit", () => {
  it("keeps transient camera persistence suppression correctly nested and idempotent", () => {
    const endFirst = beginTransientCameraChange();
    const endSecond = beginTransientCameraChange();
    expect(isTransientCameraChange()).toBe(true);
    endFirst();
    expect(isTransientCameraChange()).toBe(true);
    endFirst();
    endSecond();
    expect(isTransientCameraChange()).toBe(false);
  });

  it("restores the exact camera and pointer after capture work fails", async () => {
    const camera = { x: 4.25, y: -19.5, zoom: 2.125 };
    const viewport = { width: 900, height: 600 };
    const refresh = vi.fn();
    await expect(withCameraFit(
      { x: 100, y: 50, width: 200, height: 100 },
      async () => { throw new Error("capture failed"); },
      camera,
      viewport,
      refresh,
    )).rejects.toThrow("capture failed");
    expect(camera).toEqual({ x: 4.25, y: -19.5, zoom: 2.125 });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("fits target bounds with 8 percent padding while respecting camera zoom limits", async () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const viewport = { width: 1000, height: 600 };
    let fitted: { bbox: { x: number; y: number; width: number; height: number }; zoom: number } | undefined;
    await withCameraFit({ x: 10, y: 20, width: 50, height: 30 }, async (value) => { fitted = value; }, camera, viewport, () => {});
    expect(fitted?.zoom).toBe(Math.min(0.84 * viewport.width / (50 * 10), 0.84 * viewport.height / (30 * 10)));
    expect(fitted?.bbox.x).toBeLessThan(10);
    expect(fitted?.bbox.y).toBeLessThan(20);
    expect(fitted?.bbox.width).toBeGreaterThan(50);
    expect(fitted?.bbox.height).toBeGreaterThan(30);
    expect(camera).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(cameraSettings.minZoom).toBe(0.05);
  });
});
