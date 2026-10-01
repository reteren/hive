import { describe, expect, it } from "vitest";
import { clampSliderValue, sliderPercent, sliderValueAtPercent } from "../src/media-ui/sliderLogic";
import { formatMediaTime } from "../src/media-ui/time";

describe("shared media controls", () => {
  it("clamps slider values and buffered progress to its range", () => {
    expect(clampSliderValue(-2, 10)).toBe(0);
    expect(clampSliderValue(12, 10)).toBe(10);
    expect(clampSliderValue(Number.NaN, 10)).toBe(0);
    expect(sliderPercent(4, 10)).toBe(40);
    expect(sliderPercent(4, 0)).toBe(0);
    expect(sliderValueAtPercent(120, 10)).toBe(10);
    expect(sliderValueAtPercent(Number.NaN, 10)).toBe(0);
  });

  it("formats elapsed time with tabular minute or hour fields", () => {
    expect(formatMediaTime(0)).toBe("0:00");
    expect(formatMediaTime(62.9)).toBe("1:02");
    expect(formatMediaTime(3601)).toBe("1:00:01");
    expect(formatMediaTime(-4)).toBe("0:00");
    expect(formatMediaTime(Number.NaN)).toBe("0:00");
  });
});
