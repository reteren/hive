import { describe, expect, it } from "vitest";
import { transitionRecording } from "../src/audio/recordingLogic";

describe("audio recording state machine", () => {
  it("moves from idle through recording and saving to ready", () => {
    expect(transitionRecording("idle", { type: "request" })).toBe("requesting");
    expect(transitionRecording("requesting", { type: "started" })).toBe("recording");
    expect(transitionRecording("recording", { type: "stop" })).toBe("saving");
    expect(transitionRecording("saving", { type: "saved" })).toBe("ready");
  });

  it("stops on blur unless background recording is enabled", () => {
    expect(transitionRecording("recording", { type: "blur", recordInBackground: false })).toBe("saving");
    expect(transitionRecording("recording", { type: "blur", recordInBackground: true })).toBe("recording");
  });

  it("does not stop when selection changes", () => {
    expect(transitionRecording("recording", { type: "selection-change" })).toBe("recording");
  });

  it("surfaces denied or unavailable microphone errors without a ready state", () => {
    expect(transitionRecording("requesting", { type: "failed" })).toBe("error");
  });
});
