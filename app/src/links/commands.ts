import { registerCommand } from "../commands/registry.svelte";
import { cancelLineDraft } from "./interaction.svelte";
import { clearSelectedLink, selectedLink } from "./selection.svelte";
import { links } from "../model/links.svelte";
import { tool, type ToolId } from "../tools/tool.svelte";
import { changeLinkShape, cutLinks } from "./operations";
import { nextLineShape } from "./lineGeometry";

export function toggleLineTool(id: Extract<ToolId, "line-strong" | "line-weak" | "line-cut">): void {
  tool.active = tool.active === id ? "select" : id;
  cancelLineDraft();
  clearSelectedLink();
}

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
  id: "tool.lineCut",
  label: "Cut Links",
  keys: ["Shift+KeyC"],
  run: () => toggleLineTool("line-cut"),
  isActive: () => tool.active === "line-cut",
});

registerCommand({
  id: "line.cycleShape",
  label: "Cycle Line Shape",
  keys: [],
  run: () => {
    tool.lineShape = nextLineShape(tool.lineShape);
    const link = selectedLink.id ? links.byId[selectedLink.id] : undefined;
    if (link) changeLinkShape(link.id, nextLineShape(link.shape));
  },
  isActive: () => tool.lineShape !== "straight",
});
