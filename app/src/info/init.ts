import { mount } from "svelte";
import { registerCommand } from "../commands/registry.svelte";
import { menuShortcutLabel } from "../commands/menuShortcut";
import { registerNoteMenuItem } from "../notes/noteMenu";
import { selection } from "../selection/selection.svelte";
import { closeNodeInfo, infoWindow, openNodeInfo } from "./infoWindow.svelte";
import NodeInfoWindow from "./NodeInfoWindow.svelte";

registerCommand({
  id: "object.info",
  label: "Info",
  keys: ["Alt+KeyI"],
  run: () => {
    const id = selection.ids.at(-1);
    if (!id) return;
    if (infoWindow.noteId === id) closeNodeInfo();
    else openNodeInfo(id);
  },
  isActive: () => infoWindow.noteId !== null,
});

registerNoteMenuItem({
  id: "object.info",
  label: () => "Info",
  run: openNodeInfo,
  shortcut: () => menuShortcutLabel("object.info"),
  dividerBefore: true,
  order: 1000,
});

if (typeof document !== "undefined") {
  const host = document.createElement("div");
  host.dataset.nodeInfoHost = "";
  document.body.append(host);
  mount(NodeInfoWindow, { target: host });
}
