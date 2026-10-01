import { describe, expect, it } from "vitest";
import { fitVideoSize } from "../src/video/logic";

describe("video node dimensions", () => {
  it("fits landscape and portrait media with a 48-unit longest side", () => {
    expect(fitVideoSize(1920, 1080)).toEqual({ width: 48, height: 27 });
    expect(fitVideoSize(1080, 1920)).toEqual({ width: 27, height: 48 });
  });

  it("uses a 16:9 fallback when import metadata is unavailable", () => {
    expect(fitVideoSize(undefined, undefined)).toEqual({ width: 48, height: 27 });
    expect(fitVideoSize(0, Number.NaN)).toEqual({ width: 48, height: 27 });
  });
});
