import TrashNodeBody from "./TrashNodeBody.svelte";
import { registerCommand } from "../commands/registry.svelte";
import { registerNodeBody } from "../notes/nodeBodies";
import { panelPopupState, togglePanelPopup } from "../ui/popups/panelPopupState.svelte";

registerNodeBody("trash", TrashNodeBody);

registerCommand({
  id: "ui.openTrash",
  label: "Open trash",
  keys: ["Alt+KeyD"],
  run: () => togglePanelPopup("trash"),
  isActive: () => panelPopupState.active === "trash",
});
