import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex, normalizeHex } from "../src/color/hex";
import { liveColorSession } from "../src/color/liveColor";

describe("HEX palette colour math", () => {
  it("normalizes short, long and #-less hex", () => {
    expect(normalizeHex("ABC")).toBe("#aabbcc");
    expect(normalizeHex("#E8B030")).toBe("#e8b030");
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("zzzzzz")).toBeNull();
  });

  it("round-trips through HSV", () => {
    for (const hex of ["#000000", "#ffffff", "#e8b030", "#4a90e2", "#ff0000", "#7f7f7f", "#123456"]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
    expect(hexToHsv("#00ff00")).toEqual({ h: 120, s: 1, v: 1 });
  });
});

describe("live colour session", () => {
  it("previews without history and commits one step from the original", () => {
    let shown = "#111111";
    const commits: string[] = [];
    const session = liveColorSession(shown, (color) => { shown = color; }, (color) => { commits.push(color); shown = color; });
    session.preview("#222222");
    session.preview("#333333");
    expect(shown).toBe("#333333");
    session.finish(true);
    expect(commits).toEqual(["#333333"]);
    session.finish(true);
    expect(commits).toHaveLength(1);
  });

  it("restores the original on cancel", () => {
    let shown = "#111111";
    const session = liveColorSession(shown, (color) => { shown = color; }, () => { throw new Error("no commit"); });
    session.preview("#abcdef");
    session.finish(false);
    expect(shown).toBe("#111111");
  });
});

describe("recent colours row", () => {
  it("keeps the last 10 in time order: new on the right, oldest dropped", async () => {
    const { pushRecentColor, recentColors, RECENT_COLOR_LIMIT } = await import("../src/color/recentColors.svelte");
    recentColors.list = [];
    for (let index = 0; index < 12; index += 1) pushRecentColor(`#0000${index.toString(16).padStart(2, "0")}`);
    expect(recentColors.list).toHaveLength(RECENT_COLOR_LIMIT);
    expect(recentColors.list[0]).toBe("#000002");
    expect(recentColors.list.at(-1)).toBe("#00000b");
    pushRecentColor("#000005");
    expect(recentColors.list.at(-1)).toBe("#000005");
    expect(recentColors.list.filter((color) => color === "#000005")).toHaveLength(1);
  });
});
