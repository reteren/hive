import { registerCommand } from "../commands/registry.svelte";
import { cancelLineDraft } from "./interaction.svelte";
import { clearSelectedLink, selectedLinkIds } from "./selection.svelte";
import { tool, type ToolId } from "../tools/tool.svelte";
import { cycleLinkShapes } from "./operations";
import { nextLineShape } from "./lineGeometry";
import { nextTool } from "./gestures";

export function toggleLineTool(id: Extract<ToolId, "line-strong" | "line-weak">): void {
  tool.active = nextTool(tool.active, id) as ToolId;
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
  id: "tool.lineStrong",
  label: "Strong Link",
  keys: ["KeyC"],
  run: () => toggleLineTool("line-strong"),
  isActive: () => tool.active === "line-strong",
});

registerCommand({
  id: "tool.lineWeak",
  label: "Weak Link",
  keys: ["KeyV"],
  run: () => toggleLineTool("line-weak"),
  isActive: () => tool.active === "line-weak",
});

registerCommand({
  id: "line.cycleShape",
  label: "Cycle Line Shape",
  keys: [],
  run: () => {
    tool.lineShape = nextLineShape(tool.lineShape);
    cycleLinkShapes(selectedLinkIds());
  },
  isActive: () => tool.lineShape !== "base",
});
