import { afterEach, describe, expect, it, vi } from "vitest";
import { createControlsAutoHide } from "../src/video/controlsAutoHide";

afterEach(() => vi.useRealTimers());

describe("video player control visibility", () => {
  it("hides about half a second after pointer activity while playing", () => {
    vi.useFakeTimers();
    const changes: boolean[] = [];
    const controls = createControlsAutoHide((visible) => changes.push(visible), 500);
    controls.setPlaying(true);
    controls.pointerActivity();

    vi.advanceTimersByTime(499);
    expect(changes).not.toContain(false);
    vi.advanceTimersByTime(1);
    expect(changes.at(-1)).toBe(false);
    controls.dispose();
  });

  it("stays visible while paused and restarts the delay after movement", () => {
    vi.useFakeTimers();
    const changes: boolean[] = [];
    const controls = createControlsAutoHide((visible) => changes.push(visible), 500);
    controls.setPlaying(true);
    vi.advanceTimersByTime(300);
    controls.pointerActivity();
    vi.advanceTimersByTime(300);
    expect(changes).not.toContain(false);
    controls.setPlaying(false);
    vi.advanceTimersByTime(700);
    expect(changes).not.toContain(false);
    controls.dispose();
  });
});
