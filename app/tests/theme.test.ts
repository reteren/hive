import { describe, expect, it } from "vitest";
import { deriveThemeTokens, DEFAULT_THEME_COLORS, normalizeHex, normalizeThemeColors, relativeLuminance } from "../src/theme/colors";
import {
  BUILTIN_THEME_PRESETS,
  createUserThemePreset,
  deleteUserThemePreset,
  duplicateUserThemePreset,
  normalizeThemeSettings,
  REBUFFER_THEME_SOURCES,
  renameUserThemePreset,
  selectThemePreset,
} from "../src/theme/presets";
import { DEFAULT_VIEW_SETTINGS, parseViewSettings, serializeViewSettings } from "../src/settings/viewSettings";

describe("appearance theme tokens", () => {
  it("reproduces the Hive token defaults", () => {
    expect(deriveThemeTokens(DEFAULT_THEME_COLORS)).toEqual({
      "--bg-panel": "#232323",
      "--bg-panel-raised": "#2c2c2c",
      "--bg-hover": "#353535",
      "--border": "#0e0e0e",
      "--accent": "#e8b030",
      "--accent-hover": "#ebb949",
      "--accent-rgb": "232, 176, 48",
      "--on-accent": "#000000",
      "--icon": "#ffffff",
      "--icon-dim": "rgba(255, 255, 255, 0.58)",
      "--bg-board": "#161616",
      "--grid-minor": "rgba(255, 255, 255, 0.05)",
      "--grid-major": "rgba(255, 255, 255, 0.1)",
      "--axis": "rgba(232, 176, 48, 0.28)",
      "--text": "#d6d6d6",
      "--text-dim": "#a0a0a0",
    });
  });

  it("flips text automatically for light bases and chooses the better accent contrast", () => {
    expect(relativeLuminance("#777777")).toBeLessThan(0.5);
    expect(relativeLuminance("#cccccc")).toBeGreaterThan(0.5);
    expect(deriveThemeTokens({ ...DEFAULT_THEME_COLORS, base: "#777777" })["--text"]).toBe("#d6d6d6");
    expect(deriveThemeTokens({ ...DEFAULT_THEME_COLORS, base: "#cccccc" })).toMatchObject({
      "--text": "#202124",
      "--text-dim": "#55585e",
    });
    expect(deriveThemeTokens({ ...DEFAULT_THEME_COLORS, accent: "#ffffff" })["--on-accent"]).toBe("#000000");
    expect(deriveThemeTokens({ ...DEFAULT_THEME_COLORS, accent: "#123456" })["--on-accent"]).toBe("#ffffff");
  });

  it("validates six-digit colours and fills invalid fields from defaults", () => {
    expect(normalizeHex("#ABCDEF")).toBe("#abcdef");
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeThemeColors({ base: "bad", accent: "#abc123", icon: null, board: 3, grid: "#334455" }))
      .toEqual({ ...DEFAULT_THEME_COLORS, accent: "#abc123", grid: "#334455" });
  });
});

describe("built-in appearance presets", () => {
  it("maps the eleven Rebuffer themes into Hive's five colour fields", () => {
    const expected = [
      ["black", "#13141a", "#c2c2c2", "#ffffff", "#000000", "#292929"],
      ["darkblue", "#1b1e28", "#7aa2ff", "#ffffff", "#0c0e13", "#2c2d32"],
      ["dark-green", "#1a2a20", "#40ac3e", "#ffffff", "#0b130e", "#29362e"],
      ["dark-purple", "#291f3d", "#9630c5", "#ffffff", "#14101f", "#332e41"],
      ["ember", "#201915", "#ff9e5e", "#ffffff", "#110d0b", "#332e2b"],
      ["grey", "#242424", "#a6a6a6", "#ffffff", "#1b1b1b", "#3b3b3b"],
      ["light", "#e9ebf0", "#b5b5b5", "#171a21", "#f3f4f8", "#cfd1d7"],
      ["ocean", "#13262c", "#3ad6d6", "#ffffff", "#0c171a", "#2c383b"],
      ["paper", "#f1ece4", "#954a18", "#2a2119", "#f7f5f0", "#d4d1cb"],
      ["skyblue", "#fdfdfe", "#c2e4ff", "#182a4c", "#e3eaf8", "#b5c3e0"],
      ["wine", "#26171b", "#ff86a8", "#ffffff", "#160d10", "#382e31"],
    ] as const;

    expect(REBUFFER_THEME_SOURCES).toHaveLength(11);
    expect(BUILTIN_THEME_PRESETS).toHaveLength(12);
    for (const [id, base, accent, icon, board, grid] of expected) {
      const preset = BUILTIN_THEME_PRESETS.find((item) => item.id === id);
      expect(preset?.colors).toEqual({ base, accent, icon, board, grid });
    }
  });
});

describe("user theme presets", () => {
  it("creates, renames, duplicates, applies, and deletes user presets", () => {
    let settings = normalizeThemeSettings(null);
    settings = createUserThemePreset(settings, "  Custom dusk  ", "user-dusk");
    expect(settings.userPresets[0]).toMatchObject({ id: "user-dusk", name: "Custom dusk", colors: DEFAULT_THEME_COLORS });

    settings = renameUserThemePreset(settings, "user-dusk", "Deep dusk");
    settings = duplicateUserThemePreset(settings, "user-dusk", "Dusk copy", "user-dusk-copy");
    expect(settings.activePresetId).toBe("user-dusk-copy");
    expect(settings.userPresets.map((preset) => preset.name)).toEqual(["Deep dusk", "Dusk copy"]);

    settings = selectThemePreset(settings, "paper");
    expect(settings.activePresetId).toBe("paper");
    expect(settings.colors).toEqual(BUILTIN_THEME_PRESETS.find((preset) => preset.id === "paper")?.colors);

    settings = selectThemePreset(settings, "user-dusk-copy");
    settings = deleteUserThemePreset(settings, "user-dusk-copy");
    expect(settings.activePresetId).toBeNull();
    expect(settings.userPresets.map((preset) => preset.id)).toEqual(["user-dusk"]);
    expect(deleteUserThemePreset(settings, "hive").userPresets).toHaveLength(1);
  });

  it("validates persisted colours, names, ids, and active preset references", () => {
    const settings = normalizeThemeSettings({
      activePresetId: "user-good",
      colors: { base: "bad", accent: "#AABBCC", icon: "#123456", board: "#000000", grid: "#999999" },
      userPresets: [
        { id: "hive", name: "Spoofed built-in", colors: DEFAULT_THEME_COLORS },
        { id: "user-good", name: " Saved ", colors: { ...DEFAULT_THEME_COLORS, accent: "broken" } },
        { id: "user-good", name: "Duplicate id", colors: DEFAULT_THEME_COLORS },
        { id: "bad id", name: "Bad id", colors: DEFAULT_THEME_COLORS },
        { id: "user-empty", name: "   ", colors: DEFAULT_THEME_COLORS },
      ],
    });
    expect(settings.userPresets).toHaveLength(1);
    expect(settings.userPresets[0]).toMatchObject({ id: "user-good", name: "Saved", colors: DEFAULT_THEME_COLORS });
    expect(settings.activePresetId).toBe("user-good");
    expect(settings.colors).toEqual(DEFAULT_THEME_COLORS);
  });

  it("round-trips appearance and repairs invalid persisted settings", () => {
    const appearance = {
      colors: { base: "#dddddd", accent: "#123456", icon: "#abcdef", board: "#f0f0f0", grid: "#777777" },
      activePresetId: null,
      userPresets: [{ id: "user-save", name: "Saved theme", colors: DEFAULT_THEME_COLORS }],
    };
    const settings = { ...DEFAULT_VIEW_SETTINGS, appearance };
    expect(parseViewSettings(serializeViewSettings(settings), DEFAULT_VIEW_SETTINGS)).toEqual(settings);

    const invalid = parseViewSettings(
      '{"appearance":{"colors":{"base":"nope","accent":"#010203"},"activePresetId":"missing","userPresets":[{"id":"hive","name":"spoof","colors":{}}]}}',
      DEFAULT_VIEW_SETTINGS,
    );
    expect(invalid.appearance).toEqual({
      colors: { ...DEFAULT_THEME_COLORS, accent: "#010203" },
      activePresetId: null,
      userPresets: [],
    });
  });
});
