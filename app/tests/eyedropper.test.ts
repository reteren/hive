import { describe, expect, it } from "vitest";
import { rgbToHex } from "../src/drawing/eyedropper.svelte";

describe("eyedropper colour formatting", () => {
  it("formats sampled RGB channels as a six-digit CSS colour", () => {
    expect(rgbToHex(0, 128, 255)).toBe("#0080ff");
    expect(rgbToHex(255, 0, 1)).toBe("#ff0001");
  });
});
