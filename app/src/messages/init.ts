import { registerNodeBody } from "../notes/nodeBodies";
import { registerCommand } from "../commands/registry.svelte";
import { createNoteKind } from "../notes/noteCommands";
import MessageNodeBody from "./MessageNodeBody.svelte";
import { dismissMessage, messageQueue } from "./messageQueue.svelte";
import { goToMessage } from "./navigation";
import { board } from "../model/board.svelte";
import { registerNoteMenuItem } from "../notes/noteMenu";
import { toggleModulePicker } from "../modules/moduleActions.svelte";

registerNoteMenuItem({ id: "messages.importance", label: () => "Change Importance", order: 40,
  visible: (id) => board.notes[id]?.type === "message", run: (id) => toggleModulePicker(id, "importance") });

registerNodeBody("message", MessageNodeBody);
registerCommand({ id: "messages.create", label: "Create Message", keys: [], run: () => { createNoteKind("message"); } });
registerCommand({ id: "messages.dismissNewest", label: "Close Newest Reminder", keys: [], run: () => {
  const id = messageQueue.items[0]?.id; if (id) dismissMessage(id);
} });
registerCommand({ id: "messages.goToNewest", label: "Go to Newest Reminder", keys: [], run: () => {
  const id = messageQueue.items[0]?.id; if (id) goToMessage(id);
} });
