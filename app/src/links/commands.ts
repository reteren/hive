import { registerCommand } from "../commands/registry.svelte";
import { cancelLineDraft } from "./interaction.svelte";
import { clearSelectedLink, selectedLinkIds } from "./selection.svelte";
import { isLineTool, tool, type LineToolId } from "../tools/tool.svelte";
import { cycleLinkShapes } from "./operations";
import { nextLineShape } from "./lineGeometry";
import { nextTool } from "./gestures";

export function toggleLineTool(id: LineToolId): void {
  tool.active = nextTool(tool.active, id) as LineToolId | "select";
  if (tool.active === id) tool.lastLine = id;
  cancelLineDraft();
  clearSelectedLink();
}

/** Line button: leave line mode, or enter it with the last used sub-tool (strong by default). */
export function toggleLineMode(): void {
  tool.active = isLineTool() ? "select" : tool.lastLine;
  cancelLineDraft();
  clearSelectedLink();
}

/** Pick a line sub-tool from the toolbar; unlike the key binds it never leaves line mode. */
export function selectLineSubtool(id: LineToolId): void {
  if (tool.active === id) return;
  tool.active = id;
  tool.lastLine = id;
  cancelLineDraft();
  clearSelectedLink();
}

registerCommand({
  id: "tool.select",
  label: "Select / Move Tool",
  keys: ["Digit1"],
  run: () => {
    tool.active = "select";
    cancelLineDraft();
    clearSelectedLink();
  },
  isActive: () => tool.active === "select",
});

registerCommand({
  id: "tool.line",
  label: "Line",
  keys: [],
  run: toggleLineMode,
  isActive: () => isLineTool(),
});

registerCommand({
  id: "tool.lineStrong",
  label: "Strong line",
  keys: ["KeyC"],
  run: () => toggleLineTool("line-strong"),
  isActive: () => tool.active === "line-strong",
});

registerCommand({
  id: "tool.lineWeak",
  label: "Weak line",
  keys: ["KeyV"],
  run: () => toggleLineTool("line-weak"),
  isActive: () => tool.active === "line-weak",
});

registerCommand({
  id: "line.cycleShape",
  label: "Cycle Line Shape",
  keys: ["KeyT"],
  run: () => {
    if (tool.active !== "line-strong" && tool.active !== "line-weak" && selectedLinkIds().length === 0) return;
    tool.lineShape = nextLineShape(tool.lineShape);
    cycleLinkShapes(selectedLinkIds());
  },
  isActive: () => tool.lineShape !== "base",
});
