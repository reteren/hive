import { describe, expect, it } from "vitest";
import {
  MAX_PROFILES,
  parseSettingsProfiles,
  pickProfileSettings,
  serializeSettingsProfiles,
  uniqueProfileName,
  withProfileSettings,
} from "../src/settings/profiles";
import { DEFAULT_VIEW_SETTINGS, serializeViewSettings } from "../src/settings/viewSettings";
import {
  createSettingsProfile,
  deleteSettingsProfile,
  renameSettingsProfile,
  switchSettingsProfile,
} from "../src/settings/persistence.svelte";
import { settingsProfiles } from "../src/settings/profileState.svelte";
import { grid } from "../src/board/grid.svelte";
import { camera, cameraSettings } from "../src/board/camera.svelte";
import { preferences } from "../src/settings/preferences.svelte";
import { quickInputShortcut } from "../src/settings/quickInputShortcut.svelte";

const serialized = JSON.parse(serializeViewSettings(DEFAULT_VIEW_SETTINGS)) as Record<string, unknown>;

describe("settings profiles (R11.4)", () => {
  it("keeps only per-profile keys; camera position, counters, backups and the MCP switch stay shared", () => {
    const picked = pickProfileSettings({ ...serialized, timeCounters: { appMs: 5 } });
    expect(picked.grid).toEqual(serialized.grid);
    expect(picked.appearance).toEqual(serialized.appearance);
    for (const key of ["camera", "timeCounters", "backupIntervalMinutes", "allowAiToolsMcp", "quickInputShortcut", "transferHintsShown"]) {
      expect(picked).not.toHaveProperty(key);
    }
    const merged = withProfileSettings(serialized, { grid: { step: 20 }, camera: { x: 9 } });
    expect(merged.grid).toEqual({ step: 20 });
    expect(merged.camera).toEqual(serialized.camera);
  });

  it("turns settings saved before profiles into one Default profile", () => {
    const profiles = parseSettingsProfiles(undefined, serialized);
    expect(profiles.list).toHaveLength(1);
    expect(profiles.list[0].name).toBe("Default");
    expect(profiles.active).toBe(profiles.list[0].id);
    expect(profiles.list[0].settings.grid).toEqual(serialized.grid);
  });

  it("drops broken, duplicate and excess entries and repairs a missing active id", () => {
    const list = [
      { id: "a", name: "Work", settings: {} },
      { id: "a", name: "Other", settings: {} },
      { id: "b", name: "work", settings: {} },
      { id: "", name: "Empty", settings: {} },
      "junk",
      ...Array.from({ length: 30 }, (_, index) => ({ id: `x${index}`, name: `P${index}`, settings: {} })),
    ];
    const profiles = parseSettingsProfiles({ active: "missing", list }, serialized);
    expect(profiles.list[0]).toMatchObject({ id: "a", name: "Work" });
    expect(profiles.list.map((profile) => profile.id)).not.toContain("b");
    expect(profiles.list).toHaveLength(MAX_PROFILES);
    expect(profiles.active).toBe("a");
  });

  it("saves the current settings into the active profile only", () => {
    const profiles = { active: "a", list: [{ id: "a", name: "A", settings: {} }, { id: "b", name: "B", settings: { grid: { step: 50 } } }] };
    const saved = serializeSettingsProfiles(profiles, serialized);
    expect(saved.list[0].settings.grid).toEqual(serialized.grid);
    expect(saved.list[1].settings.grid).toEqual({ step: 50 });
  });

  it("makes unique names", () => {
    const list = [{ id: "a", name: "Drawing", settings: {} }, { id: "b", name: "Drawing 2", settings: {} }];
    expect(uniqueProfileName(list, "drawing")).toBe("drawing 3");
    expect(uniqueProfileName(list, "Drawing", "a")).toBe("Drawing");
    expect(uniqueProfileName(list, "   ")).toBe("Profile");
  });

  it("switches, renames and deletes profiles, keeping each profile's own settings", () => {
    grid.showGrid = true;
    preferences.fitWidthToText = true;
    camera.x = 123;
    camera.zoom = 6;
    quickInputShortcut.value = "Ctrl+Alt+Space";
    const first = settingsProfiles.active;

    const drawing = createSettingsProfile("Drawing");
    expect(drawing).not.toBeNull();
    expect(settingsProfiles.active).toBe(drawing);
    grid.showGrid = false;
    preferences.fitWidthToText = false;
    cameraSettings.maxZoom = 4;

    switchSettingsProfile(first);
    expect(grid.showGrid).toBe(true);
    expect(preferences.fitWidthToText).toBe(true);
    expect(cameraSettings.maxZoom).toBe(8);
    expect(camera.x).toBe(123);
    expect(quickInputShortcut.value).toBe("Ctrl+Alt+Space");

    switchSettingsProfile(drawing!);
    expect(grid.showGrid).toBe(false);
    expect(preferences.fitWidthToText).toBe(false);
    // The view stays put; its zoom is pulled into the profile's limits.
    expect(camera.x).toBe(123);
    expect(camera.zoom).toBe(4);

    expect(renameSettingsProfile(drawing!, "  Sketch  ")).toBe("Sketch");
    expect(deleteSettingsProfile(drawing!)).toBe(true);
    expect(settingsProfiles.active).toBe(first);
    expect(grid.showGrid).toBe(true);
    expect(deleteSettingsProfile(first)).toBe(false);
  });
});
