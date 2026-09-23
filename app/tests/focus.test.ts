import { describe, expect, it } from "vitest";
import { isTextEditingTarget } from "../src/commands/focus";

interface FakeElement {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
  attributes?: Record<string, string>;
  parentElement?: FakeElement | null;
  getAttribute?: (name: string) => string | null;
}

function fakeElement(
  tagName: string,
  options: Omit<FakeElement, "tagName" | "getAttribute"> = {},
): FakeElement {
  return {
    tagName: tagName.toUpperCase(),
    ...options,
    getAttribute(name) {
      return options.attributes?.[name] ?? null;
    },
  };
}

describe("isTextEditingTarget", () => {
  it("recognizes text-like inputs, textareas, and selects", () => {
    for (const type of ["text", "email", "number", "search", "password"]) {
      expect(isTextEditingTarget(fakeElement("input", { type }))).toBe(true);
    }
    expect(isTextEditingTarget(fakeElement("textarea"))).toBe(true);
    expect(isTextEditingTarget(fakeElement("select"))).toBe(true);
  });

  it("does not classify non-text input types as text editing", () => {
    expect(isTextEditingTarget(fakeElement("input", { type: "checkbox" }))).toBe(false);
    expect(isTextEditingTarget(fakeElement("input", { type: "range" }))).toBe(false);
  });

  it("recognizes contenteditable targets and descendants", () => {
    const editor = fakeElement("div", { attributes: { contenteditable: "true" } });
    const child = fakeElement("span", { parentElement: editor });

    expect(isTextEditingTarget(editor)).toBe(true);
    expect(isTextEditingTarget(child)).toBe(true);
    expect(isTextEditingTarget(fakeElement("div", { isContentEditable: true }))).toBe(true);
  });

  it("honors a nested contenteditable false boundary", () => {
    const editor = fakeElement("div", { attributes: { contenteditable: "true" } });
    const staticIsland = fakeElement("span", {
      attributes: { contenteditable: "false" },
      parentElement: editor,
    });

    expect(isTextEditingTarget(staticIsland)).toBe(false);
  });

  it("returns false for ordinary board elements", () => {
    expect(isTextEditingTarget(fakeElement("div"))).toBe(false);
  });
});
