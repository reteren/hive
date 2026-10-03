import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopTierlistAudioFor, tierlistAudioPlayback, toggleTierlistAudio } from "../src/tierlist/audioPlayback.svelte";

class FakeAudio {
  static instances: FakeAudio[] = [];
  static rejectNextPlay = false;

  paused = true;
  preload = "";
  error: { message: string } | null = null;
  onplay: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly src: string) {
    FakeAudio.instances.push(this);
  }

  async play(): Promise<void> {
    if (FakeAudio.rejectNextPlay) {
      FakeAudio.rejectNextPlay = false;
      throw new Error("NotAllowedError");
    }
    this.paused = false;
    this.onplay?.();
  }

  pause(): void {
    this.paused = true;
    this.onpause?.();
  }
}

describe("Tierlist audio playback", () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    FakeAudio.rejectNextPlay = false;
    vi.stubGlobal("Audio", FakeAudio);
    tierlistAudioPlayback.key = null;
    tierlistAudioPlayback.audio = null;
    tierlistAudioPlayback.playing = false;
    tierlistAudioPlayback.errorKey = null;
    tierlistAudioPlayback.error = "";
  });

  afterEach(() => {
    stopTierlistAudioFor("tierlist");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("plays the asset URL, toggles pause, and stops the previous card", async () => {
    await toggleTierlistAudio("tierlist:first", "asset://localhost/attachments/one.webm");
    const first = FakeAudio.instances[0];
    expect(first?.src).toBe("asset://localhost/attachments/one.webm");
    expect(first?.preload).toBe("auto");
    expect(tierlistAudioPlayback.playing).toBe(true);

    await toggleTierlistAudio("tierlist:first", "asset://localhost/attachments/one.webm");
    expect(first?.paused).toBe(true);
    expect(tierlistAudioPlayback.playing).toBe(false);

    await toggleTierlistAudio("tierlist:second", "asset://localhost/attachments/two.webm");
    expect(first?.paused).toBe(true);
    expect(FakeAudio.instances).toHaveLength(2);
    expect(tierlistAudioPlayback.key).toBe("tierlist:second");
    expect(tierlistAudioPlayback.playing).toBe(true);
  });

  it("records a visible error and logs the rejected play reason", async () => {
    FakeAudio.rejectNextPlay = true;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await toggleTierlistAudio("tierlist:broken", "asset://localhost/attachments/broken.webm");

    expect(tierlistAudioPlayback.errorKey).toBe("tierlist:broken");
    expect(tierlistAudioPlayback.error).toBe("NotAllowedError");
    expect(tierlistAudioPlayback.playing).toBe(false);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning.mock.calls[0]?.[1]).toEqual({
      url: "asset://localhost/attachments/broken.webm",
      error: "NotAllowedError",
    });
  });
});
