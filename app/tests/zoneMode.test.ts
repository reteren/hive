import { beforeEach, describe, expect, it } from "vitest";
import { shouldShowZoneBrushCursor } from "../src/zones/zoneMode";
import { requestZoneMove, setZoneToolMode, takeZoneMoveRequest, toggleZoneMoveMode, zoneMode } from "../src/zones/zoneMode.svelte";

beforeEach(() => {
  zoneMode.active = "brush";
  zoneMode.followMoveActive = false;
  zoneMode.moveRequest = null;
  zoneMode.finishRequest = 0;
  zoneMode.suppressContextMenuUntil = 0;
});

describe("zone tool modes", () => {
  it("toggles brush and move on each Shift action and requests finishing the prior gesture", () => {
    expect(toggleZoneMoveMode()).toBe("move");
    expect(zoneMode.finishRequest).toBe(1);
    expect(toggleZoneMoveMode()).toBe("brush");
    expect(zoneMode.finishRequest).toBe(2);
    setZoneToolMode("brush");
    expect(zoneMode.finishRequest).toBe(2);
  });

  it("shows the yellow brush cursor only while the zone brush is active", () => {
    expect(shouldShowZoneBrushCursor("zone", "brush", true)).toBe(true);
    expect(shouldShowZoneBrushCursor("zone", "move", true)).toBe(false);
    expect(shouldShowZoneBrushCursor("select", "brush", true)).toBe(false);
    expect(shouldShowZoneBrushCursor("line-strong", "brush", true)).toBe(false);
    expect(shouldShowZoneBrushCursor("zone", "brush", false)).toBe(false);
    expect(shouldShowZoneBrushCursor("zone", "brush", true, true)).toBe(false);
  });

  it("consumes a menu move request once without changing its captured world point", () => {
    const startWorld = { x: 12, y: 8 };
    requestZoneMove({ zoneId: "z", startWorld });
    startWorld.x = 999;
    expect(takeZoneMoveRequest()).toEqual({ zoneId: "z", startWorld: { x: 12, y: 8 } });
    expect(takeZoneMoveRequest()).toBeNull();
  });
});
