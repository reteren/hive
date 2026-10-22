import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SIMPLIFY_ZOOM, noteShowsFull, setSimplifyZoom, tierForZoom } from "../src/board/visibility.svelte";
import { normalizeSimplifyZoomPercent } from "../src/settings/simplifyZoom";
import { DEFAULT_VIEW_SETTINGS, parseViewSettings, serializeViewSettings } from "../src/settings/viewSettings";

describe("Simplify notes when zoomed out", () => {
  afterEach(() => setSimplifyZoom(DEFAULT_SIMPLIFY_ZOOM));

  it("keeps the old thresholds by default", () => {
    expect(DEFAULT_VIEW_SETTINGS.simplifyZoomPercent).toBe(20);
    expect(tierForZoom(0.19, "full")).toBe("full");
    expect(tierForZoom(0.16, "full")).toBe("simple");
    expect(tierForZoom(0.1, "full")).toBe("min");
    expect(noteShowsFull(0.19, 1, false)).toBe(false);
  });

  it("moves every tier with the setting", () => {
    setSimplifyZoom(0.4);
    expect(tierForZoom(0.3, "full")).toBe("simple");
    expect(tierForZoom(0.2, "full")).toBe("min");
    expect(noteShowsFull(0.35, 1, false)).toBe(false);
    setSimplifyZoom(0.08);
    expect(tierForZoom(0.1, "min")).toBe("full");
    expect(noteShowsFull(0.1, 1, false)).toBe(true);
  });

  it("Off draws every note in full at any zoom", () => {
    setSimplifyZoom(0);
    expect(tierForZoom(0.001, "full")).toBe("full");
    expect(tierForZoom(0.001, "min")).toBe("full");
    expect(noteShowsFull(0.001, 1, false)).toBe(true);
  });

  it("persists whole percents from 0 to 50", () => {
    expect(parseViewSettings(serializeViewSettings({ ...DEFAULT_VIEW_SETTINGS, simplifyZoomPercent: 0 }), DEFAULT_VIEW_SETTINGS).simplifyZoomPercent).toBe(0);
    expect(parseViewSettings('{"simplifyZoomPercent":35}', DEFAULT_VIEW_SETTINGS).simplifyZoomPercent).toBe(35);
    for (const invalid of [-1, 51, 12.5, "20", null]) expect(normalizeSimplifyZoomPercent(invalid)).toBe(20);
  });
});
