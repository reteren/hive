import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function audioFixture(state: AudioContextState = "running") {
  const oscillator = {
    type: "", frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
    onended: null as (() => void) | null,
  };
  const gain = {
    gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(), disconnect: vi.fn(),
  };
  const context = {
    state, currentTime: 10, destination: {},
    resume: vi.fn(async () => { context.state = "running"; }),
    createOscillator: vi.fn(() => oscillator), createGain: vi.fn(() => gain),
  };
  vi.stubGlobal("AudioContext", class { constructor() { return context; } });
  return { context, oscillator, gain };
}

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(1000); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("reminder audio", () => {
  it("plays quiet short tones, queues simultaneous cards and releases audio nodes", async () => {
    const { oscillator, gain } = audioFixture();
    const { playMessageSound } = await import("../src/messages/sound");
    expect(await playMessageSound()).toBe(true);
    expect(oscillator.type).toBe("sine");
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.035, 10.025);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 10.24);
    expect(oscillator.stop).toHaveBeenCalledWith(10.25);
    expect(await playMessageSound(5)).toBe(true);
    expect(oscillator.start).toHaveBeenCalledTimes(6);
    expect(oscillator.start).toHaveBeenLastCalledWith(11.75);
    oscillator.onended?.();
    expect(oscillator.disconnect).toHaveBeenCalledOnce();
    expect(gain.disconnect).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(350);
    expect(await playMessageSound()).toBe(true);
  });

  it("unlocks on an interaction without playing or queuing an old reminder tone", async () => {
    const { context, oscillator } = audioFixture("suspended");
    const { playMessageSound, installMessageSoundUnlock } = await import("../src/messages/sound");
    expect(await playMessageSound()).toBe(false);
    expect(context.resume).not.toHaveBeenCalled();
    const root = new EventTarget();
    const dispose = installMessageSoundUnlock(root as Document);
    root.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    expect(context.resume).toHaveBeenCalledOnce();
    expect(oscillator.start).not.toHaveBeenCalled();
    expect(await playMessageSound()).toBe(true);
    dispose(); context.state = "suspended";
    root.dispatchEvent(new Event("keydown"));
    expect(context.resume).toHaveBeenCalledOnce();
  });

  it("handles unavailable audio and rejected autoplay without failing message delivery", async () => {
    vi.stubGlobal("AudioContext", class { constructor() { throw new Error("No device"); } });
    const { playMessageSound, prepareMessageSound } = await import("../src/messages/sound");
    await expect(prepareMessageSound()).resolves.toBeUndefined();
    await expect(playMessageSound()).resolves.toBe(false);
    const { context } = audioFixture("suspended");
    context.resume.mockRejectedValue(new Error("Autoplay blocked"));
    await expect(prepareMessageSound()).resolves.toBeUndefined();
    await expect(playMessageSound()).resolves.toBe(false);
  });
});
