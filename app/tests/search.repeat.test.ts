import { describe, expect, it } from "vitest";
import { shouldRunOnKeydown } from "../src/search/keyboardRepeat";

describe("command key repeat policy", () => {
  it("runs every command once per key press unless it explicitly opts into repeats", () => {
    expect(shouldRunOnKeydown({}, false)).toBe(true);
    expect(shouldRunOnKeydown({}, true)).toBe(false);
    expect(shouldRunOnKeydown({ repeat: false }, true)).toBe(false);
    expect(shouldRunOnKeydown({ repeat: true }, true)).toBe(true);
  });
});
