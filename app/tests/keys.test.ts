import { describe, expect, it } from "vitest";
import { formatKey, matchesKey, parseKey } from "../src/commands/keys";

function keyEvent(init: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    code: "KeyG",
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...init,
  } as KeyboardEvent;
}

describe("command key notation", () => {
  it("parses the supported modifiers in contract order", () => {
    expect(parseKey("Ctrl+Shift+Alt+KeyG")).toEqual({
      code: "KeyG",
      ctrl: true,
      shift: true,
      alt: true,
    });
  });

  it("rejects duplicated, unknown, or out-of-order modifiers", () => {
    expect(() => parseKey("Shift+Ctrl+KeyG")).toThrow();
    expect(() => parseKey("Ctrl+Ctrl+KeyG")).toThrow();
    expect(() => parseKey("Meta+KeyG")).toThrow();
  });

  it("formats bindings using concise key labels", () => {
    expect(formatKey("Shift+KeyG")).toBe("Shift+G");
    expect(formatKey("Space")).toBe("Space");
    expect(formatKey("BracketRight")).toBe("]");
    expect(formatKey("Ctrl+Digit0")).toBe("Ctrl+0");
  });

  it("matches KeyboardEvent.code with an exact modifier set", () => {
    expect(matchesKey(keyEvent({ shiftKey: true }), "Shift+KeyG")).toBe(true);
    expect(matchesKey(keyEvent(), "KeyG")).toBe(true);
    expect(matchesKey(keyEvent({ ctrlKey: true }), "KeyG")).toBe(false);
    expect(matchesKey(keyEvent({ shiftKey: true }), "KeyG")).toBe(false);
    expect(matchesKey(keyEvent({ metaKey: true }), "KeyG")).toBe(false);
    expect(matchesKey(keyEvent({ code: "KeyH" }), "KeyG")).toBe(false);
  });
});
