import TrashNodeBody from "./TrashNodeBody.svelte";
import { registerCommand } from "../commands/registry.svelte";
import { registerNodeBody } from "../notes/nodeBodies";
import { toggleTrashPanel, trashPanel } from "./trashPanelState.svelte";

registerNodeBody("trash", TrashNodeBody);

registerCommand({
  id: "ui.openTrash",
  label: "Open trash",
  keys: [],
  run: toggleTrashPanel,
  isActive: () => trashPanel.open,
});
