import { describe, expect, it } from "vitest";
import { lineEndpoints, localLineEnds, shapeDraftFromDrag } from "../src/drawing/shapes/shapeGeometry";
import { createSeededRandom, sprayBlobs } from "../src/drawing/brushes/sprayMath";

describe("debug 31: lines run from the press to the pointer", () => {
  it.each([
    [{ x: 10, y: 10 }, { x: 2, y: 15 }],
    [{ x: 0, y: 0 }, { x: 7, y: -3 }],
    [{ x: 5, y: 5 }, { x: -4, y: -9 }],
    [{ x: 0, y: 0 }, { x: 6, y: 2 }],
  ])("%o → %o keeps both ends in any direction", (start, end) => {
    const draft = shapeDraftFromDrag("arrow", start, end, { shift: false, alt: false });
    const ends = lineEndpoints(draft);
    expect(ends.start.x).toBeCloseTo(start.x);
    expect(ends.start.y).toBeCloseTo(start.y);
    expect(ends.end.x).toBeCloseTo(end.x);
    expect(ends.end.y).toBeCloseTo(end.y);
    // Renderers mirror the canvas by the flips; the local diagonal must then land on start → end.
    const local = localLineEnds(draft.right - draft.left, draft.bottom - draft.top);
    const sx = draft.flipX ? -1 : 1;
    const sy = draft.flipY ? -1 : 1;
    const cx = (draft.left + draft.right) / 2;
    const cy = (draft.top + draft.bottom) / 2;
    expect(cx + local.x1 * sx).toBeCloseTo(start.x);
    expect(cy + local.y1 * sy).toBeCloseTo(start.y);
    expect(cx + local.x2 * sx).toBeCloseTo(end.x);
    expect(cy + local.y2 * sy).toBeCloseTo(end.y);
  });

  it("Shift snaps the end to 15° steps around the start", () => {
    const draft = shapeDraftFromDrag("line", { x: 0, y: 0 }, { x: -10, y: 3.2 }, { shift: true, alt: false });
    const { end } = lineEndpoints(draft);
    expect(Math.atan2(end.y, end.x) / (Math.PI / 12)).toBeCloseTo(Math.round(Math.atan2(end.y, end.x) / (Math.PI / 12)));
  });
});

describe("debug 31: spray dots vary in size and shape", () => {
  it("stretches every dot and doubles some into bigger blobs", () => {
    const centers = Array.from({ length: 400 }, (_, index) => ({ x: index, y: 0 }));
    const dabs = sprayBlobs(centers, 1, createSeededRandom(7));
    const lengths = dabs.filter((dab) => dab.dx !== undefined).map((dab) => Math.hypot(dab.dx!, dab.dy!));
    expect(lengths).toHaveLength(400);
    expect(Math.min(...lengths)).toBeLessThan(0.15);
    expect(Math.max(...lengths)).toBeGreaterThan(0.5);
    const doubled = dabs.length - 400;
    expect(doubled).toBeGreaterThan(80);
    expect(doubled).toBeLessThan(200);
  });
});
