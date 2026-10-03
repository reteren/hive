import { afterEach, describe, expect, it } from "vitest";
import { getCommands } from "../src/commands/registry.svelte";
import { DEFAULT_VIEW_SETTINGS, parseViewSettings, serializeViewSettings } from "../src/settings/viewSettings";
import { tool } from "../src/tools/tool.svelte";
import { drawCursorDiameter } from "../src/drawing/settings";
import { drawShortcutForKey } from "../src/drawing/drawInput";
import {
  applyBrushPreset,
  deleteBrushPreset,
  drawingPreferencesSnapshot,
  drawingTools,
  loadDrawingPreferences,
  saveBrushPreset,
  setActiveDrawTool,
  setBrushSettings,
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

  it("saves, applies, deletes, and persists brush presets with view settings", () => {
    setBrushSettings({ color: "#123456", size: 72, opacity: 0.65, hardness: 0.3 });
    const preset = saveBrushPreset("Marker");
    expect(preset).toMatchObject({ name: "Marker", color: "#123456", size: 72, opacity: 0.65, hardness: 0.3 });
    expect(saveBrushPreset(" ")).toBeNull();

    const serialized = serializeViewSettings({
      ...DEFAULT_VIEW_SETTINGS,
      drawing: drawingPreferencesSnapshot(),
    });
    loadDrawingPreferences(parseViewSettings(serialized, DEFAULT_VIEW_SETTINGS).drawing);
    setBrushSettings({ size: 12, color: "#eeeeee" });
    expect(applyBrushPreset(preset!.id)).toBe(true);
    expect(drawingTools.brush).toMatchObject({ color: "#123456", size: 72, opacity: 0.65, hardness: 0.3 });
    expect(deleteBrushPreset(preset!.id)).toBe(true);
    expect(drawingTools.presets).toEqual([]);
  });
});
