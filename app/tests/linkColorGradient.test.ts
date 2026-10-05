import { describe, expect, it } from "vitest";
import { linkColorGradientStops } from "../src/links/linkColorGradient";

describe("link colour gradients", () => {
  it("uses a vivid OKLCH midpoint for red to blue instead of a washed sRGB midpoint", () => {
    const stops = linkColorGradientStops("#ff0000", "#0000ff");
    expect(stops).toHaveLength(7);
    expect(stops?.[0]).toEqual({ offset: 0, color: "#ff0000" });
    expect(stops?.at(-1)).toEqual({ offset: 100, color: "#0000ff" });

    const midpoint = stops?.[3]?.color;
    expect(midpoint).toMatch(/^#[\da-f]{6}$/i);
    expect(midpoint).not.toBe("#800080");
    expect(midpoint).not.toBe("#ffffff");
    expect(rgb(midpoint!).green).toBeLessThan(60);
    expect(rgb(midpoint!).red).toBeGreaterThan(80);
    expect(rgb(midpoint!).blue).toBeGreaterThan(80);
  });

  it("takes the short hue path from yellow to blue through cyan", () => {
    const midpoint = linkColorGradientStops("#ffff00", "#0000ff")?.[3]?.color;
    expect(midpoint).toBeDefined();
    const channels = rgb(midpoint!);
    expect(channels.red).toBeLessThan(120);
    expect(channels.green).toBeGreaterThan(100);
    expect(channels.blue).toBeGreaterThan(100);
  });

  it("returns no gradient for equivalent endpoint colours", () => {
    expect(linkColorGradientStops("#abc", "#AABBCC")).toBeNull();
  });

  it("keeps greys neutral and memoizes each directional colour pair", () => {
    const first = linkColorGradientStops("#444444", "#cccccc");
    const repeated = linkColorGradientStops("#444444", "#cccccc");
    expect(first).toBe(repeated);
    expect(first).toHaveLength(7);

    for (const stop of first?.slice(1, -1) ?? []) {
      const { red, green, blue } = rgb(stop.color);
      expect(Math.max(red, green, blue) - Math.min(red, green, blue)).toBeLessThanOrEqual(1);
    }
  });
});

function rgb(hex: string): { red: number; green: number; blue: number } {
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  };
}
