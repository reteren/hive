import { describe, expect, it } from "vitest";
import { calculatorInputKey } from "../src/calculator/input";

describe("calculator keyboard input", () => {
  const expressionInput = { tagName: "INPUT", type: "text" } as unknown as EventTarget;

  it("keeps ordinary typing inside expression inputs", () => {
    expect(calculatorInputKey({ key: "7", target: expressionInput })).toBe("other");
  });

  it("handles Enter and Escape only for a text-editing target", () => {
    expect(calculatorInputKey({ key: "Enter", target: expressionInput })).toBe("enter");
    expect(calculatorInputKey({ key: "Escape", target: expressionInput })).toBe("escape");
    expect(calculatorInputKey({ key: "Enter", target: { tagName: "BUTTON" } as unknown as EventTarget })).toBeNull();
  });
});
