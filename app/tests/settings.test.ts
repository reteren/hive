import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW_SETTINGS,
  parseViewSettings,
  serializeViewSettings,
  VIEW_SETTINGS_VERSION,
} from "../src/settings/viewSettings";
import { setReduceMotionDataset } from "../src/settings/motion";

describe("view settings serialization", () => {
  it("round-trips a versioned settings snapshot", () => {
    const settings = {
      camera: { x: 32.5, y: -80, zoom: 2.4 },
      cameraSettings: { minZoom: 0.1, maxZoom: 12, zoomSensitivity: 0.002, panSpeed: 720 },
      grid: { step: 25, autoGrid: false, showGrid: false, snap: true },
      history: { limit: 256 },
      accessibility: { reduceAnimations: true },
      zones: { brushSize: 240 },
      keyOverrides: { "view.home": ["Ctrl+Alt+KeyH"], "edit.undo": [] },
      transferHintsShown: 3,
      fitWidthToText: false,
      gifPlayback: "selected" as const,
      backupIntervalMinutes: 15 as const,
      quickInputShortcut: "Ctrl+Shift+Space",
      skipCompletedTimerConfirmation: false,
    };

    const serialized = serializeViewSettings(settings);
    const parsed = JSON.parse(serialized) as { version: number };

    expect(parsed.version).toBe(VIEW_SETTINGS_VERSION);
    expect(parseViewSettings(serialized, DEFAULT_VIEW_SETTINGS)).toEqual(settings);
  });

  it("uses defaults for a missing or corrupt file", () => {
    expect(parseViewSettings(null, DEFAULT_VIEW_SETTINGS)).toEqual(DEFAULT_VIEW_SETTINGS);
    expect(parseViewSettings("{not json", DEFAULT_VIEW_SETTINGS)).toEqual(DEFAULT_VIEW_SETTINGS);
    expect(DEFAULT_VIEW_SETTINGS.grid.autoGrid).toBe(true);
  });

  it("enables Auto grid by default when loading settings saved before version 10", () => {
    const loaded = parseViewSettings('{"version":9,"grid":{"step":25,"showGrid":false,"snap":true}}', DEFAULT_VIEW_SETTINGS);
    expect(loaded.grid).toEqual({ step: 25, autoGrid: true, showGrid: false, snap: true });
  });

  it("loads older view settings without a history limit", () => {
    const oldSettings = JSON.stringify({
      version: 1,
      camera: DEFAULT_VIEW_SETTINGS.camera,
      cameraSettings: DEFAULT_VIEW_SETTINGS.cameraSettings,
      grid: DEFAULT_VIEW_SETTINGS.grid,
      display: { rightPanelOpen: false },
    });

    expect(parseViewSettings(oldSettings, DEFAULT_VIEW_SETTINGS)).toEqual(DEFAULT_VIEW_SETTINGS);
  });

  it("loads version 2 settings without a keymap and defaults to no overrides", () => {
    const oldSettings = JSON.stringify({
      version: 2,
      camera: DEFAULT_VIEW_SETTINGS.camera,
      cameraSettings: DEFAULT_VIEW_SETTINGS.cameraSettings,
      grid: DEFAULT_VIEW_SETTINGS.grid,
      display: { rightPanelOpen: false },
      history: DEFAULT_VIEW_SETTINGS.history,
    });

    expect(parseViewSettings(oldSettings, DEFAULT_VIEW_SETTINGS)).toEqual(DEFAULT_VIEW_SETTINGS);
  });

  it("keeps valid fields while replacing invalid, partial, or unknown-version values", () => {
    const settings = parseViewSettings(
      JSON.stringify({
        version: 99,
        camera: { x: 14, y: "bad", zoom: 200 },
        cameraSettings: { minZoom: 0.1, maxZoom: 5, zoomSensitivity: -1, panSpeed: 900 },
        grid: { step: 0, showGrid: false, snap: "yes" },
        display: { rightPanelOpen: false },
        history: { limit: 999 },
      }),
      DEFAULT_VIEW_SETTINGS,
    );

    expect(settings).toEqual({
      camera: { x: 14, y: 0, zoom: 1 },
      cameraSettings: { minZoom: 0.1, maxZoom: 5, zoomSensitivity: 0.0015, panSpeed: 900 },
      grid: { step: 10, autoGrid: true, showGrid: false, snap: false },
      history: { limit: 64 },
      accessibility: DEFAULT_VIEW_SETTINGS.accessibility,
      zones: DEFAULT_VIEW_SETTINGS.zones,
      keyOverrides: {},
      transferHintsShown: 0,
      fitWidthToText: true,
      gifPlayback: "always",
      backupIntervalMinutes: 30,
      quickInputShortcut: DEFAULT_VIEW_SETTINGS.quickInputShortcut,
      skipCompletedTimerConfirmation: false,
    });
  });

  it("defaults text fitting on and validates the persisted beta setting", () => {
    expect(DEFAULT_VIEW_SETTINGS.fitWidthToText).toBe(true);
    expect(parseViewSettings('{"fitWidthToText":false}', DEFAULT_VIEW_SETTINGS).fitWidthToText).toBe(false);
    expect(parseViewSettings('{"fitWidthToText":"yes"}', DEFAULT_VIEW_SETTINGS).fitWidthToText).toBe(true);
  });

  it("normalizes the persisted zone brush size and defaults older settings", () => {
    expect(parseViewSettings('{"version":6}', DEFAULT_VIEW_SETTINGS).zones.brushSize).toBe(60);
    expect(parseViewSettings('{"zones":{"brushSize":87}}', DEFAULT_VIEW_SETTINGS).zones.brushSize).toBe(80);
    expect(parseViewSettings('{"zones":{"brushSize":301}}', DEFAULT_VIEW_SETTINGS).zones.brushSize).toBe(300);
    expect(parseViewSettings('{"zones":{"brushSize":0}}', DEFAULT_VIEW_SETTINGS).zones.brushSize).toBe(20);
    expect(parseViewSettings('{"zones":{"brushSize":"large"}}', DEFAULT_VIEW_SETTINGS).zones.brushSize).toBe(60);
  });

  it("rejects non-finite positions and zooms outside the configured limits", () => {
    const settings = parseViewSettings(
      `{"version":${VIEW_SETTINGS_VERSION},"camera":{"x":1e400,"y":-3,"zoom":0.04}}`,
      DEFAULT_VIEW_SETTINGS,
    );

    expect(settings.camera).toEqual({ x: 0, y: -3, zoom: 1 });
  });

  it("defaults the new motion setting from the supplied OS preference and validates persisted values", () => {
    const defaults = {
      ...DEFAULT_VIEW_SETTINGS,
      accessibility: { reduceAnimations: true },
    };
    const oldSettings = JSON.stringify({ version: 3, accessibility: {} });
    const invalidSettings = JSON.stringify({ version: 4, accessibility: { reduceAnimations: "yes" } });

    expect(parseViewSettings(oldSettings, defaults).accessibility.reduceAnimations).toBe(true);
    expect(parseViewSettings(invalidSettings, defaults).accessibility.reduceAnimations).toBe(true);
  });

  it("sets and removes the reduced-motion dataset flag", () => {
    const dataset: { reduceMotion?: string } = {};

    setReduceMotionDataset(dataset, true);
    expect(dataset.reduceMotion).toBe("true");

    setReduceMotionDataset(dataset, false);
    expect(dataset.reduceMotion).toBeUndefined();
  });

  it("persists the transfer hint count and rejects invalid counters", () => {
    const saved = serializeViewSettings({ ...DEFAULT_VIEW_SETTINGS, transferHintsShown: 5 });
    expect(parseViewSettings(saved, DEFAULT_VIEW_SETTINGS).transferHintsShown).toBe(5);
    expect(parseViewSettings('{"transferHintsShown":-1}', DEFAULT_VIEW_SETTINGS).transferHintsShown).toBe(0);
    expect(parseViewSettings('{"transferHintsShown":6}', DEFAULT_VIEW_SETTINGS).transferHintsShown).toBe(0);
    expect(parseViewSettings('{"transferHintsShown":2.5}', DEFAULT_VIEW_SETTINGS).transferHintsShown).toBe(0);
  });

  it("ignores the removed display-panel setting when loading older files", () => {
    const serialized = serializeViewSettings(DEFAULT_VIEW_SETTINGS);
    const oldSettings = JSON.stringify({
      ...JSON.parse(serialized),
      display: { rightPanelOpen: false },
    });

    expect(parseViewSettings(oldSettings, DEFAULT_VIEW_SETTINGS)).toEqual(DEFAULT_VIEW_SETTINGS);
    expect(JSON.parse(serialized)).not.toHaveProperty("display");
  });

  it("persists supported backup intervals and defaults invalid values", () => {
    for (const backupIntervalMinutes of [0, 15, 30, 60] as const) {
      const saved = serializeViewSettings({ ...DEFAULT_VIEW_SETTINGS, backupIntervalMinutes });
      expect(parseViewSettings(saved, DEFAULT_VIEW_SETTINGS).backupIntervalMinutes).toBe(backupIntervalMinutes);
    }
    expect(parseViewSettings('{"backupIntervalMinutes":20}', DEFAULT_VIEW_SETTINGS).backupIntervalMinutes).toBe(30);
  });

  it("normalizes supported quick input accelerators and defaults invalid values", () => {
    expect(parseViewSettings('{"quickInputShortcut":"Alt+Ctrl+Space"}', DEFAULT_VIEW_SETTINGS).quickInputShortcut)
      .toBe("Ctrl+Alt+Space");
    expect(parseViewSettings('{"quickInputShortcut":"Shift+Q"}', DEFAULT_VIEW_SETTINGS).quickInputShortcut)
      .toBe(DEFAULT_VIEW_SETTINGS.quickInputShortcut);
    expect(parseViewSettings('{"quickInputShortcut":"Ctrl+Alt+Nope"}', DEFAULT_VIEW_SETTINGS).quickInputShortcut)
      .toBe(DEFAULT_VIEW_SETTINGS.quickInputShortcut);
  });
});
