import { afterEach, describe, expect, it, vi } from "vitest";
import { createHoverIntent } from "../src/video/hoverIntent";

afterEach(() => vi.useRealTimers());

describe("video volume popover hover intent", () => {
  it("keeps the popover open for the leave grace period and closes after 250 ms", () => {
    vi.useFakeTimers();
    const changes: boolean[] = [];
    const intent = createHoverIntent((open) => changes.push(open), 250);

    intent.pointerEnter();
    intent.pointerLeave();
    vi.advanceTimersByTime(249);
    expect(changes.at(-1)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(changes.at(-1)).toBe(false);
    intent.dispose();
  });

  it("cancels closing when the pointer enters the popover and stays open while focused", () => {
    vi.useFakeTimers();
    const changes: boolean[] = [];
    const intent = createHoverIntent((open) => changes.push(open), 250);

    intent.pointerEnter();
    intent.pointerLeave();
    vi.advanceTimersByTime(200);
    intent.pointerEnter();
    vi.advanceTimersByTime(100);
    expect(changes.at(-1)).toBe(true);

    intent.pointerLeave();
    intent.focus();
    vi.advanceTimersByTime(500);
    expect(changes.at(-1)).toBe(true);
    intent.blur();
    vi.advanceTimersByTime(250);
    expect(changes.at(-1)).toBe(false);
    intent.dispose();
  });
});
