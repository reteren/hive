import { registerCommand } from "../commands/registry.svelte";
import { tool } from "../tools/tool.svelte";
import { clearSelection } from "../selection/selection.svelte";
import { deactivateDrawInput } from "./drawInput";
import "./brush";
import "./eraser";
import "./fill";
import "./selection.svelte";

export function toggleDrawMode(): void {
  if (tool.active === "draw") {
    deactivateDrawInput();
    tool.active = "select";
  } else {
    // Node selection handles would sit on top of the canvas and swallow strokes/selections.
    clearSelection();
    tool.active = "draw";
  }
}

registerCommand({
  id: "tool.draw",
  label: "Draw",
  keys: ["Ctrl+KeyD"],
  run: toggleDrawMode,
  isActive: () => tool.active === "draw",
});
