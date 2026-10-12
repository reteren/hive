import { describe, expect, it } from "vitest";
import { hasVisibleAlpha } from "../src/attachments/imageTransparency";

describe("image transparency thumbnail probe", () => {
  it("recognizes a transparent thumbnail and any visible alpha", () => {
    expect(hasVisibleAlpha(new Uint8ClampedArray([0, 0, 0, 0, 10, 20, 30, 0]))).toBe(false);
    expect(hasVisibleAlpha(new Uint8ClampedArray([0, 0, 0, 1]))).toBe(true);
  });
});
