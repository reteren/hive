import { describe, expect, it, vi } from "vitest";
import { createBatchedScreenScale } from "../src/attachments/screenScale";

function fakeElement(width: number) {
  return { isConnected: true, getBoundingClientRect: vi.fn(() => ({ width })) } as unknown as Element & { getBoundingClientRect: ReturnType<typeof vi.fn> };
}

describe("batched screen scale", () => {
  it("queues first measurements, reads them together, then follows the zoom by arithmetic", async () => {
    const first = fakeElement(50);
    const second = fakeElement(200);
    const measuredA = vi.fn();
    const measuredB = vi.fn();
    const scaleA = createBatchedScreenScale(measuredA);
    const scaleB = createBatchedScreenScale(measuredB);

    expect(scaleA(first, 100, 0.5, 0)).toBeNull();
    expect(scaleB(second, 100, 0.5, 0)).toBeNull();
    expect(scaleA(first, 100, 0.5, 0)).toBeNull();
    expect(first.getBoundingClientRect).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(measuredA).toHaveBeenCalledTimes(1);
    expect(measuredB).toHaveBeenCalledTimes(1);
    expect(first.getBoundingClientRect).toHaveBeenCalledTimes(1);

    expect(scaleA(first, 100, 0.5, 0)).toBeCloseTo(0.5);
    expect(scaleA(first, 100, 1, 0)).toBeCloseTo(1);
    expect(scaleB(second, 100, 2, 0)).toBeCloseTo(8);
    expect(first.getBoundingClientRect).toHaveBeenCalledTimes(1);

    // A new note scale (revision) measures again.
    expect(scaleA(first, 100, 1, 1)).toBeNull();
  });
});
