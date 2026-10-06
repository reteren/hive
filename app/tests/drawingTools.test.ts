import { afterEach, describe, expect, it } from "vitest";
import { getCommands } from "../src/commands/registry.svelte";
import { DEFAULT_VIEW_SETTINGS, parseViewSettings, serializeViewSettings } from "../src/settings/viewSettings";
import { tool } from "../src/tools/tool.svelte";
import { drawCursorDiameter } from "../src/drawing/settings";
import { brushWheelSetting, drawShortcutForKey } from "../src/drawing/drawInput";
import {
  drawingPreferencesSnapshot,
  drawingTools,
  loadDrawingPreferences,
  setActiveDrawTool,
  setBrushSettings,
  stepBrushSetting,
} from "../src/drawing/tools.svelte";
import "../src/board/gridCommands";
import "../src/beacons/focusCommands";
import "../src/commands/appCommands.svelte";
import "../src/drawing/commands.svelte";

afterEach(() => {
  tool.active = "select";
  loadDrawingPreferences(DEFAULT_VIEW_SETTINGS.drawing);
  setActiveDrawTool("brush");
});

describe("drawing tools", () => {
  it("registers Ctrl+D without replacing another global binding", () => {
    expect(getCommands().filter((command) => command.keys.includes("Ctrl+KeyD")).map((command) => command.id))
      .toEqual(["tool.draw"]);
  });

  it("toggles drawing mode through the registered command", () => {
    const drawCommand = getCommands().find((command) => command.id === "tool.draw");
    expect(drawCommand).toBeDefined();
    drawCommand?.run();
    expect(tool.active).toBe("draw");
    drawCommand?.run();
    expect(tool.active).toBe("select");
  });

  it("keeps drawing shortcuts inside draw mode and reserves brackets for size", () => {
    expect(drawShortcutForKey("KeyB", true)).toEqual({ kind: "tool", tool: "brush" });
    expect(drawShortcutForKey("KeyE", true)).toEqual({ kind: "tool", tool: "eraser" });
    expect(drawShortcutForKey("KeyF", true)).toEqual({ kind: "tool", tool: "fill" });
    expect(drawShortcutForKey("KeyM", true)).toEqual({ kind: "tool", tool: "select-rect" });
    expect(drawShortcutForKey("KeyL", true)).toEqual({ kind: "tool", tool: "select-lasso" });
    expect(drawShortcutForKey("KeyP", true)).toEqual({ kind: "tool", tool: "select-polygon" });
    expect(drawShortcutForKey("BracketLeft", true)).toEqual({ kind: "size", delta: -5 });
    expect(drawShortcutForKey("BracketRight", true)).toEqual({ kind: "size", delta: 5 });
    expect(drawShortcutForKey("KeyM", false)).toBeNull();
    expect(drawShortcutForKey("BracketRight", false)).toBeNull();
    expect(drawShortcutForKey("KeyF", true, { ctrl: true })).toBeNull();
  });

  it("keeps the visible cursor diameter in screen pixels", () => {
    expect(drawCursorDiameter(10)).toBe(10);
    expect(drawCursorDiameter(1)).toBe(1);
    expect(drawCursorDiameter(900)).toBe(400);
  });

  it("persists brush settings with view settings and ignores removed presets", () => {
    setBrushSettings({
      color: "#123456", size: 72, opacity: 0.65, hardness: 0.3,
      tip: "charcoal", calligraphyAngle: 90, sprayDensity: 140, sprayDotSize: 5,
    });
    const serialized = serializeViewSettings({
      ...DEFAULT_VIEW_SETTINGS,
      drawing: drawingPreferencesSnapshot(),
    });
    setBrushSettings({ size: 12, color: "#eeeeee" });
    loadDrawingPreferences(parseViewSettings(serialized, DEFAULT_VIEW_SETTINGS).drawing);
    expect(drawingTools.brush).toMatchObject({
      color: "#123456", size: 72, opacity: 0.65, hardness: 0.3,
      tip: "charcoal", calligraphyAngle: 90, sprayDensity: 140, sprayDotSize: 5,
    });
    expect(drawingPreferencesSnapshot()).toEqual({ brush: drawingTools.brush });
  });

  it("maps Ctrl/Alt/Shift + wheel to size, opacity and hardness", () => {
    const none = { ctrl: false, alt: false, shift: false, meta: false };
    expect(brushWheelSetting({ ...none, ctrl: true })).toBe("size");
    expect(brushWheelSetting({ ...none, alt: true })).toBe("opacity");
    expect(brushWheelSetting({ ...none, shift: true })).toBe("hardness");
    expect(brushWheelSetting(none)).toBeNull();
    expect(brushWheelSetting({ ...none, ctrl: true, shift: true })).toBeNull();

    setBrushSettings({ size: 10, opacity: 0.5, hardness: 0.5 });
    stepBrushSetting("size", 1);
    expect(drawingTools.brush.size).toBe(11);
    stepBrushSetting("size", -3);
    expect(drawingTools.brush.size).toBe(8);
    stepBrushSetting("opacity", 2);
    expect(drawingTools.brush.opacity).toBe(0.6);
    stepBrushSetting("hardness", -20);
    expect(drawingTools.brush.hardness).toBe(0);
    stepBrushSetting("size", 400);
    expect(drawingTools.brush.size).toBe(400);
  });

  it("does not let the wheel change opacity while the eraser is active", () => {
    setBrushSettings({ opacity: 0.5, hardness: 0.5 });
    const previous = drawingTools.active;
    drawingTools.active = "eraser";
    stepBrushSetting("opacity", 3);
    expect(drawingTools.brush.opacity).toBe(0.5);
    stepBrushSetting("hardness", 2);
    expect(drawingTools.brush.hardness).toBe(0.6);
    drawingTools.active = previous;
  });
});
