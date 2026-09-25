import { describe, expect, it } from "vitest";
import { resolveBoardEscapeAction } from "../src/selection/escapePriority";

describe("board Escape priority", () => {
  it("defers to a focused editor before board-owned UI", () => {
    expect(resolveBoardEscapeAction({
      textEditingTarget: true,
      editorOpen: true,
      createMenuOpen: true,
      undoLogOpen: true,
    })).toBe("defer-to-text-editor");
  });

  it("closes the editor before the create menu", () => {
    expect(resolveBoardEscapeAction({
      textEditingTarget: false,
      editorOpen: true,
      createMenuOpen: true,
      undoLogOpen: true,
    })).toBe("close-editor");
  });

  it("closes the create menu when no editor is open", () => {
    expect(resolveBoardEscapeAction({
      textEditingTarget: false,
      editorOpen: false,
      createMenuOpen: true,
      undoLogOpen: true,
    })).toBe("close-create-menu");
  });

  it("closes the undo log after the create menu", () => {
    expect(resolveBoardEscapeAction({
      textEditingTarget: false,
      editorOpen: false,
      createMenuOpen: false,
      undoLogOpen: true,
    })).toBe("close-undo-log");
  });

  it("passes Escape to later owners when the board has nothing to close", () => {
    expect(resolveBoardEscapeAction({
      textEditingTarget: false,
      editorOpen: false,
      createMenuOpen: false,
      undoLogOpen: false,
    })).toBe("pass-through");
  });

  it("clears the shape cut marquee before leaving edit mode", () => {
    expect(resolveBoardEscapeAction({
      textEditingTarget: false,
      editorOpen: true,
      createMenuOpen: true,
      undoLogOpen: true,
      shapeEditActive: true,
      shapeEditMarqueeActive: true,
    })).toBe("clear-shape-edit-marquee");
  });

  it("leaves shape edit before other board-owned Escape actions", () => {
    expect(resolveBoardEscapeAction({
      textEditingTarget: false,
      editorOpen: true,
      createMenuOpen: true,
      undoLogOpen: true,
      shapeEditActive: true,
      shapeEditMarqueeActive: false,
    })).toBe("leave-shape-edit");
  });
});
