import { registerCommand } from "../commands/registry.svelte";
import { acknowledgeAllChanges } from "./changeMarks.svelte";

registerCommand({
  id: "changes.markAllSeen",
  label: "Mark all changes as seen",
  keys: [],
  run: acknowledgeAllChanges,
});
