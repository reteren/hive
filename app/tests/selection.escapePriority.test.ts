import { describe, expect, it } from "vitest";
import { resolveBoardEscapeAction } from "../src/selection/escapePriority";

describe("board Escape priority", () => {
  it("defers to a focused editor before board-owned UI", () => {
    expect(resolveBoardEscapeAction({
      textEditingTarget: true,
      editorOpen: true,
      createMenuOpen: true,
    })).toBe("defer-to-text-editor");
  });

  it("closes the editor before the create menu", () => {
    expect(resolveBoardEscapeAction({
      textEditingTarget: false,
      editorOpen: true,
      createMenuOpen: true,
    })).toBe("close-editor");
  });

  it("closes the create menu when no editor is open", () => {
    expect(resolveBoardEscapeAction({
      textEditingTarget: false,
      editorOpen: false,
      createMenuOpen: true,
    })).toBe("close-create-menu");
  });

  it("passes Escape to later owners when the board has nothing to close", () => {
    expect(resolveBoardEscapeAction({
      textEditingTarget: false,
      editorOpen: false,
      createMenuOpen: false,
    })).toBe("pass-through");
  });
});
