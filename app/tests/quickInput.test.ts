import { describe, expect, it } from "vitest";
import { shortcutFromKeyPress } from "../src/quickInput/keyCapture";
import {
  finishSubmission,
  initialSubmissionState,
  NO_INBOX_ERROR,
  startSubmission,
} from "../src/quickInput/submission";

describe("quick input shortcut capture", () => {
  it("normalizes Ctrl+Alt+Space", () => {
    expect(shortcutFromKeyPress({
      key: " ", code: "Space", ctrlKey: true, altKey: true, shiftKey: false, metaKey: false,
    })).toBe("Ctrl+Alt+Space");
  });

  it("includes shifted letter keys and ignores bare keys", () => {
    expect(shortcutFromKeyPress({
      key: "Q", code: "KeyQ", ctrlKey: true, altKey: false, shiftKey: true, metaKey: false,
    })).toBe("Ctrl+Shift+Q");
    expect(shortcutFromKeyPress({
      key: "q", code: "KeyQ", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
    })).toBeNull();
  });
});

describe("quick input submission", () => {
  it("preserves the exact text in an emitted request and clears after success", () => {
    const started = startSubmission(initialSubmissionState("  idea\nsecond line  "), "request-1");
    expect(started.request).toEqual({ text: "  idea\nsecond line  ", requestId: "request-1" });
    expect(finishSubmission(started.state, { requestId: "request-1", ok: true })).toEqual(initialSubmissionState());
  });

  it("keeps the draft and explains a missing Inbox", () => {
    const started = startSubmission(initialSubmissionState("Keep this text"), "request-2");
    expect(finishSubmission(started.state, {
      requestId: "request-2", ok: false, error: "no-inbox",
    })).toEqual({ text: "Keep this text", requestId: null, error: NO_INBOX_ERROR });
  });

  it("ignores stale results and blocks duplicate submissions", () => {
    const started = startSubmission(initialSubmissionState("idea"), "request-3");
    expect(startSubmission(started.state, "request-4").request).toBeNull();
    expect(finishSubmission(started.state, { requestId: "old", ok: true })).toBe(started.state);
  });

  it("does not emit whitespace-only input", () => {
    expect(startSubmission(initialSubmissionState(" \n "), "request-5").request).toBeNull();
  });
});
