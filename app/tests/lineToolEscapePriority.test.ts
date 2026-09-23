import { describe, expect, it } from "vitest";
import { resolveLineToolEscapeAction } from "../src/search/escapePriority";

describe("line-tool Escape priority", () => {
  it("lets the focused overlay handle Escape before the line tool", () => {
    expect(resolveLineToolEscapeAction({
      focusedFloatingUi: true,
      contextMenuOpen: false,
      selectionContextPickOpen: false,
      lineToolActive: true,
    })).toBe("defer");
  });

  it("closes a context menu before cancelling an active line tool", () => {
    expect(resolveLineToolEscapeAction({
      focusedFloatingUi: false,
      contextMenuOpen: true,
      selectionContextPickOpen: false,
      lineToolActive: true,
    })).toBe("close-context-menu");
  });

  it("passes to note context selection, then cancels the tool on the next Escape", () => {
    expect(resolveLineToolEscapeAction({
      focusedFloatingUi: false,
      contextMenuOpen: false,
      selectionContextPickOpen: true,
      lineToolActive: true,
    })).toBe("defer");
    expect(resolveLineToolEscapeAction({
      focusedFloatingUi: false,
      contextMenuOpen: false,
      selectionContextPickOpen: false,
      lineToolActive: true,
    })).toBe("cancel-line-tool");
  });
});
