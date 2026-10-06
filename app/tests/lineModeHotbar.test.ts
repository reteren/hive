import { beforeEach, describe, expect, it } from "vitest";
import { selectLineSubtool, toggleLineMode, toggleLineTool } from "../src/links/commands";
import { getCommand } from "../src/commands/registry.svelte";
import { DRAW_SUBTOOLS } from "../src/drawing/subtools";
import { tool } from "../src/tools/tool.svelte";

describe("Line tool with strong/weak sub-tools", () => {
  beforeEach(() => {
    tool.active = "select";
    tool.lastLine = "line-strong";
  });

  it("enters line mode with strong by default and leaves it on the next press", () => {
    toggleLineMode();
    expect(tool.active).toBe("line-strong");
    toggleLineMode();
    expect(tool.active).toBe("select");
  });

  it("re-enters with the last picked sub-tool", () => {
    toggleLineMode();
    selectLineSubtool("line-weak");
    selectLineSubtool("line-weak");
    expect(tool.active).toBe("line-weak");
    toggleLineMode();
    toggleLineMode();
    expect(tool.active).toBe("line-weak");
    toggleLineTool("line-strong");
    expect(tool.lastLine).toBe("line-strong");
  });

  it("shows plain T, not Search's Ctrl+T, as the shape bind", () => {
    expect(getCommand("line.cycleShape")?.keys).toEqual(["KeyT"]);
  });

  it("lists draw sub-tools with the rectangle select renamed", () => {
    expect(DRAW_SUBTOOLS.map((item) => item.label)).toEqual(
      ["Brush", "Eraser", "Fill", "Select rectangle", "Lasso", "Polygon", "Text", "Shape", "Spray", "Effects"],
    );
  });
});
