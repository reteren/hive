import { describe, expect, it, vi } from "vitest";
import { createRecordingPinController } from "../src/audio/recordingPin";

describe("dictaphone visibility pin", () => {
  it("keeps the note pinned from microphone request through recording and save", () => {
    const releasePin = vi.fn();
    const pinNote = vi.fn((_noteId: string, _reason: string) => releasePin);
    const controller = createRecordingPinController(pinNote);

    controller.update("dictaphone", "requesting");
    controller.update("dictaphone", "recording");
    controller.update("dictaphone", "saving");
    expect(pinNote).toHaveBeenCalledTimes(1);
    expect(pinNote).toHaveBeenCalledWith("dictaphone", "dictaphone recording");
    expect(releasePin).not.toHaveBeenCalled();

    controller.update("dictaphone", "idle");
    expect(releasePin).toHaveBeenCalledTimes(1);
    controller.release();
    expect(releasePin).toHaveBeenCalledTimes(1);
  });

  it("releases the pin when microphone access fails during the request", () => {
    const releasePin = vi.fn();
    const controller = createRecordingPinController(() => releasePin);

    controller.update("dictaphone", "requesting");
    controller.update("dictaphone", "error");

    expect(releasePin).toHaveBeenCalledTimes(1);
  });
});
