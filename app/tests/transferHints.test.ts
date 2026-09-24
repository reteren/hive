import { afterEach, describe, expect, it, vi } from "vitest";
import { TransferHintTimers, TRANSFER_HINT_DURATION_MS } from "../src/transfer/hints";

afterEach(() => vi.useRealTimers());

describe("transfer hints", () => {
  it("dismisses a bubble after three seconds and never exceeds five displays", () => {
    vi.useFakeTimers();
    let shown = 0;
    const dismissed: string[] = [];
    const hints = new TransferHintTimers(() => shown, () => { shown += 1; }, (id) => dismissed.push(id));

    expect(hints.show("first")).toBe(true);
    expect(hints.show("first")).toBe(false);
    vi.advanceTimersByTime(TRANSFER_HINT_DURATION_MS - 1);
    expect(dismissed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(dismissed).toEqual(["first"]);
    for (const id of ["second", "third", "fourth", "fifth"]) expect(hints.show(id)).toBe(true);
    expect(hints.show("sixth")).toBe(false);
    expect(shown).toBe(5);
    hints.clear();
  });
});
