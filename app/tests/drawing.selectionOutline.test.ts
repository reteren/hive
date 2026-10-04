import { describe, expect, it } from "vitest";
import { selectionOutlineMetrics } from "../src/drawing/selectionOutline";

describe("drawing selection outline metrics", () => {
  it("keeps stroke width and dash lengths constant in screen pixels at every zoom", () => {
    for (const zoom of [0.05, 0.25, 0.5, 1, 2, 4]) {
      const metrics = selectionOutlineMetrics(zoom);

      expect(metrics.underlayStrokeWidth * zoom).toBeCloseTo(2);
      expect(metrics.dashStrokeWidth * zoom).toBeCloseTo(1.25);
      expect(metrics.dashLength * zoom).toBeCloseTo(4);
      expect(metrics.dashGap * zoom).toBeCloseTo(3);
      expect(metrics.dashOffset * zoom).toBeCloseTo(-7);
    }
  });

  it("uses finite fallback metrics for invalid zoom", () => {
    expect(selectionOutlineMetrics(0)).toEqual(selectionOutlineMetrics(1));
    expect(selectionOutlineMetrics(Number.NaN)).toEqual(selectionOutlineMetrics(1));
  });
});
